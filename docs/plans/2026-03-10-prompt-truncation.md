# Fix Side Panel Prompt Truncation (Issue #6)

## Problem

The `formatMetadata()` function hard-caps positive prompts at 500 characters and
negative prompts at 300 characters, regardless of the display mode. These limits
are appropriate for the compact floating overlay (which has `max-width: 40%` and
`max-height: 50%`), but the side panel has significantly more vertical space
(full viewport height for left/right panels) and the text is already scrollable
via `overflow-y: auto`.

## Design

Make `formatMetadata()` aware of the current display mode and apply different
truncation limits:

- **Floating mode**: Keep existing limits (500 positive, 300 negative) since the
  overlay has constrained dimensions and limited space.
- **Side panel mode**: Use much higher limits (2000 positive, 1000 negative) to
  take advantage of the available space. The panel already has `overflow-y: auto`
  so any content that exceeds visible height will be scrollable.

### Why not remove limits entirely?

Even in side panel mode, extremely long prompts (e.g., 10k+ characters from
concatenated conditioning) could cause performance issues or make the panel
unwieldy. A generous but bounded limit is the safest approach.

## Tasks

### Task 1: Add display mode parameter to formatMetadata()

**File:** `web/metadata_overlay.js`

Modify `formatMetadata()` to accept a third parameter `displayMode` (string,
either `"side-panel"` or `"floating"`).

Define two sets of truncation limits based on the mode:
- Floating: `{ positive: 500, negative: 300 }`
- Side panel: `{ positive: 2000, negative: 1000 }`

Replace the hard-coded 500/300 values with the mode-appropriate limits.

**Spec:**
- `formatMetadata(metadata, selectedFields, "floating")` uses 500/300 limits
- `formatMetadata(metadata, selectedFields, "side-panel")` uses 2000/1000 limits
- `formatMetadata(metadata, selectedFields)` defaults to `"floating"` limits
  (backward compatible)

### Task 2: Pass display mode to formatMetadata() at all call sites

**File:** `web/metadata_overlay.js`

There are three call sites for `formatMetadata()`:

1. `handleLightboxImage()` (line 572) - main rendering path
2. `reformatOverlay()` (line 509) - re-format on field change

Both need to pass the current display mode via `getDisplayMode()`.

**Spec:**
- Both call sites pass `getDisplayMode()` as the third argument
- No call site uses the default (all are explicit)
