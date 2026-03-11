# Metadata Overlay Navigation Update Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the metadata overlay update when the user navigates between images in the ComfyUI lightbox using arrow keys or on-screen buttons.

**Root cause:** ComfyUI's `ResultGallery.vue` renders gallery items with `:key="item.url"`, which causes Vue to destroy the old `<ComfyImage>` component and create a new one on navigation. The `src` attribute is never changed on an existing element -- a new `<img>` element replaces the old one. The MutationObserver's attribute-change path never fires, and the childList path only recognizes `.p-galleria-mask` being added (lightbox open), not new `<img>` elements within an already-open galleria.

**Architecture:** The fix is entirely within the MutationObserver callback and `handleLightboxImage()`. The childList handler gains an additional branch that detects new image-related DOM nodes inside an already-open galleria. A debounced `scheduleCheck()` replaces direct `setTimeout(checkForLightbox, 100)` calls to coalesce rapid mutations. `handleLightboxImage()` gains two guards: it clears the stale overlay before fetching, and it verifies the lightbox still shows the same image after the async fetch completes.

**Tech Stack:** Vanilla JS (ComfyUI extension API), DOM MutationObserver

---

## File Inventory

Only one file is modified throughout this plan:

- **Modify:** `web/metadata_overlay.js` (the entire extension)

There are no tests to write -- this is a ComfyUI frontend extension with no test harness. Each task ends with a manual verification step and a commit.

---

## Notation

- **WT** = worktree root = `/home/maurezen/git_tree/ComfyUI-MetadataOverlay/.worktrees/issue11`
- **FILE** = `web/metadata_overlay.js` (all edits target this file)
- Line references like `:42` refer to current line numbers and will shift as edits accumulate; the plan uses surrounding-context anchors so the implementer can find the right spot even after drift.

---

## Task 1: Add helper functions and debounced `scheduleCheck()`

**Files:**
- Modify: `web/metadata_overlay.js` -- add new functions before `app.registerExtension` (currently line 593)

**What this does:** Adds two small helper functions (`isNodeInsideGalleriaItem` and `nodeContainsImage`) used by the MutationObserver to detect image navigation events, plus a debounced `scheduleCheck()` that coalesces rapid DOM mutations into a single `checkForLightbox()` call.

**Step 1: Add helper functions**

Insert immediately before `app.registerExtension({` (line 593), after the `checkForLightbox()` function:

```js
/**
 * Check whether a DOM node is inside the galleria's active item area.
 */
function isNodeInsideGalleriaItem(node) {
  return node.closest?.(".p-galleria-item") != null;
}

/**
 * Check whether a DOM node is or contains an <img> element.
 */
function nodeContainsImage(node) {
  if (node.tagName === "IMG") return true;
  return node.querySelector?.("img") != null;
}
```

**Step 2: Add debounced `scheduleCheck()`**

Insert immediately after the two helpers added above, still before `app.registerExtension`:

```js
let checkPending = false;

/**
 * Schedule a debounced call to checkForLightbox().
 * Multiple calls within 100ms collapse into one, preventing redundant
 * metadata fetches when Vue replaces DOM elements in rapid succession.
 */
function scheduleCheck() {
  if (checkPending) return;
  checkPending = true;
  setTimeout(() => {
    checkPending = false;
    checkForLightbox();
  }, 100);
}
```

**Step 3: Replace the existing `setTimeout(checkForLightbox, 100)` with `scheduleCheck()`**

In the MutationObserver callback (currently around line 710), find:

```js
              // Small delay to let the image src populate
              setTimeout(checkForLightbox, 100);
```

Replace with:

```js
              scheduleCheck();
```

**Step 4: Verify no syntax errors**

Open ComfyUI in a browser, open DevTools console, hard-refresh. Confirm no JS errors from `metadata_overlay.js`. Open a lightbox image -- confirm the overlay still appears correctly (this tests that `scheduleCheck()` works as a drop-in replacement for the direct `setTimeout` call).

**Step 5: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: add helper functions and debounced scheduleCheck for navigation detection"
```

---

## Task 2: Detect image replacement in the MutationObserver

**Files:**
- Modify: `web/metadata_overlay.js` -- the `addedNodes` loop inside the MutationObserver callback (currently around lines 700-714)

**What this does:** Adds a second detection branch in the `addedNodes` loop. When the lightbox is already open (`.p-galleria-mask` exists in the DOM) and a new node is added that is or contains an `<img>` inside `.p-galleria-item`, it calls `scheduleCheck()` to refresh the overlay. This handles Vue's element-replacement behavior during navigation.

**Step 1: Add the image-replacement detection branch**

Find the `addedNodes` loop in the MutationObserver callback. Currently it looks like this (after Task 1's edit):

```js
        if (mutation.addedNodes.length) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Check if this is a galleria mask or contains one
            if (
              node.classList?.contains("p-galleria-mask") ||
              node.querySelector?.(".p-galleria-mask") ||
              node.querySelector?.(".p-galleria")
            ) {
              scheduleCheck();
              return;
            }
          }
        }
```

Replace the entire `if (mutation.addedNodes.length)` block with:

```js
        if (mutation.addedNodes.length) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            // Check if this is a galleria mask or contains one (lightbox opening)
            if (
              node.classList?.contains("p-galleria-mask") ||
              node.querySelector?.(".p-galleria-mask") ||
              node.querySelector?.(".p-galleria")
            ) {
              scheduleCheck();
              return;
            }
            // Check for image replacement inside an already-open galleria
            // (Vue destroys and recreates <ComfyImage> on navigation)
            if (
              document.querySelector(".p-galleria-mask") &&
              nodeContainsImage(node) &&
              isNodeInsideGalleriaItem(node)
            ) {
              scheduleCheck();
              return;
            }
          }
        }
```

The logic:
1. `document.querySelector(".p-galleria-mask")` -- confirms the lightbox is currently open.
2. `nodeContainsImage(node)` -- confirms the added node involves an `<img>`.
3. `isNodeInsideGalleriaItem(node)` -- confirms it is inside the galleria's item display area, not in a thumbnail strip or other galleria sub-component.

The `return` after `scheduleCheck()` prevents processing further mutations in this batch, since we have already scheduled a check.

**Step 2: Verify image navigation updates the overlay**

1. Hard-refresh browser.
2. Generate two or more images in ComfyUI.
3. Open the first image in the lightbox. Confirm the overlay appears with correct metadata.
4. Navigate to the next image using the right arrow key or on-screen button.
5. Confirm the overlay updates to show the new image's metadata.
6. Navigate back to the first image. Confirm the overlay updates again.

**Step 3: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "feat: detect image replacement during lightbox navigation"
```

---

## Task 3: Clear stale overlay before fetching new metadata

**Files:**
- Modify: `web/metadata_overlay.js` -- `handleLightboxImage()` function (currently lines 553-581)

**What this does:** Calls `removeOverlay()` immediately when a new image is detected, before the async `fetchMetadata()` call. This prevents the old image's metadata from persisting while the new image's metadata is being fetched, which is especially important if the new image has no metadata (in which case the fetch returns null and no new overlay is created).

**Step 1: Add `removeOverlay()` call before fetch**

Find `handleLightboxImage()`. Currently it reads:

```js
async function handleLightboxImage(img) {
  if (!isEnabled()) return;
  if (!img?.src) return;

  const imageInfo = parseImageSrc(img.src);
  if (!imageInfo) return;

  // Don't re-fetch if overlay already exists for this image
  if (currentOverlay && currentOverlay.dataset.src === img.src) return;

  // New image — clear cached metadata from previous image
  cachedMetadata = null;

  const metadata = await fetchMetadata(imageInfo);
```

Add a `removeOverlay()` call after clearing cached metadata and before the fetch:

```js
async function handleLightboxImage(img) {
  if (!isEnabled()) return;
  if (!img?.src) return;

  const imageInfo = parseImageSrc(img.src);
  if (!imageInfo) return;

  // Don't re-fetch if overlay already exists for this image
  if (currentOverlay && currentOverlay.dataset.src === img.src) return;

  // New image — clear stale overlay and cached metadata from previous image
  cachedMetadata = null;
  removeOverlay();

  const metadata = await fetchMetadata(imageInfo);
```

**Step 2: Verify stale overlay is cleared**

1. Hard-refresh browser.
2. Open an image with metadata in the lightbox.
3. Navigate to a non-PNG image (or an image without metadata).
4. Confirm the old overlay disappears immediately, rather than persisting.

**Step 3: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "fix: clear stale overlay before fetching metadata for new image"
```

---

## Task 4: Add stale-fetch guard after async metadata fetch

**Files:**
- Modify: `web/metadata_overlay.js` -- `handleLightboxImage()` function

**What this does:** After `await fetchMetadata()` returns, re-checks that the lightbox still shows the same image. If the user navigated while the fetch was in-flight, the result is discarded. This prevents a race condition where rapid navigation causes an older fetch to complete after a newer one, overwriting the correct overlay with stale data.

**Step 1: Add the stale-fetch guard**

Find the section in `handleLightboxImage()` after the fetch. Currently (after Task 3's edit):

```js
  const metadata = await fetchMetadata(imageInfo);
  if (!metadata) return;
```

Replace with:

```js
  const metadata = await fetchMetadata(imageInfo);
  if (!metadata) return;

  // Guard against stale fetch: if the user navigated while we were fetching,
  // the lightbox now shows a different image -- discard this result.
  const currentImg = findLightboxImage(document);
  if (!currentImg || currentImg.src !== img.src) return;
```

**Step 2: Verify the guard works under rapid navigation**

1. Hard-refresh browser.
2. Generate several images.
3. Open the lightbox and rapidly press the arrow key to navigate through images.
4. Confirm the overlay shows metadata for the currently visible image, not an earlier one.
5. Confirm no flickering or double-overlay issues.

**Step 3: Commit**

```bash
git add web/metadata_overlay.js
git commit -m "fix: discard stale metadata fetch results after navigation"
```

---

## Task 5: End-to-end verification

**Files:**
- Modify: `web/metadata_overlay.js` (only if issues found)

**What this does:** Full manual test pass across all navigation scenarios.

**Step 1: Test matrix**

Run through each scenario and verify behavior:

| Scenario | Expected Behavior |
|---|---|
| Open lightbox, navigate forward (right arrow) | Overlay updates to new image's metadata |
| Open lightbox, navigate backward (left arrow) | Overlay updates to new image's metadata |
| Navigate to image with no metadata (non-PNG) | Old overlay is removed, no overlay shown |
| Navigate back from no-metadata image to image with metadata | Overlay reappears with correct metadata |
| Rapid navigation (hold arrow key) | Overlay updates to final image, no flicker |
| Open lightbox, navigate, close lightbox | Overlay and injected styles are cleaned up |
| Navigate in side-panel mode | Panel updates with correct metadata and position |
| Navigate in floating overlay mode | Floating overlay updates with correct metadata |
| Toggle display mode during navigation | Mode switches correctly, metadata still correct |
| Open lightbox while extension is disabled | No overlay appears, no errors |
| Enable extension while lightbox is open | Overlay appears for current image |

**Step 2: Verify attribute-change fallback still works**

The attribute-change path (lines 732-744 in the original code) should remain as a fallback. Verify it does not interfere with the new childList detection by checking that only one overlay ever exists at a time.

**Step 3: Fix any issues found**

If any test fails, fix the code and re-test.

**Step 4: Commit (only if fixes were needed)**

```bash
git add web/metadata_overlay.js
git commit -m "fix: address issues found during end-to-end testing"
```

---

## Summary of Changes

After all tasks are complete, the following changes will have been made to `web/metadata_overlay.js`:

| Element | Status | Purpose |
|---|---|---|
| `isNodeInsideGalleriaItem()` | **New** | Check if a node is inside `.p-galleria-item` |
| `nodeContainsImage()` | **New** | Check if a node is or contains an `<img>` |
| `checkPending` variable | **New** | Debounce flag for `scheduleCheck()` |
| `scheduleCheck()` | **New** | Debounced wrapper around `checkForLightbox()` |
| MutationObserver `addedNodes` loop | **Modified** | Added image-replacement detection branch |
| MutationObserver `setTimeout` call | **Modified** | Replaced with `scheduleCheck()` |
| `handleLightboxImage()` | **Modified** | Added `removeOverlay()` before fetch, stale-fetch guard after fetch |

All other functions remain unchanged. The attribute-change detection path is kept as a fallback.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `.p-galleria-item` class name changes in PrimeVue update | Low | Stable PrimeVue class; attribute-change fallback remains |
| ComfyUI changes `<ComfyImage>` to reuse the same element (no key) | Low | Attribute-change path would then handle it; both paths coexist |
| Performance impact from broader node checking in MutationObserver | Very low | O(1) checks: `closest()` and tag name comparison; debounce prevents rapid re-checks |
| Race condition with rapid navigation | Medium | Addressed by stale-fetch guard (Task 4) and debounce (Task 1) |
| `document.querySelector(".p-galleria-mask")` in hot path | Very low | Single selector call, fast; only runs when `addedNodes` mutation fires with element nodes |
