# Fix: Toggle button click causes overlay to vanish until next image

**Issue:** #3
**Date:** 2026-03-10

## Root Cause Analysis

The overlay vanishes on toggle because of two interacting problems:

### Problem 1: MutationObserver removes the new overlay

When `rerenderOverlay()` calls `removeOverlay()`, the old overlay element is removed
from `document.body`. This DOM mutation is observed by the `MutationObserver` callback.
Although MutationObservers fire asynchronously (as microtasks after the current
synchronous code completes), by the time the observer fires, `rerenderOverlay()` has
already created a NEW overlay. The observer then sees the removed node has
`id === OVERLAY_ID` (line 723 check), treats it as the lightbox closing, and calls
`cachedMetadata = null; removeOverlay();` — which destroys the newly-created overlay.

### Problem 2: Stale closure in toggle button click handler

The `createModeToggleButton()` function captures `currentMode` via closure at button
creation time (line 148). The click handler (line 186) uses this captured value.
While this works correctly for the first click (because the mode IS the value at
creation), if the button were somehow reused without recreation, the closure would be
stale. In practice, the button is recreated each time the overlay is recreated, so
this is a minor robustness issue rather than the primary cause.

## Implementation Plan

### Task 1: Guard the MutationObserver against self-triggered overlay removal

**File:** `web/metadata_overlay.js`

Add a guard flag (e.g., `isRerendering`) that prevents the MutationObserver's removal
handler from acting when the overlay is being intentionally replaced (as opposed to
the lightbox actually closing).

**Changes:**
1. Add a module-level variable `let isRerendering = false;`
2. In `rerenderOverlay()`, set `isRerendering = true` before calling `removeOverlay()`
   and reset it to `false` after `renderOverlay()` completes and dataset attributes
   are set.
3. In `reformatOverlay()`, apply the same guard pattern.
4. In the MutationObserver's `removedNodes` handler, check `if (isRerendering) continue;`
   before the `OVERLAY_ID` check, so that intentional overlay replacement is not treated
   as lightbox close.

### Task 2: Read display mode from setting value, not closure, in toggle click handler

**File:** `web/metadata_overlay.js`

In `createModeToggleButton()`, change the click handler to read the current display
mode at click time instead of using the closure-captured value. This makes the toggle
robust against any scenario where the button's closure becomes stale.

**Changes:**
1. In the click handler (line 184-189), replace `currentMode` reference with a fresh
   call to `getDisplayMode()`.

## Testing

This is a ComfyUI frontend extension with no test harness. Manual testing:
- Open lightbox, verify overlay appears
- Click toggle button, verify overlay switches mode immediately without vanishing
- Click toggle again, verify it switches back
- Navigate to next image, verify overlay updates correctly
- Close and reopen lightbox, verify overlay appears correctly
