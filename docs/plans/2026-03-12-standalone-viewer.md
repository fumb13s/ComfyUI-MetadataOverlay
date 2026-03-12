# Standalone Viewer Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a standalone viewer page at `/metadata_overlay/view` that displays any ComfyUI-generated image with its metadata overlay, independent of the ComfyUI SPA. Also add "Open in viewer" and "Copy viewer link" buttons to the SPA overlay so users can easily get the viewer URL.

**Root cause:** When a user navigates directly to `/api/view?filename=...` or right-clicks the lightbox image and opens in a new tab, the browser renders raw PNG bytes against a plain background. The ComfyUI SPA is never loaded, so the metadata overlay extension's JavaScript never executes. There is no lightbox experience and no metadata display.

**Architecture:** Three coordinated changes: (1) Extract shared code into a module, (2) Build a standalone viewer endpoint and JS page, (3) Add viewer link buttons to the SPA overlay. The shared module avoids code duplication between the SPA extension and standalone viewer.

**Tech Stack:** Python (aiohttp routes), Vanilla JS (ES modules), HTML

---

## File Inventory

- **New:** `web/metadata_overlay_shared.js` -- shared constants and formatting functions
- **New:** `web/metadata_overlay_viewer.js` -- standalone viewer page logic
- **Modify:** `web/metadata_overlay.js` -- import shared code, add viewer link buttons
- **Modify:** `__init__.py` -- add `/metadata_overlay/view` endpoint

There are no tests to write -- this is a ComfyUI frontend extension with no test harness. Each task ends with a manual verification step and a commit.

---

## Notation

- **WT** = worktree root = `/home/maurezen/git_tree/ComfyUI-MetadataOverlay/.worktrees/issue12`
- Line references are approximate and will shift as edits accumulate; the plan uses surrounding-context anchors.

---

## Task 1: Create shared JS module (`web/metadata_overlay_shared.js`)

**Files:**
- New: `web/metadata_overlay_shared.js`

**What this does:** Creates a new ES module that exports constants and pure functions needed by both the SPA extension and the standalone viewer. No DOM manipulation code goes here -- only data formatting and URL construction.

**Step 1: Create `web/metadata_overlay_shared.js`**

Create the file with the following exports, extracted from `web/metadata_overlay.js`:

```js
// ── Constants ──

export const ALL_FIELDS = [
  "model", "loras", "sampler", "seed", "prompt",
  "negative_prompt", "guidance", "size",
];

export const DEFAULT_FIELDS = ALL_FIELDS.join(",");

export const OVERLAY_ID = "metadata-overlay-panel";
export const INJECTED_STYLE_ID = "metadata-overlay-injected-style";
export const PANEL_WIDTH = 350;
export const PANEL_HEIGHT = 200;

export const SETTINGS = {
  ENABLED: "MetadataOverlay.Enabled",
  FIELDS: "MetadataOverlay.Fields",
  DISPLAY_MODE: "MetadataOverlay.DisplayMode",
  PANEL_POSITION: "MetadataOverlay.PanelPosition",
  POSITION: "MetadataOverlay.Position",
  OPACITY: "MetadataOverlay.Opacity",
};

export const TRUNCATION_LIMITS = {
  "floating":    { positive: 500,  negative: 300  },
  "side-panel":  { positive: 2000, negative: 1000 },
};

// ── Functions ──

export function parseImageSrc(src) { /* exact copy from metadata_overlay.js */ }

export async function fetchMetadata(imageInfo) { /* exact copy from metadata_overlay.js */ }

export function formatMetadata(metadata, selectedFields, displayMode = "floating") { /* exact copy */ }

export function buildViewerUrl(imageInfo) {
  if (!imageInfo) return null;
  if (imageInfo.type === "view") {
    const params = new URLSearchParams({
      filename: imageInfo.filename,
      type: imageInfo.fileType,
      subfolder: imageInfo.subfolder,
    });
    return `/metadata_overlay/view?${params}`;
  } else if (imageInfo.type === "asset") {
    return `/metadata_overlay/view?asset_id=${encodeURIComponent(imageInfo.assetId)}`;
  }
  return null;
}
```

The functions `parseImageSrc`, `fetchMetadata`, and `formatMetadata` are copied verbatim from `metadata_overlay.js`. `buildViewerUrl` is new. Note that `parseImageSrc` and `fetchMetadata` reference `window.location.origin` and `fetch()`, which are available in both SPA and standalone viewer contexts.

**Step 2: Verify syntax**

Open the file in the browser console or use a linter to confirm no syntax errors. Since this file is not yet imported anywhere, it will not load automatically -- just verify it is syntactically valid JS.

**Step 3: Commit**

```bash
git add web/metadata_overlay_shared.js
git commit -m "feat: create shared JS module with constants and formatting functions"
```

---

## Task 2: Refactor `web/metadata_overlay.js` to import from shared module

**Files:**
- Modify: `web/metadata_overlay.js`

**What this does:** Replaces inline definitions of constants and functions with imports from `metadata_overlay_shared.js`. No behavioral changes -- the extension should work identically before and after this refactor.

**Step 1: Add import statement**

After the existing `import { app }` line (line 1), add:

```js
import {
  ALL_FIELDS, DEFAULT_FIELDS, OVERLAY_ID, INJECTED_STYLE_ID,
  PANEL_WIDTH, PANEL_HEIGHT, SETTINGS, TRUNCATION_LIMITS,
  parseImageSrc, fetchMetadata, formatMetadata, buildViewerUrl,
} from "./metadata_overlay_shared.js";
```

**Step 2: Remove the now-duplicated definitions**

Remove the following from `metadata_overlay.js` since they are now imported:

- `SETTINGS` object (lines 6-13)
- `ALL_FIELDS` array (lines 15-24)
- `DEFAULT_FIELDS` (line 26)
- `OVERLAY_ID` (line 28)
- `INJECTED_STYLE_ID` (line 29)
- `PANEL_WIDTH` (line 30)
- `PANEL_HEIGHT` (line 31)
- `TRUNCATION_LIMITS` object (lines 409-412)
- `parseImageSrc` function (lines 349-383)
- `fetchMetadata` function (lines 385-407)
- `formatMetadata` function (lines 414-480)

Keep:
- `EXTENSION_NAME` (line 3) -- only used in the SPA extension
- All DOM-related functions (`removeOverlay`, `createSidePanel`, `createFloatingOverlay`, `renderOverlay`, `createModeToggleButton`, `handleLightboxImage`, `checkForLightbox`, etc.)
- All settings-related helpers (`getSetting`, `isEnabled`, `getSelectedFields`, `getPosition`, `getOpacity`, `getDisplayMode`, `getPanelPosition`)
- The MutationObserver setup
- The `app.registerExtension` block

**Step 3: Verify the extension still works**

1. Hard-refresh the browser.
2. Open a lightbox image. Confirm the overlay appears with correct metadata.
3. Toggle between side-panel and floating modes. Confirm both work.
4. Navigate between images. Confirm the overlay updates.
5. Close the lightbox. Confirm the overlay is removed.

**Step 4: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "refactor: import shared constants and functions from metadata_overlay_shared.js"
```

---

## Task 3: Add viewer endpoint to `__init__.py`

**Files:**
- Modify: `__init__.py`

**What this does:** Adds a `GET /metadata_overlay/view` route that serves a self-contained HTML page. The HTML loads the standalone viewer JS module and passes image parameters via `data-*` attributes on the body element.

**Step 1: Add the HTML builder function**

Add the following function after `_read_png_metadata` (before the route handlers):

```python
def _build_viewer_html(filename, file_type, subfolder, asset_id=None):
    """Build a self-contained HTML page for the standalone metadata viewer."""
    import html as html_module

    # Build the image URL
    if asset_id:
        image_url = f"/api/assets/{html_module.escape(asset_id)}/content"
        data_attrs = f'data-asset-id="{html_module.escape(asset_id)}"'
    else:
        params = []
        params.append(f"filename={html_module.escape(filename)}")
        params.append(f"type={html_module.escape(file_type)}")
        if subfolder:
            params.append(f"subfolder={html_module.escape(subfolder)}")
        image_url = f"/api/view?{'&'.join(params)}"
        data_attrs = (
            f'data-filename="{html_module.escape(filename)}" '
            f'data-file-type="{html_module.escape(file_type)}" '
            f'data-subfolder="{html_module.escape(subfolder)}"'
        )

    # Determine the extension web directory path.
    # ComfyUI serves extension JS files under /extensions/<dir-name>/
    # The directory name depends on how the extension was installed.
    ext_dir = os.path.basename(os.path.dirname(os.path.abspath(__file__)))

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Metadata Viewer</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html, body {{ width: 100%; height: 100%; background: #1a1a2e; overflow: hidden; }}
        body {{ display: flex; align-items: center; justify-content: center; }}
        #viewer-image {{
            max-width: 100%; max-height: 100%;
            object-fit: contain; display: block;
        }}
        noscript {{
            color: #e0e0e0; font-family: sans-serif; text-align: center;
            padding: 2rem;
        }}
    </style>
</head>
<body {data_attrs} data-image-url="{html_module.escape(image_url)}">
    <noscript>
        <p>JavaScript is required for the metadata viewer.</p>
        <p><a href="{html_module.escape(image_url)}" style="color: #88aaff;">View raw image</a></p>
    </noscript>
    <img id="viewer-image" src="{html_module.escape(image_url)}" alt="Generated image">
    <script type="module" src="/extensions/{html_module.escape(ext_dir)}/metadata_overlay_viewer.js"></script>
</body>
</html>"""
```

Note: All user-provided values are escaped with `html.escape()` to prevent XSS. The extension directory name is determined dynamically so the correct script URL is always generated.

**Step 2: Add the route handler**

Add the route handler after the existing `get_asset_metadata` route:

```python
@PromptServer.instance.routes.get("/metadata_overlay/view")
async def get_viewer_page(request):
    """Serve a standalone HTML viewer page for an image with metadata overlay."""
    asset_id = request.rel_url.query.get("asset_id")
    filename = request.rel_url.query.get("filename")

    if not filename and not asset_id:
        return web.Response(
            text="Bad request: filename or asset_id parameter required",
            status=400,
            content_type="text/plain",
        )

    if asset_id:
        # Validate the asset exists
        try:
            import app.assets.manager as asset_manager

            owner_id = PromptServer.instance.user_manager.get_request_user_id(request)
            abs_path, _, _ = asset_manager.resolve_asset_content_for_download(
                asset_info_id=asset_id, owner_id=owner_id,
            )
        except (ValueError, FileNotFoundError):
            return web.Response(
                text="Asset not found", status=404, content_type="text/plain",
            )
        except Exception as e:
            logger.error("Failed to resolve asset %s: %s", asset_id, e)
            return web.Response(
                text="Failed to resolve asset", status=500, content_type="text/plain",
            )

        html_content = _build_viewer_html("", "", "", asset_id=asset_id)
    else:
        file_type = request.rel_url.query.get("type", "output")
        subfolder = request.rel_url.query.get("subfolder", "")

        file_path = _resolve_file_path(filename, file_type, subfolder)
        if not file_path:
            return web.Response(
                text="File not found", status=404, content_type="text/plain",
            )

        html_content = _build_viewer_html(filename, file_type, subfolder)

    return web.Response(
        text=html_content, content_type="text/html", charset="utf-8",
    )
```

**Step 3: Verify the endpoint**

1. Start ComfyUI.
2. Navigate to `/metadata_overlay/view?filename=some_existing_image.png&type=output` in the browser.
3. Confirm an HTML page is served showing the image against a dark background.
4. Navigate to `/metadata_overlay/view` with no parameters. Confirm a 400 response.
5. Navigate to `/metadata_overlay/view?filename=nonexistent.png`. Confirm a 404 response.

At this stage the viewer JS module doesn't exist yet, so the metadata overlay will not appear, but the page structure and image should load correctly.

**Step 4: Commit**

```bash
git add __init__.py
git commit -m "feat: add /metadata_overlay/view endpoint for standalone viewer page"
```

---

## Task 4: Create viewer JS module (`web/metadata_overlay_viewer.js`)

**Files:**
- New: `web/metadata_overlay_viewer.js`

**What this does:** Creates the standalone viewer page logic. This module reads image parameters from the page's `data-*` attributes, fetches user settings from the ComfyUI REST API, fetches image metadata, and renders a metadata overlay. It also provides a settings gear popover for toggling display mode, changing panel position, adjusting opacity, and selecting fields.

**Design decisions:**
- The viewer module does NOT import `metadata_overlay_shared.js` via a relative path like `./metadata_overlay_shared.js`, because both files are served from `/extensions/<dir-name>/` by ComfyUI, but the HTML page is served from `/metadata_overlay/view`. A relative import from the HTML page's perspective would fail. Instead, the import path is computed at runtime using the `<script>` element's `src` attribute to determine the base URL.
- Settings are read via `GET /api/settings` and written via `POST /api/settings/{id}`.
- The viewer provides its own DOM rendering code that is structurally parallel to the SPA's `createSidePanel()` and `createFloatingOverlay()` but adapted for the standalone context (no galleria DOM, no MutationObserver, full-page layout).

**Step 1: Create `web/metadata_overlay_viewer.js`**

Create the file with the following structure:

```js
// Determine the base URL of this script to resolve sibling module imports.
// This script is loaded from /extensions/<dir>/metadata_overlay_viewer.js
// but the page is served from /metadata_overlay/view, so relative imports
// like ./metadata_overlay_shared.js would resolve against the wrong base.
const scriptUrl = new URL(import.meta.url);
const scriptDir = scriptUrl.pathname.substring(0, scriptUrl.pathname.lastIndexOf("/") + 1);

const {
  ALL_FIELDS, DEFAULT_FIELDS, SETTINGS, TRUNCATION_LIMITS,
  PANEL_WIDTH, PANEL_HEIGHT,
  parseImageSrc, fetchMetadata, formatMetadata, buildViewerUrl,
} = await import(`${scriptDir}metadata_overlay_shared.js`);


// ── Settings access via REST API ──

let settingsCache = null;

async function loadSettings() {
  try {
    const resp = await fetch("/api/settings");
    if (resp.ok) {
      settingsCache = await resp.json();
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


// ── Overlay rendering ──

// ... (side panel and floating overlay creation functions,
//      structurally parallel to the SPA's versions but adapted
//      for standalone page layout -- no galleria, just body-level
//      flex container with the image)


// ── Settings gear popover ──

// A small gear icon button in the top-right corner that opens a
// popover with controls for:
// - Display mode toggle (side-panel / floating)
// - Panel position (adaptive / left / right / top / bottom)
// - Opacity slider
// - Field checkboxes
// Changes are persisted via setSetting() and the overlay re-renders.


// ── Initialization ──

async function init() {
  await loadSettings();

  const imageInfo = getImageInfoFromPage();
  if (!imageInfo) return;

  const metadata = await fetchMetadata(imageInfo);
  if (!metadata) return;

  const displayMode = getSetting(SETTINGS.DISPLAY_MODE, "side-panel");
  const selectedFields = getSelectedFields();
  const text = formatMetadata(metadata, selectedFields, displayMode);
  if (!text) return;

  renderOverlay(text, metadata);
  renderSettingsGear(metadata);
}

init();
```

The full implementation details for the DOM rendering and settings popover are described below.

**Overlay rendering for standalone viewer:**

The standalone viewer page layout is simpler than the SPA: there is no galleria mask, no PrimeVue components, just a body containing the `#viewer-image` element. The overlay attaches to the body, similar to the SPA, but the image constraint CSS targets `#viewer-image` instead of `.p-galleria-item img`.

For side-panel mode:
- Create a panel `<div>` fixed to the chosen edge.
- Add CSS to constrain `#viewer-image` so it doesn't overlap the panel.
- Panel styles: dark background, monospace font, scrollable content.

For floating mode:
- Create a floating `<div>` at the chosen corner position.
- No image constraint CSS needed.

A `renderOverlay(text, metadata)` function dispatches to the correct renderer based on display mode. When settings change, the overlay is torn down and rebuilt.

**Settings gear popover:**

- A small gear icon (`\u2699`) button in the top-right corner of the page (not inside the overlay panel).
- Clicking it toggles a popover with:
  - Display mode: two radio-style buttons ("Side Panel" / "Floating").
  - Panel position: dropdown or radio group.
  - Opacity: an `<input type="range">` slider.
  - Fields: checkboxes for each field in `ALL_FIELDS`.
- Each control calls `setSetting()` on change and triggers a re-render.
- The popover closes when clicking outside it.

**Step 2: Verify the standalone viewer**

1. Start ComfyUI.
2. Navigate to `/metadata_overlay/view?filename=<existing_image>.png&type=output`.
3. Confirm the image loads and the metadata overlay appears.
4. Click the settings gear. Confirm the popover opens with correct current settings.
5. Toggle display mode. Confirm the overlay switches between side-panel and floating.
6. Change panel position. Confirm the panel moves.
7. Adjust opacity. Confirm the background transparency changes.
8. Toggle field checkboxes. Confirm the displayed fields update.
9. Reload the page. Confirm the settings persisted (same mode, position, etc.).

**Step 3: Commit**

```bash
git add web/metadata_overlay_viewer.js
git commit -m "feat: create standalone viewer JS module with settings popover"
```

---

## Task 5: Add viewer link buttons to SPA overlay

**Files:**
- Modify: `web/metadata_overlay.js`

**What this does:** Adds two buttons to the overlay panel header area, next to the existing mode toggle button:
1. **"Open in viewer"** -- opens the standalone viewer in a new tab
2. **"Copy viewer link"** -- copies the viewer URL to the clipboard

Both buttons compute the viewer URL using `buildViewerUrl()` from the shared module.

**Step 1: Create a button factory function**

Add a helper function near `createModeToggleButton()`:

```js
/**
 * Create a small action button with consistent styling.
 * @param {string} icon - Unicode character for the button
 * @param {string} tooltip - Title/tooltip text
 * @param {function} onClick - Click handler
 * @param {number} rightOffset - Distance from right edge in px
 */
function createActionButton(icon, tooltip, onClick, rightOffset) {
  const btn = document.createElement("button");
  btn.textContent = icon;
  btn.title = tooltip;
  btn.style.cssText = `
    position: absolute;
    top: 4px;
    right: ${rightOffset}px;
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
    onClick(e);
  });

  return btn;
}
```

**Step 2: Refactor `createModeToggleButton()` to use `createActionButton()`**

Replace `createModeToggleButton()` to use the factory, keeping its existing logic:

```js
function createModeToggleButton() {
  const currentMode = getDisplayMode();
  const icon = currentMode === "side-panel" ? "\u25a1" : "\u25a0";
  const tooltip = currentMode === "side-panel"
    ? "Switch to floating overlay"
    : "Switch to side panel";

  return createActionButton(icon, tooltip, () => {
    const activeMode = getDisplayMode();
    const newMode = activeMode === "side-panel" ? "floating" : "side-panel";
    app.ui.settings.setSettingValue(SETTINGS.DISPLAY_MODE, newMode);
  }, 4);
}
```

**Step 3: Create viewer link button functions**

```js
function createOpenInViewerButton() {
  return createActionButton("\u2197", "Open in standalone viewer", () => {
    const img = findLightboxImage(document);
    if (!img) return;
    const imageInfo = parseImageSrc(img.src);
    const url = buildViewerUrl(imageInfo);
    if (url) window.open(url, "_blank");
  }, 32);   // 4 (margin) + 24 (toggle btn) + 4 (gap)
}

function createCopyViewerLinkButton() {
  return createActionButton("\u2398", "Copy viewer link", async (e) => {
    const img = findLightboxImage(document);
    if (!img) return;
    const imageInfo = parseImageSrc(img.src);
    const url = buildViewerUrl(imageInfo);
    if (!url) return;

    const fullUrl = new URL(url, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(fullUrl);
      // Brief visual feedback
      const btn = e.currentTarget;
      const origText = btn.textContent;
      btn.textContent = "\u2713";   // checkmark
      setTimeout(() => { btn.textContent = origText; }, 1500);
    } catch {
      // Fallback for non-secure contexts
      prompt("Copy this URL:", fullUrl);
    }
  }, 60);   // 4 + 24 + 4 + 24 + 4
}
```

The unicode characters used:
- `\u2197` = "&#x2197;" (north east arrow) for "Open in viewer"
- `\u2398` = "&#x2398;" (next page / clipboard icon) for "Copy viewer link"
- `\u2713` = "&#x2713;" (checkmark) for copy confirmation

Note: if the actual Unicode glyphs don't render well across platforms, consider using simple ASCII text like `[V]` and `[C]` instead, or SVG inline icons. The implementer should test and adjust.

**Step 4: Add buttons to both overlay renderers**

In `createSidePanel()`, after `panel.appendChild(createModeToggleButton());`, add:

```js
panel.appendChild(createOpenInViewerButton());
panel.appendChild(createCopyViewerLinkButton());
```

In `createFloatingOverlay()`, after `overlay.appendChild(createModeToggleButton());`, add:

```js
overlay.appendChild(createOpenInViewerButton());
overlay.appendChild(createCopyViewerLinkButton());
```

**Step 5: Verify the buttons**

1. Hard-refresh the browser.
2. Open a lightbox image in side-panel mode. Confirm three buttons appear in the top-right of the panel: mode toggle, open-in-viewer, copy-viewer-link.
3. Click "Open in viewer". Confirm a new tab opens with the standalone viewer page showing the same image with metadata.
4. Click "Copy viewer link". Confirm the URL is copied to clipboard. Paste it somewhere and verify it is a valid `/metadata_overlay/view?...` URL.
5. Switch to floating mode. Confirm all three buttons appear and work.
6. Test with an asset-based image (if available). Confirm the viewer URL uses `asset_id`.

**Step 6: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: add 'Open in viewer' and 'Copy viewer link' buttons to SPA overlay"
```

---

## Task 6: End-to-end verification

**Files:**
- Modify: any file (only if issues found)

**What this does:** Full manual test pass across all scenarios.

**Step 1: Test matrix**

| # | Scenario | Expected Behavior |
|---|---|---|
| 1 | Navigate to `/metadata_overlay/view?filename=existing.png&type=output` | Viewer page loads with image and metadata overlay |
| 2 | Navigate to `/metadata_overlay/view?filename=nonexistent.png` | 404 response |
| 3 | Navigate to `/metadata_overlay/view` (no params) | 400 response |
| 4 | Viewer page: toggle display mode via settings gear | Overlay switches between side-panel and floating |
| 5 | Viewer page: change panel position | Panel moves to selected edge |
| 6 | Viewer page: adjust opacity | Background transparency changes |
| 7 | Viewer page: toggle field checkboxes | Displayed metadata fields update |
| 8 | Viewer page: reload after changing settings | Settings persist |
| 9 | SPA: open lightbox, click "Open in viewer" | New tab opens with viewer page for same image |
| 10 | SPA: open lightbox, click "Copy viewer link" | URL copied to clipboard, checkmark appears briefly |
| 11 | SPA: navigate between images, then click viewer buttons | Viewer URL matches currently displayed image |
| 12 | SPA: all existing functionality still works | Overlay display, mode toggle, navigation, settings -- all unchanged |
| 13 | Viewer page: image without metadata (non-PNG or PNG without workflow) | Image displays but no overlay appears |
| 14 | Viewer page: browser back/forward navigation | Page functions correctly |
| 15 | SPA: refactored imports work correctly | No console errors, all constants and functions resolve |

**Step 2: Cross-browser check**

Verify in at least Chrome and Firefox:
- ES module dynamic `import()` works in the viewer
- `navigator.clipboard.writeText()` works on localhost
- Unicode button icons render correctly

**Step 3: Fix any issues found**

If any test fails, fix the code and re-test.

**Step 4: Commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```

---

## Summary of Changes

After all tasks are complete, the following changes will have been made:

| File | Status | Purpose |
|---|---|---|
| `web/metadata_overlay_shared.js` | **New** | Shared constants, `parseImageSrc()`, `fetchMetadata()`, `formatMetadata()`, `buildViewerUrl()` |
| `web/metadata_overlay_viewer.js` | **New** | Standalone viewer page logic: settings via REST, overlay rendering, settings gear popover |
| `web/metadata_overlay.js` | **Modified** | Imports from shared module; `createActionButton()` factory; `createOpenInViewerButton()`, `createCopyViewerLinkButton()` |
| `__init__.py` | **Modified** | `_build_viewer_html()` function; `GET /metadata_overlay/view` route |

| Function/Symbol | File | Status | Purpose |
|---|---|---|---|
| `ALL_FIELDS` | shared | **Moved** | List of metadata field names |
| `DEFAULT_FIELDS` | shared | **Moved** | Comma-joined default field string |
| `OVERLAY_ID` | shared | **Moved** | DOM id for the overlay element |
| `INJECTED_STYLE_ID` | shared | **Moved** | DOM id for injected style element |
| `PANEL_WIDTH`, `PANEL_HEIGHT` | shared | **Moved** | Panel dimension constants |
| `SETTINGS` | shared | **Moved** | Setting ID strings |
| `TRUNCATION_LIMITS` | shared | **Moved** | Prompt truncation limits per display mode |
| `parseImageSrc()` | shared | **Moved** | Parse image URL into info object |
| `fetchMetadata()` | shared | **Moved** | Fetch metadata from API |
| `formatMetadata()` | shared | **Moved** | Format metadata into display text |
| `buildViewerUrl()` | shared | **New** | Construct standalone viewer URL from image info |
| `createActionButton()` | SPA | **New** | Generic action button factory |
| `createOpenInViewerButton()` | SPA | **New** | Button to open standalone viewer |
| `createCopyViewerLinkButton()` | SPA | **New** | Button to copy viewer URL |
| `_build_viewer_html()` | Python | **New** | Generate standalone viewer HTML |
| `get_viewer_page()` | Python | **New** | Route handler for `/metadata_overlay/view` |

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Extension web directory name mismatch | Low | Python endpoint dynamically determines correct path via `os.path.basename(os.path.dirname(__file__))` |
| `navigator.clipboard.writeText` requires secure context | Low | Localhost is secure context; `prompt()` fallback for remote access |
| HTML injection via query parameters | High (if unmitigated) | All embedded values escaped with `html.escape()` |
| Dynamic `import()` path resolution | Medium | Compute base URL from `import.meta.url` to resolve sibling modules correctly |
| Viewer JS module fails to load (wrong path) | Medium | `<noscript>` fallback with link to raw image; inline diagnostic possible |
| Unicode button icons not rendering on all platforms | Low | Can fall back to ASCII text if needed; test during verification |
| Settings REST API format mismatch | Low | ComfyUI's `/api/settings` is a stable public API; same format used by all extensions |
| Shared module import breaks SPA extension | Medium | Task 2 is a pure refactor with no behavioral changes; thorough verification before proceeding |

---

## Design Decisions and Alternatives Considered

**Why a shared module instead of duplicating code?**
The formatting logic (field selection, truncation limits, metadata formatting) must stay consistent between the SPA overlay and the standalone viewer. A shared module is the cleanest way to achieve this. The alternative (duplicating code) would lead to drift over time.

**Why dynamic `import()` in the viewer instead of a static `import` statement?**
The viewer HTML is served from `/metadata_overlay/view`, but the JS files live under `/extensions/<dir>/`. A static `import "./metadata_overlay_shared.js"` in the viewer module would resolve relative to the HTML page's URL, not the script's URL. Using `import.meta.url` to compute the absolute path avoids this problem.

**Why not modify `/api/view` to serve HTML?**
The `/api/view` endpoint is a core ComfyUI endpoint that many tools depend on returning raw image bytes. Modifying it would break external tooling. A separate endpoint at `/metadata_overlay/view` is safe and independent.

**Why settings via REST API in the viewer instead of localStorage?**
Using the same ComfyUI settings API ensures settings are shared between the SPA and standalone viewer. If a user configures their preferred display mode in the SPA, the standalone viewer uses the same setting. localStorage would create a separate, disconnected settings store.

**Why a settings gear popover instead of a simpler toggle?**
The standalone viewer has no access to ComfyUI's settings UI. Without a settings popover, users would have no way to change display mode, panel position, opacity, or field selection from the viewer page. The gear icon is unobtrusive and provides full control.
