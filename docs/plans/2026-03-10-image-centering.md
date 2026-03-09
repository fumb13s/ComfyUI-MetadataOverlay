# Plan: Side panel does not push image off-center (Issue #4)

## Problem

In side panel mode, the `injectPanelStyles()` function constrains the lightbox image's `max-width` or `max-height` to make room for the panel. However, the image remains centered in the full viewport because the galleria container's flexbox layout still spans the entire viewport. The panel overlaps or crowds the image instead of the image shifting into the remaining space.

## Root Cause

The injected CSS only targets the `img` element inside `.p-galleria-mask .p-galleria-item`:
- For left/right panels: `max-width: calc(100vw - PANEL_WIDTH px)`
- For top/bottom panels: `max-height: calc(100vh - PANEL_HEIGHT px)`

But the `.p-galleria-item` container (which uses flexbox centering via `justify-content: center` and `align-items: center`) still occupies the full viewport. So the image is constrained in size but still centered in the full viewport area, not in the remaining space beside the panel.

## Solution

Modify `injectPanelStyles()` to also add padding to the `.p-galleria-item` container so that its effective layout area is reduced by the panel's dimensions. This will shift the image's centering context to exclude the panel area.

Specifically:
- For **left** panel: add `padding-left: PANEL_WIDTH px` to `.p-galleria-mask .p-galleria-item`
- For **right** panel: add `padding-right: PANEL_WIDTH px` to `.p-galleria-mask .p-galleria-item`
- For **top** panel: add `padding-top: PANEL_HEIGHT px` to `.p-galleria-mask .p-galleria-item`
- For **bottom** panel: add `padding-bottom: PANEL_HEIGHT px` to `.p-galleria-mask .p-galleria-item`

This padding on the flex container shifts the centering context so the image centers within the remaining space. Combined with the existing `max-width`/`max-height` constraints on the image, this achieves the desired behavior.

We also need to ensure `box-sizing: border-box` is set on the container so the padding is included within its full-viewport dimensions rather than expanding it beyond.

## Tasks

### Task 1: Update `injectPanelStyles()` to add container padding

**File:** `web/metadata_overlay.js`

Modify the `injectPanelStyles()` function to inject additional CSS rules that add padding to `.p-galleria-mask .p-galleria-item` corresponding to the panel position and dimensions.

**Changes:**
1. For left/right panels, add a rule for the container with box-sizing and padding.
2. For top/bottom panels, add a rule for the container with box-sizing and padding.
3. Keep the existing `max-width`/`max-height` constraints on the image as-is.

**Acceptance criteria:**
- When a side panel is displayed on the right, the image centers in the left portion of the viewport
- When a side panel is displayed on the left, the image centers in the right portion
- When a side panel is displayed on top, the image centers in the lower portion
- When a side panel is displayed on bottom, the image centers in the upper portion
- The image does not overflow into the panel area
- Switching panel positions (including adaptive) correctly updates the centering
- Floating overlay mode is unaffected
