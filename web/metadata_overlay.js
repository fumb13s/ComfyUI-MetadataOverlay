import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "ComfyUI.MetadataOverlay";

// Setting IDs
const SETTINGS = {
  ENABLED: "MetadataOverlay.Enabled",
  FIELDS: "MetadataOverlay.Fields",
  DISPLAY_MODE: "MetadataOverlay.DisplayMode",
  PANEL_POSITION: "MetadataOverlay.PanelPosition",
  POSITION: "MetadataOverlay.Position",
  OPACITY: "MetadataOverlay.Opacity",
};

const ALL_FIELDS = [
  "model",
  "loras",
  "sampler",
  "seed",
  "prompt",
  "negative_prompt",
  "guidance",
  "size",
];

const DEFAULT_FIELDS = ALL_FIELDS.join(",");

const OVERLAY_ID = "metadata-overlay-panel";
const INJECTED_STYLE_ID = "metadata-overlay-injected-style";
const PANEL_WIDTH = 350;
const PANEL_HEIGHT = 200;

let currentOverlay = null;
let observer = null;

function getSetting(id, defaultValue) {
  try {
    const val = app.ui.settings.getSettingValue(id);
    return val !== undefined && val !== null ? val : defaultValue;
  } catch {
    return defaultValue;
  }
}

function isEnabled() {
  return getSetting(SETTINGS.ENABLED, true);
}

function getSelectedFields() {
  const raw = getSetting(SETTINGS.FIELDS, DEFAULT_FIELDS);
  if (!raw) return ALL_FIELDS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getPosition() {
  return getSetting(SETTINGS.POSITION, "bottom-left");
}

function getOpacity() {
  return getSetting(SETTINGS.OPACITY, 0.8);
}

function getDisplayMode() {
  return getSetting(SETTINGS.DISPLAY_MODE, "side-panel");
}

function getPanelPosition() {
  return getSetting(SETTINGS.PANEL_POSITION, "adaptive");
}

/**
 * Determine the best panel position based on image vs viewport aspect ratios.
 * If the image is wider relative to the viewport, a vertical (top/bottom)
 * panel costs less area; if taller, a horizontal (left/right) panel costs less.
 *
 * Returns "right" or "bottom".
 */
function computeAdaptivePosition() {
  const img = findLightboxImage(document);
  if (!img || !img.naturalWidth || !img.naturalHeight) return "right";

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const imageAspect = img.naturalWidth / img.naturalHeight;
  const viewportAspect = vw / vh;

  // If image is wider than viewport proportionally, vertical panel is cheaper
  if (imageAspect > viewportAspect) {
    return "bottom";
  }
  return "right";
}

/**
 * Resolve the effective panel position, replacing "adaptive" with a concrete value.
 */
function resolveEffectivePanelPosition() {
  const pos = getPanelPosition();
  if (pos === "adaptive") return computeAdaptivePosition();
  return pos;
}

function removePanelStyles() {
  const existing = document.getElementById(INJECTED_STYLE_ID);
  if (existing) existing.remove();
}

/**
 * Inject a <style> element that constrains the galleria image to make room
 * for the side panel.
 *
 * @param {"left"|"right"|"top"|"bottom"} panelPosition
 */
function injectPanelStyles(panelPosition) {
  removePanelStyles();

  const style = document.createElement("style");
  style.id = INJECTED_STYLE_ID;

  if (panelPosition === "left" || panelPosition === "right") {
    style.textContent = `
      .p-galleria-mask .p-galleria-item img {
        max-width: calc(100vw - ${PANEL_WIDTH}px) !important;
      }
    `;
  } else {
    // top or bottom
    style.textContent = `
      .p-galleria-mask .p-galleria-item img {
        max-height: calc(100vh - ${PANEL_HEIGHT}px) !important;
      }
    `;
  }

  document.head.appendChild(style);
}

/**
 * Create a small toggle button that switches between side-panel and floating modes.
 * Returns the button DOM element.
 */
function createModeToggleButton() {
  const btn = document.createElement("button");
  const currentMode = getDisplayMode();
  const icon = currentMode === "side-panel" ? "\u25a1" : "\u25a0"; // □ = side-panel active, ■ = floating active
  const tooltip =
    currentMode === "side-panel"
      ? "Switch to floating overlay"
      : "Switch to side panel";

  btn.textContent = icon;
  btn.title = tooltip;
  btn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(255, 255, 255, 0.15);
    color: #e0e0e0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    width: 24px;
    height: 24px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    z-index: 10002;
  `;

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(255, 255, 255, 0.3)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(255, 255, 255, 0.15)";
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const newMode = currentMode === "side-panel" ? "floating" : "side-panel";
    app.ui.settings.setSettingValue(SETTINGS.DISPLAY_MODE, newMode);
    // The onChange handler for DISPLAY_MODE will trigger re-render
  });

  return btn;
}

/**
 * Create a side panel anchored to a viewport edge. The image is shrunk via
 * injected CSS so the panel never overlaps it.
 *
 * @param {string} text - Formatted metadata text
 */
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
    // top or bottom
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

  panel.appendChild(createModeToggleButton());

  // Append to the galleria mask so it's scoped to lightbox lifetime
  const mask = document.querySelector(".p-galleria-mask");
  if (mask) {
    mask.appendChild(panel);
  } else {
    document.body.appendChild(panel);
  }

  currentOverlay = panel;
}

/**
 * Extract image URL info for fetching metadata.
 * Returns { type: 'view' | 'asset', params } or null.
 */
function parseImageSrc(src) {
  if (!src) return null;

  try {
    const url = new URL(src, window.location.origin);

    // /view?filename=...&type=...&subfolder=...
    if (url.pathname === "/view" || url.pathname.endsWith("/view")) {
      const filename = url.searchParams.get("filename");
      if (filename) {
        return {
          type: "view",
          filename,
          fileType: url.searchParams.get("type") || "output",
          subfolder: url.searchParams.get("subfolder") || "",
        };
      }
    }

    // /api/assets/{uuid}/content
    const assetMatch = url.pathname.match(
      /\/api\/assets\/([0-9a-fA-F-]{36})\/content/
    );
    if (assetMatch) {
      return {
        type: "asset",
        assetId: assetMatch[1],
      };
    }
  } catch {
    // ignore parse errors
  }

  return null;
}

async function fetchMetadata(imageInfo) {
  try {
    let url;
    if (imageInfo.type === "view") {
      const params = new URLSearchParams({
        filename: imageInfo.filename,
        type: imageInfo.fileType,
        subfolder: imageInfo.subfolder,
      });
      url = `/metadata_overlay/image_metadata?${params}`;
    } else if (imageInfo.type === "asset") {
      url = `/metadata_overlay/asset_metadata?asset_id=${encodeURIComponent(imageInfo.assetId)}`;
    } else {
      return null;
    }

    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function formatMetadata(metadata, selectedFields) {
  const lines = [];

  if (selectedFields.includes("model") && metadata.model) {
    lines.push(`Model: ${metadata.model}`);
  }

  if (selectedFields.includes("loras") && metadata.loras?.length) {
    for (const lora of metadata.loras) {
      let s = `LoRA: ${lora.name}`;
      if (lora.strength_model !== undefined) {
        s += ` (model: ${lora.strength_model}`;
        if (
          lora.strength_clip !== undefined &&
          lora.strength_clip !== lora.strength_model
        ) {
          s += `, clip: ${lora.strength_clip}`;
        }
        s += ")";
      }
      lines.push(s);
    }
  }

  if (selectedFields.includes("sampler")) {
    const parts = [];
    if (metadata.sampler) parts.push(metadata.sampler);
    if (metadata.scheduler) parts.push(metadata.scheduler);
    if (metadata.steps) parts.push(`${metadata.steps} steps`);
    if (metadata.cfg !== null && metadata.cfg !== undefined)
      parts.push(`cfg ${metadata.cfg}`);
    if (metadata.denoise !== null && metadata.denoise !== undefined)
      parts.push(`denoise ${metadata.denoise}`);
    if (parts.length) lines.push(`Sampler: ${parts.join(", ")}`);
  }

  if (selectedFields.includes("seed") && metadata.seed !== null && metadata.seed !== undefined) {
    lines.push(`Seed: ${metadata.seed}`);
  }

  if (selectedFields.includes("guidance") && metadata.guidance !== null && metadata.guidance !== undefined) {
    lines.push(`Guidance: ${metadata.guidance}`);
  }

  if (selectedFields.includes("size") && metadata.size) {
    lines.push(`Size: ${metadata.size}`);
  }

  if (selectedFields.includes("prompt") && metadata.positive_prompt) {
    const text =
      metadata.positive_prompt.length > 500
        ? metadata.positive_prompt.slice(0, 500) + "..."
        : metadata.positive_prompt;
    lines.push(`Prompt: ${text}`);
  }

  if (selectedFields.includes("negative_prompt") && metadata.negative_prompt) {
    const text =
      metadata.negative_prompt.length > 300
        ? metadata.negative_prompt.slice(0, 300) + "..."
        : metadata.negative_prompt;
    lines.push(`Negative: ${text}`);
  }

  return lines.join("\n");
}

function createOverlay(text, container) {
  removeOverlay();

  const position = getPosition();
  const opacity = getOpacity();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `
    position: absolute;
    ${position.includes("bottom") ? "bottom: 16px" : "top: 16px"};
    ${position.includes("left") ? "left: 16px" : "right: 16px"};
    background: rgba(0, 0, 0, ${opacity});
    color: #e0e0e0;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 12px;
    line-height: 1.5;
    padding: 12px 16px;
    border-radius: 8px;
    max-width: 40%;
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

  overlay.textContent = text;
  container.appendChild(overlay);
  currentOverlay = overlay;
}

function removeOverlay() {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  // Also clean up any orphaned overlays
  document.querySelectorAll(`#${OVERLAY_ID}`).forEach((el) => el.remove());
}

/**
 * Find the fullscreen lightbox image element.
 * ComfyUI uses PrimeVue's Galleria component with class `p-galleria`.
 */
function findLightboxImage(root) {
  // Look for galleria component (PrimeVue fullscreen gallery)
  const galleria =
    root?.querySelector?.(".p-galleria") ||
    document.querySelector(".p-galleria");

  if (!galleria) return null;

  // Check if it's in fullscreen mode by looking for the mask/overlay
  const isFullscreen =
    galleria.closest(".p-galleria-mask") ||
    galleria.classList.contains("p-galleria-fullscreen") ||
    document.querySelector(".p-galleria-mask");

  if (!isFullscreen) return null;

  // Find the main image within the galleria
  const img =
    galleria.querySelector(".p-galleria-item img") ||
    galleria.querySelector(".galleria-image") ||
    galleria.querySelector("img.comfy-image-main") ||
    galleria.querySelector("img");

  return img;
}

/**
 * Find the appropriate container to attach our overlay to.
 */
function findOverlayContainer(img) {
  // Try to find the galleria item container (positioned element)
  const galleriaItem = img.closest(".p-galleria-item");
  if (galleriaItem) {
    galleriaItem.style.position = "relative";
    return galleriaItem;
  }

  // Fall back to the galleria mask
  const mask = img.closest(".p-galleria-mask");
  if (mask) return mask;

  // Last resort: use parent
  const parent = img.parentElement;
  if (parent) {
    parent.style.position = "relative";
    return parent;
  }

  return document.body;
}

async function handleLightboxImage(img) {
  if (!isEnabled()) return;
  if (!img?.src) return;

  const imageInfo = parseImageSrc(img.src);
  if (!imageInfo) return;

  // Don't re-fetch if overlay already exists for this image
  if (currentOverlay && currentOverlay.dataset.src === img.src) return;

  const metadata = await fetchMetadata(imageInfo);
  if (!metadata) return;

  const selectedFields = getSelectedFields();
  const text = formatMetadata(metadata, selectedFields);
  if (!text) return;

  const container = findOverlayContainer(img);
  createOverlay(text, container);
  if (currentOverlay) {
    currentOverlay.dataset.src = img.src;
  }
}

function checkForLightbox() {
  const img = findLightboxImage(document);
  if (img) {
    handleLightboxImage(img);
  } else {
    removeOverlay();
  }
}

app.registerExtension({
  name: EXTENSION_NAME,

  setup() {
    // Register settings
    app.ui.settings.addSetting({
      id: SETTINGS.ENABLED,
      name: "Enable metadata overlay",
      category: ["Metadata Overlay", "General", "Enable"],
      tooltip: "Show generation metadata on fullscreen image preview",
      type: "boolean",
      defaultValue: true,
      onChange: (value) => {
        if (!value) removeOverlay();
        else checkForLightbox();
      },
    });

    app.ui.settings.addSetting({
      id: SETTINGS.FIELDS,
      name: "Visible fields",
      category: ["Metadata Overlay", "General", "Fields"],
      tooltip:
        "Comma-separated list of fields to show: model, loras, sampler, seed, prompt, negative_prompt, guidance, size",
      type: "text",
      defaultValue: DEFAULT_FIELDS,
      onChange: () => {
        // Re-render if overlay is visible
        if (currentOverlay) {
          const src = currentOverlay.dataset.src;
          removeOverlay();
          const img = findLightboxImage(document);
          if (img && img.src === src) handleLightboxImage(img);
        }
      },
    });

    app.ui.settings.addSetting({
      id: SETTINGS.POSITION,
      name: "Overlay position",
      category: ["Metadata Overlay", "General", "Position"],
      type: "combo",
      defaultValue: "bottom-left",
      options: [
        { text: "Bottom Left", value: "bottom-left" },
        { text: "Bottom Right", value: "bottom-right" },
        { text: "Top Left", value: "top-left" },
        { text: "Top Right", value: "top-right" },
      ],
      onChange: () => {
        if (currentOverlay) {
          const src = currentOverlay.dataset.src;
          removeOverlay();
          const img = findLightboxImage(document);
          if (img && img.src === src) handleLightboxImage(img);
        }
      },
    });

    app.ui.settings.addSetting({
      id: SETTINGS.OPACITY,
      name: "Background opacity",
      category: ["Metadata Overlay", "General", "Opacity"],
      tooltip: "Background opacity of the overlay (0.3 = more transparent, 1.0 = opaque)",
      type: "slider",
      defaultValue: 0.8,
      attrs: {
        min: 0.3,
        max: 1.0,
        step: 0.05,
      },
      onChange: () => {
        if (currentOverlay) {
          const src = currentOverlay.dataset.src;
          removeOverlay();
          const img = findLightboxImage(document);
          if (img && img.src === src) handleLightboxImage(img);
        }
      },
    });

    // Set up MutationObserver to detect lightbox open/close
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check added nodes for lightbox
        if (mutation.addedNodes.length) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Check if this is a galleria mask or contains one
            if (
              node.classList?.contains("p-galleria-mask") ||
              node.querySelector?.(".p-galleria-mask") ||
              node.querySelector?.(".p-galleria")
            ) {
              // Small delay to let the image src populate
              setTimeout(checkForLightbox, 100);
              return;
            }
          }
        }

        // Check removed nodes for lightbox closing
        if (mutation.removedNodes.length) {
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (
              node.classList?.contains("p-galleria-mask") ||
              node.querySelector?.(".p-galleria-mask") ||
              node.id === OVERLAY_ID
            ) {
              removeOverlay();
              return;
            }
          }
        }

        // Also detect attribute changes on images (src change = navigation)
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "src" &&
          mutation.target?.tagName === "IMG"
        ) {
          const img = findLightboxImage(document);
          if (img && img === mutation.target) {
            removeOverlay();
            handleLightboxImage(img);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  },
});
