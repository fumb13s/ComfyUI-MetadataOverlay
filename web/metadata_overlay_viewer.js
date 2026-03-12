// Standalone Metadata Viewer
// This module runs on the /metadata_overlay/view page, outside the ComfyUI SPA.
// It reads image parameters from data-* attributes, fetches metadata, and renders
// an overlay with a settings gear popover.

// Determine the base URL of this script to resolve sibling module imports.
const scriptUrl = new URL(import.meta.url);
const scriptDir = scriptUrl.pathname.substring(0, scriptUrl.pathname.lastIndexOf("/") + 1);

const {
  ALL_FIELDS, DEFAULT_FIELDS, SETTINGS,
  PANEL_WIDTH, PANEL_HEIGHT, OVERLAY_ID, INJECTED_STYLE_ID,
  fetchMetadata, formatMetadata,
} = await import(`${scriptDir}metadata_overlay_shared.js`);


// ── Settings access via REST API ──

let settingsCache = null;

async function loadSettings() {
  try {
    const resp = await fetch("/api/settings");
    if (resp.ok) {
      settingsCache = await resp.json();
    } else {
      settingsCache = {};
    }
  } catch {
    settingsCache = {};
  }
}

function getSetting(id, defaultValue) {
  if (!settingsCache) return defaultValue;
  const val = settingsCache[id];
  return val !== undefined && val !== null ? val : defaultValue;
}

async function setSetting(id, value) {
  settingsCache[id] = value;
  try {
    await fetch(`/api/settings/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  } catch {
    // best-effort save
  }
}

function getSelectedFields() {
  const raw = getSetting(SETTINGS.FIELDS, DEFAULT_FIELDS);
  if (!raw) return [...ALL_FIELDS];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function getDisplayMode() {
  return getSetting(SETTINGS.DISPLAY_MODE, "side-panel");
}

function getPanelPosition() {
  return getSetting(SETTINGS.PANEL_POSITION, "adaptive");
}

function getPosition() {
  return getSetting(SETTINGS.POSITION, "bottom-left");
}

function getOpacity() {
  return getSetting(SETTINGS.OPACITY, 0.8);
}


// ── Read image parameters from data attributes ──

function getImageInfoFromPage() {
  const body = document.body;
  const assetId = body.dataset.assetId;
  if (assetId) {
    return { type: "asset", assetId };
  }
  const filename = body.dataset.filename;
  if (filename) {
    return {
      type: "view",
      filename,
      fileType: body.dataset.fileType || "output",
      subfolder: body.dataset.subfolder || "",
    };
  }
  return null;
}


// ── Adaptive panel position ──

function computeAdaptivePosition() {
  const img = document.getElementById("viewer-image");
  if (!img || !img.naturalWidth || !img.naturalHeight) return "right";

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const imageAspect = img.naturalWidth / img.naturalHeight;
  const viewportAspect = vw / vh;

  if (imageAspect > viewportAspect) {
    return "bottom";
  }
  return "right";
}

function resolveEffectivePanelPosition() {
  const pos = getPanelPosition();
  if (pos === "adaptive") return computeAdaptivePosition();
  return pos;
}


// ── Overlay rendering ──

let currentOverlay = null;

function removeOverlay() {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();
  removePanelStyles();
}

function removePanelStyles() {
  const existing = document.getElementById(INJECTED_STYLE_ID);
  if (existing) existing.remove();
}

function injectPanelStyles(panelPosition) {
  removePanelStyles();

  const style = document.createElement("style");
  style.id = INJECTED_STYLE_ID;

  if (panelPosition === "left" || panelPosition === "right") {
    style.textContent = `
      #viewer-image {
        max-width: calc(100vw - ${PANEL_WIDTH}px) !important;
      }
    `;
  } else {
    style.textContent = `
      #viewer-image {
        max-height: calc(100vh - ${PANEL_HEIGHT}px) !important;
      }
    `;
  }

  document.head.appendChild(style);
}

function createSidePanel(text) {
  removeOverlay();

  const panelPosition = resolveEffectivePanelPosition();
  const opacity = getOpacity();

  injectPanelStyles(panelPosition);

  const panel = document.createElement("div");
  panel.id = OVERLAY_ID;
  panel.style.position = "fixed";
  panel.style.zIndex = "10001";
  panel.style.background = `rgba(0, 0, 0, ${opacity})`;
  panel.style.color = "#e0e0e0";
  panel.style.fontFamily = "'Consolas', 'Monaco', 'Courier New', monospace";
  panel.style.fontSize = "12px";
  panel.style.lineHeight = "1.5";
  panel.style.overflowY = "auto";
  panel.style.whiteSpace = "pre-wrap";
  panel.style.wordBreak = "break-word";
  panel.style.pointerEvents = "auto";
  panel.style.backdropFilter = "blur(4px)";
  panel.style.borderColor = "rgba(255, 255, 255, 0.1)";
  panel.style.borderStyle = "solid";
  panel.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";

  if (panelPosition === "left" || panelPosition === "right") {
    panel.style.top = "0";
    panel.style.bottom = "0";
    panel.style.width = `${PANEL_WIDTH}px`;
    panel.style.padding = "16px";
    panel.style.borderWidth = panelPosition === "left" ? "0 1px 0 0" : "0 0 0 1px";
    if (panelPosition === "left") {
      panel.style.left = "0";
    } else {
      panel.style.right = "0";
    }
  } else {
    panel.style.left = "0";
    panel.style.right = "0";
    panel.style.height = `${PANEL_HEIGHT}px`;
    panel.style.padding = "12px 16px";
    panel.style.borderWidth = panelPosition === "top" ? "0 0 1px 0" : "1px 0 0 0";
    if (panelPosition === "top") {
      panel.style.top = "0";
    } else {
      panel.style.bottom = "0";
    }
  }

  const content = document.createElement("div");
  content.textContent = text;
  panel.appendChild(content);

  document.body.appendChild(panel);
  currentOverlay = panel;
}

function createFloatingOverlay(text) {
  removeOverlay();

  const position = getPosition();
  const opacity = getOpacity();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `
    position: fixed;
    ${position.includes("bottom") ? "bottom: 16px" : "top: 16px"};
    ${position.includes("left") ? "left: 16px" : "right: 16px"};
    background: rgba(0, 0, 0, ${opacity});
    color: #e0e0e0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    padding: 12px 16px;
    border-radius: 8px;
    max-width: min(40%, 420px);
    min-height: 120px;
    max-height: 50%;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    z-index: 10001;
    pointer-events: auto;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;

  const content = document.createElement("div");
  content.textContent = text;
  overlay.appendChild(content);

  document.body.appendChild(overlay);
  currentOverlay = overlay;
}

function renderOverlay(text) {
  const mode = getDisplayMode();
  if (mode === "side-panel") {
    createSidePanel(text);
  } else {
    createFloatingOverlay(text);
  }
}


// ── Settings gear popover ──

const GEAR_BTN_ID = "metadata-viewer-settings-btn";
const POPOVER_ID = "metadata-viewer-settings-popover";

let cachedMetadata = null;

function renderSettingsGear(metadata) {
  cachedMetadata = metadata;

  // Remove existing gear button if present
  const existingBtn = document.getElementById(GEAR_BTN_ID);
  if (existingBtn) existingBtn.remove();
  const existingPopover = document.getElementById(POPOVER_ID);
  if (existingPopover) existingPopover.remove();

  const btn = document.createElement("button");
  btn.id = GEAR_BTN_ID;
  btn.textContent = "\u2699"; // gear icon
  btn.title = "Settings";
  btn.style.cssText = `
    position: fixed;
    top: 8px;
    right: 8px;
    background: rgba(255, 255, 255, 0.15);
    color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    width: 32px;
    height: 32px;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    z-index: 10003;
  `;

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(255, 255, 255, 0.3)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(255, 255, 255, 0.15)";
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopover();
  });

  document.body.appendChild(btn);
}

function togglePopover() {
  const existing = document.getElementById(POPOVER_ID);
  if (existing) {
    existing.remove();
    return;
  }
  createPopover();
}

function createPopover() {
  const popover = document.createElement("div");
  popover.id = POPOVER_ID;
  popover.style.cssText = `
    position: fixed;
    top: 48px;
    right: 8px;
    background: rgba(30, 30, 50, 0.95);
    color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 16px;
    z-index: 10004;
    font-family: sans-serif;
    font-size: 13px;
    width: 260px;
    max-height: calc(100vh - 64px);
    overflow-y: auto;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  `;

  // Prevent clicks inside popover from closing it
  popover.addEventListener("click", (e) => e.stopPropagation());

  // ── Display Mode ──
  popover.appendChild(createSectionLabel("Display Mode"));
  const modeContainer = document.createElement("div");
  modeContainer.style.cssText = "display: flex; gap: 8px; margin-bottom: 12px;";

  const currentMode = getDisplayMode();
  for (const [label, value] of [["Side Panel", "side-panel"], ["Floating", "floating"]]) {
    const modeBtn = document.createElement("button");
    modeBtn.textContent = label;
    modeBtn.style.cssText = `
      flex: 1; padding: 6px 8px; border-radius: 4px; cursor: pointer;
      font-size: 12px; border: 1px solid rgba(255, 255, 255, 0.2);
      background: ${value === currentMode ? "rgba(100, 140, 255, 0.4)" : "rgba(255, 255, 255, 0.1)"};
      color: #e0e0e0;
    `;
    modeBtn.addEventListener("click", async () => {
      await setSetting(SETTINGS.DISPLAY_MODE, value);
      rerender();
    });
    modeContainer.appendChild(modeBtn);
  }
  popover.appendChild(modeContainer);

  // ── Panel Position (only relevant for side-panel mode) ──
  popover.appendChild(createSectionLabel("Panel Position"));
  const posSelect = document.createElement("select");
  posSelect.style.cssText = `
    width: 100%; padding: 4px 8px; border-radius: 4px; margin-bottom: 12px;
    background: rgba(255, 255, 255, 0.1); color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.2); font-size: 12px;
  `;
  const currentPanelPos = getPanelPosition();
  for (const [label, value] of [
    ["Adaptive", "adaptive"], ["Left", "left"], ["Right", "right"],
    ["Top", "top"], ["Bottom", "bottom"],
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === currentPanelPos;
    opt.style.background = "#1a1a2e";
    posSelect.appendChild(opt);
  }
  posSelect.addEventListener("change", async () => {
    await setSetting(SETTINGS.PANEL_POSITION, posSelect.value);
    rerender();
  });
  popover.appendChild(posSelect);

  // ── Floating Position ──
  popover.appendChild(createSectionLabel("Floating Position"));
  const floatSelect = document.createElement("select");
  floatSelect.style.cssText = `
    width: 100%; padding: 4px 8px; border-radius: 4px; margin-bottom: 12px;
    background: rgba(255, 255, 255, 0.1); color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.2); font-size: 12px;
  `;
  const currentFloatPos = getPosition();
  for (const [label, value] of [
    ["Bottom Left", "bottom-left"], ["Bottom Right", "bottom-right"],
    ["Top Left", "top-left"], ["Top Right", "top-right"],
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === currentFloatPos;
    opt.style.background = "#1a1a2e";
    floatSelect.appendChild(opt);
  }
  floatSelect.addEventListener("change", async () => {
    await setSetting(SETTINGS.POSITION, floatSelect.value);
    rerender();
  });
  popover.appendChild(floatSelect);

  // ── Opacity ──
  popover.appendChild(createSectionLabel("Opacity"));
  const opacityContainer = document.createElement("div");
  opacityContainer.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 12px;";

  const opacitySlider = document.createElement("input");
  opacitySlider.type = "range";
  opacitySlider.min = "0.3";
  opacitySlider.max = "1.0";
  opacitySlider.step = "0.05";
  opacitySlider.value = String(getOpacity());
  opacitySlider.style.cssText = "flex: 1; cursor: pointer;";

  const opacityLabel = document.createElement("span");
  opacityLabel.textContent = opacitySlider.value;
  opacityLabel.style.cssText = "min-width: 32px; text-align: right; font-size: 12px;";

  opacitySlider.addEventListener("input", () => {
    opacityLabel.textContent = opacitySlider.value;
  });
  opacitySlider.addEventListener("change", async () => {
    await setSetting(SETTINGS.OPACITY, parseFloat(opacitySlider.value));
    rerender();
  });

  opacityContainer.appendChild(opacitySlider);
  opacityContainer.appendChild(opacityLabel);
  popover.appendChild(opacityContainer);

  // ── Fields ──
  popover.appendChild(createSectionLabel("Fields"));
  const selectedFields = getSelectedFields();
  const fieldsContainer = document.createElement("div");
  fieldsContainer.style.cssText = "display: flex; flex-direction: column; gap: 4px;";

  for (const field of ALL_FIELDS) {
    const label = document.createElement("label");
    label.style.cssText = "display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedFields.includes(field);
    checkbox.style.cursor = "pointer";

    checkbox.addEventListener("change", async () => {
      const current = getSelectedFields();
      let updated;
      if (checkbox.checked) {
        // Add field, maintaining order from ALL_FIELDS
        updated = ALL_FIELDS.filter((f) => current.includes(f) || f === field);
      } else {
        updated = current.filter((f) => f !== field);
      }
      await setSetting(SETTINGS.FIELDS, updated.join(","));
      rerender();
    });

    const fieldLabel = document.createElement("span");
    fieldLabel.textContent = field.replace(/_/g, " ");
    label.appendChild(checkbox);
    label.appendChild(fieldLabel);
    fieldsContainer.appendChild(label);
  }
  popover.appendChild(fieldsContainer);

  document.body.appendChild(popover);

  // Close popover when clicking outside
  function closeOnOutsideClick(e) {
    const popoverEl = document.getElementById(POPOVER_ID);
    const gearBtn = document.getElementById(GEAR_BTN_ID);
    if (popoverEl && !popoverEl.contains(e.target) && e.target !== gearBtn) {
      popoverEl.remove();
      document.removeEventListener("click", closeOnOutsideClick);
    }
  }
  // Store the handler on the popover element so rerender() can clean it up
  popover._closeHandler = closeOnOutsideClick;
  // Defer so the current click event doesn't immediately close it
  setTimeout(() => {
    document.addEventListener("click", closeOnOutsideClick);
  }, 0);
}

function createSectionLabel(text) {
  const label = document.createElement("div");
  label.textContent = text;
  label.style.cssText = "font-weight: bold; margin-bottom: 6px; font-size: 12px; color: #aaa;";
  return label;
}


// ── Re-render helper ──

function rerender() {
  if (!cachedMetadata) return;

  // Close popover before re-rendering, cleaning up the document click listener
  const popover = document.getElementById(POPOVER_ID);
  if (popover && popover._closeHandler) {
    document.removeEventListener("click", popover._closeHandler);
  }
  if (popover) popover.remove();

  const selectedFields = getSelectedFields();
  const text = formatMetadata(cachedMetadata, selectedFields, getDisplayMode());
  if (text) {
    renderOverlay(text);
  } else {
    removeOverlay();
  }

  renderSettingsGear(cachedMetadata);
}


// ── Initialization ──

async function init() {
  const imageInfo = getImageInfoFromPage();
  if (!imageInfo) return;  // Not on the standalone viewer page — bail out

  await loadSettings();

  const metadata = await fetchMetadata(imageInfo);
  if (!metadata) return;

  cachedMetadata = metadata;

  const displayMode = getDisplayMode();
  const selectedFields = getSelectedFields();
  const text = formatMetadata(metadata, selectedFields, displayMode);
  if (!text) return;

  renderOverlay(text);
  renderSettingsGear(metadata);
}

init();
