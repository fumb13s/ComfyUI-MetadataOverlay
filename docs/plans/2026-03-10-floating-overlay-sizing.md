# Fix Floating Overlay Horizontal Flattening (Issue #5)

## Problem

In floating overlay (corner) mode, the overlay uses `max-width: 40%` which scales
with viewport width. As the browser window widens, the overlay expands horizontally
and content reflows into fewer lines, causing the overlay to flatten into a wide,
short strip. There is no minimum height constraint to prevent this.

## Root Cause

In `createFloatingOverlay()` (line 274), the overlay's CSS includes:
- `max-width: 40%` — grows proportionally with viewport width
- No `min-height` — allows arbitrary vertical collapse
- No `max-width` cap in absolute units — no upper bound on pixel width

## Solution

Apply two changes to the floating overlay's inline CSS in `createFloatingOverlay()`:

### Task 1: Cap `max-width` with an absolute pixel limit

Replace:
```css
max-width: 40%;
```
With:
```css
max-width: min(40%, 420px);
```

This keeps the overlay responsive on smaller viewports (40% is fine when the window
is narrow) but caps it at 420px on wide viewports. 420px is chosen because:
- It comfortably fits metadata lines without truncation at 12px monospace font
- It's close to the side panel's `PANEL_WIDTH` of 350px plus padding, giving
  visual consistency between modes
- It prevents the overlay from becoming excessively wide

### Task 2: Add a `min-height` to prevent vertical collapse

Add to the overlay's CSS:
```css
min-height: 120px;
```

This ensures the overlay always maintains a readable vertical extent even when
content would otherwise fit on one or two lines. 120px provides roughly 6-7 lines
at 12px font with 1.5 line-height, which is enough to keep the overlay looking
like a panel rather than a bar.

## Files to Modify

- `web/metadata_overlay.js` — `createFloatingOverlay()` function only

## Verification

Manual testing in ComfyUI:
1. Open lightbox in floating overlay mode
2. Resize browser window to various widths (narrow, normal, very wide)
3. Confirm overlay stays readable at all widths
4. Confirm overlay doesn't flatten into a thin strip on wide viewports
5. Confirm overlay still looks good on narrow viewports (40% rule still applies)
