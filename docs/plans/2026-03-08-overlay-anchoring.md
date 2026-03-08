# Overlay Anchoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a side-panel display mode that anchors the metadata overlay outside the image area, plus refactor the existing overlay into a floating mode -- both modes accessible via a toggle button.

**Architecture:** The single `createOverlay()` function is replaced by two rendering paths: `createSidePanel()` (injects a `<style>` element to shrink the image via `max-width`/`max-height` overrides, then positions a fixed panel on the freed edge) and `createFloatingOverlay()` (current behavior but switched to `position: fixed`). `handleLightboxImage()` dispatches to the correct path based on a new `DisplayMode` setting. A small toggle button inside both renderers lets the user switch modes without opening settings.

**Tech Stack:** Vanilla JS (ComfyUI extension API), DOM manipulation, CSS injection

---

## File Inventory

Only one file is modified throughout this plan:

- **Modify:** `web/metadata_overlay.js` (the entire extension)

There are no tests to write -- this is a ComfyUI frontend extension with no test harness. Each task ends with a manual verification step and a commit.

---

## Notation

- **WT** = worktree root = `/home/maurezen/git_tree/ComfyUI-MetadataOverlay/.worktrees/issue1`
- **FILE** = `web/metadata_overlay.js` (all edits target this file)
- Line references like `:42` refer to current line numbers and will shift as edits accumulate; the plan uses surrounding-context anchors so the implementer can find the right spot even after drift.

---

## Task 1: Add new setting constants and getter functions

**Files:**
- Modify: `web/metadata_overlay.js` -- SETTINGS object (lines 6-11), new getters near existing getters (lines 40-59)

**What this does:** Extends the SETTINGS constant with three new IDs (`DISPLAY_MODE`, `PANEL_POSITION`, and keeps the existing `POSITION`). Adds two new getter functions. Adds two new constants for panel dimensions.

**Step 1: Add setting IDs to the SETTINGS object**

Find the existing SETTINGS object and add two new entries:

```js
const SETTINGS = {
  ENABLED: "MetadataOverlay.Enabled",
  FIELDS: "MetadataOverlay.Fields",
  DISPLAY_MODE: "MetadataOverlay.DisplayMode",
  PANEL_POSITION: "MetadataOverlay.PanelPosition",
  POSITION: "MetadataOverlay.Position",
  OPACITY: "MetadataOverlay.Opacity",
};
```

**Step 2: Add panel dimension constants**

After the `OVERLAY_ID` constant (line 26), add:

```js
const INJECTED_STYLE_ID = "metadata-overlay-injected-style";
const PANEL_WIDTH = 350;
const PANEL_HEIGHT = 200;
```

**Step 3: Add getter functions**

After the existing `getOpacity()` function (around line 59), add:

```js
function getDisplayMode() {
  return getSetting(SETTINGS.DISPLAY_MODE, "side-panel");
}

function getPanelPosition() {
  return getSetting(SETTINGS.PANEL_POSITION, "adaptive");
}
```

**Step 4: Verify no syntax errors**

Open ComfyUI in a browser, open DevTools console, hard-refresh. Confirm no JS errors from `metadata_overlay.js`. The extension should still work exactly as before since nothing calls the new functions yet.

**Step 5: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: add setting constants and getters for display mode and panel position"
```

---

## Task 2: Add `computeAdaptivePosition()` function

**Files:**
- Modify: `web/metadata_overlay.js` -- add new function after `getPanelPosition()`

**What this does:** Implements the adaptive algorithm that compares image aspect ratio to viewport aspect ratio to decide whether a horizontal (left/right) or vertical (top/bottom) panel would shrink the image less.

**Step 1: Add the function**

Insert after `getPanelPosition()`:

```js
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
```

**Step 2: Add a helper to resolve panel position (handles "adaptive")**

Insert immediately after `computeAdaptivePosition()`:

```js
/**
 * Resolve the effective panel position, replacing "adaptive" with a concrete value.
 */
function resolveEffectivePanelPosition() {
  const pos = getPanelPosition();
  if (pos === "adaptive") return computeAdaptivePosition();
  return pos;
}
```

**Step 3: Verify no syntax errors**

Hard-refresh browser, confirm no console errors.

**Step 4: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: add adaptive panel position algorithm"
```

---

## Task 3: Implement `injectPanelStyles()` and `removePanelStyles()`

**Files:**
- Modify: `web/metadata_overlay.js` -- add two new functions after `resolveEffectivePanelPosition()`

**What this does:** `injectPanelStyles()` creates a `<style>` element that overrides `max-width` or `max-height` on the galleria image so PrimeVue's layout engine shrinks the image to make room for the panel. `removePanelStyles()` removes that element.

**Step 1: Add `removePanelStyles()`**

```js
function removePanelStyles() {
  const existing = document.getElementById(INJECTED_STYLE_ID);
  if (existing) existing.remove();
}
```

**Step 2: Add `injectPanelStyles()`**

```js
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
```

**Step 3: Verify no syntax errors**

Hard-refresh browser, confirm no console errors.

**Step 4: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: add CSS injection for side panel image constraint"
```

---

## Task 4: Implement `createModeToggleButton()`

**Files:**
- Modify: `web/metadata_overlay.js` -- add new function after `injectPanelStyles()`

**What this does:** Creates a small button element that, when clicked, toggles the `DisplayMode` setting between `"side-panel"` and `"floating"` and triggers a re-render. This button will be appended inside both the side panel and the floating overlay by their respective creation functions (Tasks 5 and 6).

**Step 1: Add the function**

```js
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
```

**Step 2: Verify no syntax errors**

Hard-refresh browser, confirm no console errors.

**Step 3: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: add mode toggle button for switching display modes"
```

---

## Task 5: Implement `createSidePanel()`

**Files:**
- Modify: `web/metadata_overlay.js` -- add new function, replacing (eventually) the old `createOverlay()`

**What this does:** Creates a `position: fixed` panel on the viewport edge corresponding to the resolved panel position, calls `injectPanelStyles()` to shrink the image, and appends the panel to `.p-galleria-mask`.

**Step 1: Add the function**

Insert after `createModeToggleButton()`:

```js
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
```

**Step 2: Verify no syntax errors**

Hard-refresh browser, confirm no console errors.

**Step 3: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: implement createSidePanel for anchored metadata display"
```

---

## Task 6: Implement `createFloatingOverlay()`

**Files:**
- Modify: `web/metadata_overlay.js` -- add new function after `createSidePanel()`

**What this does:** Refactors the current `createOverlay()` logic to use `position: fixed` instead of `position: absolute`, and appends to `.p-galleria-mask` instead of a container found by `findOverlayContainer()`. Includes the mode toggle button.

**Step 1: Add the function**

```js
/**
 * Create a floating overlay positioned at a viewport corner.
 * This is the refactored version of the original createOverlay().
 * Uses position:fixed so it doesn't depend on a positioned ancestor.
 *
 * @param {string} text - Formatted metadata text
 */
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

  const content = document.createElement("div");
  content.textContent = text;
  overlay.appendChild(content);

  overlay.appendChild(createModeToggleButton());

  // Append to the galleria mask so it's scoped to lightbox lifetime
  const mask = document.querySelector(".p-galleria-mask");
  if (mask) {
    mask.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }

  currentOverlay = overlay;
}
```

**Step 2: Verify no syntax errors**

Hard-refresh browser, confirm no console errors.

**Step 3: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: implement createFloatingOverlay with position:fixed"
```

---

## Task 7: Rewire `handleLightboxImage()` and update `removeOverlay()`

**Files:**
- Modify: `web/metadata_overlay.js` -- `handleLightboxImage()` (lines 292-314), `removeOverlay()` (lines 228-235)

**What this does:** Makes `handleLightboxImage()` dispatch to either `createSidePanel()` or `createFloatingOverlay()` based on the display mode setting. Updates `removeOverlay()` to also call `removePanelStyles()`. Removes the calls to `findOverlayContainer()` and `createOverlay()`.

**Step 1: Update `removeOverlay()`**

Replace the existing `removeOverlay()` function body:

```js
function removeOverlay() {
  if (currentOverlay) {
    currentOverlay.remove();
    currentOverlay = null;
  }
  // Also clean up any orphaned overlays
  document.querySelectorAll(`#${OVERLAY_ID}`).forEach((el) => el.remove());
  removePanelStyles();
}
```

The only change is the added `removePanelStyles()` call at the end.

**Step 2: Update `handleLightboxImage()`**

Replace the function body. The key change is replacing:
```js
const container = findOverlayContainer(img);
createOverlay(text, container);
```

with display-mode dispatch:
```js
const mode = getDisplayMode();
if (mode === "side-panel") {
  createSidePanel(text);
} else {
  createFloatingOverlay(text);
}
```

Full replacement:

```js
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

  const mode = getDisplayMode();
  if (mode === "side-panel") {
    createSidePanel(text);
  } else {
    createFloatingOverlay(text);
  }

  if (currentOverlay) {
    currentOverlay.dataset.src = img.src;
  }
}
```

**Step 3: Verify the new flow works**

1. Hard-refresh browser.
2. Generate an image in ComfyUI and open it in the lightbox.
3. Confirm the side panel appears on the right (or bottom, depending on image aspect ratio) and the image is shrunk to make room.
4. Click the toggle button and confirm it switches to floating overlay mode.
5. Close and reopen the lightbox -- confirm the last-used mode persists.

**Step 4: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: dispatch to side panel or floating overlay based on display mode"
```

---

## Task 8: Delete dead code (`createOverlay`, `findOverlayContainer`)

**Files:**
- Modify: `web/metadata_overlay.js` -- remove two functions

**What this does:** Removes `createOverlay(text, container)` (the original overlay creator) and `findOverlayContainer(img)` (no longer needed since both new renderers append to `.p-galleria-mask` directly). This is pure cleanup -- no behavior change.

**Step 1: Delete `createOverlay()`**

Remove the entire `createOverlay(text, container)` function (currently around lines 192-226, but shifted by prior edits). It starts with `function createOverlay(text, container) {` and ends with the closing `}` after `currentOverlay = overlay;`.

**Step 2: Delete `findOverlayContainer()`**

Remove the entire `findOverlayContainer(img)` function including its JSDoc comment. It starts with `/** * Find the appropriate container...` and ends with `return document.body;` followed by `}`.

**Step 3: Verify no references remain**

Search the file for `createOverlay` and `findOverlayContainer`. Neither should appear anywhere. If either does, it means a call site was missed -- fix it.

**Step 4: Verify no syntax errors**

Hard-refresh browser, confirm no console errors. Open lightbox, confirm overlay still works in both modes.

**Step 5: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "refactor: remove dead code (createOverlay, findOverlayContainer)"
```

---

## Task 9: Register new settings in `setup()`

**Files:**
- Modify: `web/metadata_overlay.js` -- inside `setup()` (lines 328-462)

**What this does:** Adds the `DisplayMode` and `PanelPosition` settings to the ComfyUI settings UI so users can configure them. Both include `onChange` handlers that trigger re-render.

**Step 1: Add DisplayMode setting**

Insert after the `ENABLED` setting registration (after the closing `});` of that `addSetting` call) and before the `FIELDS` setting:

```js
    app.ui.settings.addSetting({
      id: SETTINGS.DISPLAY_MODE,
      name: "Display mode",
      category: ["Metadata Overlay", "General", "Display Mode"],
      tooltip:
        "Side panel pushes the image aside and never overlaps. Floating overlay sits on top of the image.",
      type: "combo",
      defaultValue: "side-panel",
      options: [
        { text: "Side Panel", value: "side-panel" },
        { text: "Floating Overlay", value: "floating" },
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
```

**Step 2: Add PanelPosition setting**

Insert immediately after the `DisplayMode` setting:

```js
    app.ui.settings.addSetting({
      id: SETTINGS.PANEL_POSITION,
      name: "Panel position (side panel mode)",
      category: ["Metadata Overlay", "General", "Panel Position"],
      tooltip:
        "Which edge to place the side panel. Adaptive auto-picks the edge that shrinks the image least.",
      type: "combo",
      defaultValue: "adaptive",
      options: [
        { text: "Adaptive", value: "adaptive" },
        { text: "Left", value: "left" },
        { text: "Right", value: "right" },
        { text: "Top", value: "top" },
        { text: "Bottom", value: "bottom" },
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
```

**Step 3: Verify settings appear in UI**

1. Hard-refresh browser.
2. Open ComfyUI Settings.
3. Navigate to "Metadata Overlay" category.
4. Confirm "Display mode" combo with "Side Panel" and "Floating Overlay" options appears.
5. Confirm "Panel position" combo with "Adaptive", "Left", "Right", "Top", "Bottom" options appears.
6. Change each setting and confirm the overlay re-renders correctly.

**Step 4: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: register display mode and panel position settings in UI"
```

---

## Task 10: End-to-end verification and final cleanup

**Files:**
- Modify: `web/metadata_overlay.js` (only if issues found)

**What this does:** Full manual test pass across all setting combinations.

**Step 1: Test matrix**

Run through each combination and verify behavior:

| Display Mode | Panel/Overlay Position | Expected Behavior |
|---|---|---|
| side-panel | adaptive (landscape img) | Panel on right, image shrunk horizontally |
| side-panel | adaptive (portrait img) | Panel on bottom, image shrunk vertically |
| side-panel | left | Panel on left edge, image shrunk horizontally |
| side-panel | right | Panel on right edge, image shrunk horizontally |
| side-panel | top | Panel on top edge, image shrunk vertically |
| side-panel | bottom | Panel on bottom edge, image shrunk vertically |
| floating | bottom-left | Overlay at bottom-left corner, no image shrink |
| floating | bottom-right | Overlay at bottom-right corner, no image shrink |
| floating | top-left | Overlay at top-left corner, no image shrink |
| floating | top-right | Overlay at top-right corner, no image shrink |

For each row, verify:
- Overlay/panel displays with correct metadata
- Panel does NOT overlap the image (side-panel mode)
- Toggle button works and switches modes
- Closing lightbox removes overlay AND injected style
- Navigating between images in lightbox updates overlay
- Disabling the extension removes everything

**Step 2: Check for style leaks**

1. Open lightbox in side-panel mode.
2. Close lightbox.
3. Inspect `<head>` -- confirm no `<style id="metadata-overlay-injected-style">` element remains.
4. Open lightbox in floating mode -- confirm no injected style element is present.

**Step 3: Fix any issues found**

If any test fails, fix the code and re-test.

**Step 4: Commit (only if fixes were needed)**

```bash
git add web/metadata_overlay.js
git commit -m "fix: address issues found during end-to-end testing"
```

---

## Summary of Functions

After all tasks are complete, the file should contain these functions (in order):

| Function | Status | Purpose |
|---|---|---|
| `getSetting()` | Unchanged | Read a ComfyUI setting |
| `isEnabled()` | Unchanged | Check if extension is enabled |
| `getSelectedFields()` | Unchanged | Get configured metadata fields |
| `getPosition()` | Unchanged | Get floating overlay corner position |
| `getOpacity()` | Unchanged | Get background opacity |
| `getDisplayMode()` | **New** | Get display mode (side-panel or floating) |
| `getPanelPosition()` | **New** | Get panel position setting |
| `computeAdaptivePosition()` | **New** | Auto-pick best panel edge |
| `resolveEffectivePanelPosition()` | **New** | Resolve "adaptive" to concrete position |
| `removePanelStyles()` | **New** | Remove injected `<style>` element |
| `injectPanelStyles()` | **New** | Inject CSS to shrink image for panel |
| `createModeToggleButton()` | **New** | Create mode switch button |
| `createSidePanel()` | **New** | Render side panel mode |
| `createFloatingOverlay()` | **New** | Render floating overlay mode |
| `parseImageSrc()` | Unchanged | Parse image URL |
| `fetchMetadata()` | Unchanged | Fetch metadata from backend |
| `formatMetadata()` | Unchanged | Format metadata as text |
| `removeOverlay()` | **Modified** | Clean up overlay + injected styles |
| `findLightboxImage()` | Unchanged | Find lightbox `<img>` element |
| ~~`findOverlayContainer()`~~ | **Removed** | No longer needed |
| ~~`createOverlay()`~~ | **Removed** | Replaced by two new functions |
| `handleLightboxImage()` | **Modified** | Dispatch to correct renderer |
| `checkForLightbox()` | Unchanged | Entry point from MutationObserver |
