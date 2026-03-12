// ── Constants ──

export const ALL_FIELDS = [
  "model",
  "loras",
  "sampler",
  "seed",
  "prompt",
  "negative_prompt",
  "guidance",
  "size",
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

/**
 * Extract image URL info for fetching metadata.
 * Returns { type: 'view' | 'asset', params } or null.
 */
export function parseImageSrc(src) {
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

export async function fetchMetadata(imageInfo) {
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

export function formatMetadata(metadata, selectedFields, displayMode = "floating") {
  const limits = TRUNCATION_LIMITS[displayMode] || TRUNCATION_LIMITS["floating"];
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
      metadata.positive_prompt.length > limits.positive
        ? metadata.positive_prompt.slice(0, limits.positive) + "..."
        : metadata.positive_prompt;
    lines.push(`Prompt: ${text}`);
  }

  if (selectedFields.includes("negative_prompt") && metadata.negative_prompt) {
    const text =
      metadata.negative_prompt.length > limits.negative
        ? metadata.negative_prompt.slice(0, limits.negative) + "..."
        : metadata.negative_prompt;
    lines.push(`Negative: ${text}`);
  }

  return lines.join("\n");
}

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
