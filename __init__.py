import os
import json
import logging
from urllib.parse import urlencode

from aiohttp import web
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths
from server import PromptServer

logger = logging.getLogger(__name__)

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


def _resolve_file_path(filename, file_type="output", subfolder=""):
    """Resolve image file path using the same logic as ComfyUI's /view endpoint."""
    filename, output_dir = folder_paths.annotated_filepath(filename)

    if not filename:
        return None

    if filename[0] == "/" or ".." in filename:
        return None

    if output_dir is None:
        output_dir = folder_paths.get_directory_by_type(file_type)

    if output_dir is None:
        return None

    if subfolder:
        full_output_dir = os.path.join(output_dir, subfolder)
        if os.path.commonpath(
            (os.path.abspath(full_output_dir), output_dir)
        ) != output_dir:
            return None
        output_dir = full_output_dir

    filename = os.path.basename(filename)
    file_path = os.path.join(output_dir, filename)

    if os.path.isfile(file_path):
        return file_path
    return None


def _extract_metadata(prompt_data, workflow_data):
    """Extract generation metadata from prompt and workflow JSON."""
    result = {
        "model": None,
        "loras": [],
        "sampler": None,
        "scheduler": None,
        "steps": None,
        "cfg": None,
        "seed": None,
        "positive_prompt": None,
        "negative_prompt": None,
        "guidance": None,
        "denoise": None,
    }

    if not prompt_data:
        return result

    nodes = prompt_data if isinstance(prompt_data, dict) else {}

    # Build a map of node_id -> node for link traversal
    node_map = {}
    for node_id, node_data in nodes.items():
        if isinstance(node_data, dict):
            node_map[node_id] = node_data

    # Extract from each node based on class_type
    sampler_node = None

    for node_id, node_data in node_map.items():
        class_type = node_data.get("class_type", "")
        inputs = node_data.get("inputs", {})

        # Model loaders
        if class_type in (
            "CheckpointLoaderSimple",
            "CheckpointLoader",
            "UNETLoader",
        ):
            ckpt = inputs.get("ckpt_name") or inputs.get("unet_name")
            if ckpt:
                result["model"] = ckpt

        # LoRA loaders
        if class_type in ("LoraLoader", "LoraLoaderModelOnly"):
            lora_name = inputs.get("lora_name")
            if lora_name:
                result["loras"].append({
                    "name": lora_name,
                    "strength_model": inputs.get("strength_model", 1.0),
                    "strength_clip": inputs.get("strength_clip", 1.0),
                })

        # rgthree Lora Loader Stack / Power Lora Loader (numbered slots)
        if class_type in (
            "Lora Loader Stack (rgthree)",
            "Power Lora Loader (rgthree)",
        ):
            for i in range(1, 20):
                lora_key = f"lora_{i:02d}"
                strength_key = f"strength_{i:02d}"
                lora_name = inputs.get(lora_key)
                if lora_name and lora_name != "None":
                    result["loras"].append({
                        "name": lora_name,
                        "strength_model": inputs.get(strength_key, 1.0),
                        "strength_clip": inputs.get(strength_key, 1.0),
                    })

        # Samplers
        if class_type in ("KSampler", "KSamplerAdvanced", "SamplerCustom"):
            sampler_node = node_data
            result["sampler"] = inputs.get("sampler_name")
            result["scheduler"] = inputs.get("scheduler")
            result["steps"] = inputs.get("steps")
            result["cfg"] = inputs.get("cfg")
            seed = inputs.get("seed") or inputs.get("noise_seed")
            if seed is not None:
                result["seed"] = seed
            denoise = inputs.get("denoise")
            if denoise is not None:
                result["denoise"] = denoise

            # SamplerCustom gets sampler from a linked KSamplerSelect node
            if class_type == "SamplerCustom" and result["sampler"] is None:
                sampler_ref = inputs.get("sampler")
                if isinstance(sampler_ref, list) and len(sampler_ref) >= 1:
                    ref_id = str(sampler_ref[0])
                    if ref_id in node_map:
                        ref_node = node_map[ref_id]
                        result["sampler"] = ref_node.get("inputs", {}).get(
                            "sampler_name"
                        )

                # Get steps from linked scheduler node (sigmas input)
                if result["steps"] is None:
                    sigmas_ref = inputs.get("sigmas")
                    if isinstance(sigmas_ref, list) and len(sigmas_ref) >= 1:
                        ref_id = str(sigmas_ref[0])
                        if ref_id in node_map:
                            ref_node = node_map[ref_id]
                            ref_class = ref_node.get("class_type", "")
                            ref_inputs = ref_node.get("inputs", {})
                            result["steps"] = ref_inputs.get("steps")
                            if not result["scheduler"]:
                                result["scheduler"] = ref_class

        # CLIP text encode - need to figure out which is positive/negative
        if class_type in ("CLIPTextEncode", "CLIPTextEncodeFlux"):
            text = inputs.get("text", "")
            if isinstance(text, str) and text:
                # Try to determine if this is positive or negative by tracing connections
                _assign_prompt_text(
                    node_id, text, class_type, inputs, node_map, result
                )

        # Flux guidance
        if class_type == "FluxGuidance":
            guidance_val = inputs.get("guidance")
            if guidance_val is not None:
                result["guidance"] = guidance_val

        # CLIPTextEncodeFlux may also have guidance
        if class_type == "CLIPTextEncodeFlux":
            guidance_val = inputs.get("guidance")
            if guidance_val is not None:
                result["guidance"] = guidance_val

    return result


def _assign_prompt_text(node_id, text, class_type, inputs, node_map, result):
    """Try to determine if a text encode node is positive or negative prompt."""
    # Check if any sampler references this node
    for other_id, other_data in node_map.items():
        other_class = other_data.get("class_type", "")
        other_inputs = other_data.get("inputs", {})

        if other_class not in ("KSampler", "KSamplerAdvanced", "SamplerCustom"):
            continue

        # Check positive input
        positive_ref = other_inputs.get("positive")
        if isinstance(positive_ref, list) and len(positive_ref) >= 1:
            ref_id = str(positive_ref[0])
            if ref_id == str(node_id):
                result["positive_prompt"] = text
                return
            # Check if there's an intermediate conditioning node
            if ref_id in node_map:
                ref_node = node_map[ref_id]
                ref_inputs = ref_node.get("inputs", {})
                conditioning = ref_inputs.get("conditioning") or ref_inputs.get(
                    "input"
                )
                if isinstance(conditioning, list) and str(conditioning[0]) == str(
                    node_id
                ):
                    result["positive_prompt"] = text
                    return

        # Check negative input
        negative_ref = other_inputs.get("negative")
        if isinstance(negative_ref, list) and len(negative_ref) >= 1:
            ref_id = str(negative_ref[0])
            if ref_id == str(node_id):
                result["negative_prompt"] = text
                return
            if ref_id in node_map:
                ref_node = node_map[ref_id]
                ref_inputs = ref_node.get("inputs", {})
                conditioning = ref_inputs.get("conditioning") or ref_inputs.get(
                    "input"
                )
                if isinstance(conditioning, list) and str(conditioning[0]) == str(
                    node_id
                ):
                    result["negative_prompt"] = text
                    return

    # If we couldn't trace it to a sampler, assign to first available slot
    if result["positive_prompt"] is None:
        result["positive_prompt"] = text
    elif result["negative_prompt"] is None:
        result["negative_prompt"] = text


def _build_viewer_html(filename, file_type, subfolder, asset_id=None):
    """Build a self-contained HTML page for the standalone metadata viewer."""
    import html as html_module

    # Build the image URL
    if asset_id:
        image_url = f"/api/assets/{html_module.escape(asset_id)}/content"
        data_attrs = f'data-asset-id="{html_module.escape(asset_id)}"'
    else:
        params = {"filename": filename, "type": file_type}
        if subfolder:
            params["subfolder"] = subfolder
        image_url = f"/api/view?{urlencode(params)}"
        data_attrs = (
            f'data-filename="{html_module.escape(filename)}" '
            f'data-file-type="{html_module.escape(file_type)}" '
            f'data-subfolder="{html_module.escape(subfolder)}"'
        )

    # Determine the extension web directory path.
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


def _read_png_metadata(file_path):
    """Read PNG text chunks and extract generation metadata."""
    try:
        with Image.open(file_path) as img:
            width, height = img.size
            info = img.info or {}

            prompt_raw = info.get("prompt")
            workflow_raw = info.get("workflow")

            prompt_data = None
            workflow_data = None

            if prompt_raw:
                try:
                    prompt_data = json.loads(prompt_raw)
                except (json.JSONDecodeError, TypeError):
                    pass

            if workflow_raw:
                try:
                    workflow_data = json.loads(workflow_raw)
                except (json.JSONDecodeError, TypeError):
                    pass

            metadata = _extract_metadata(prompt_data, workflow_data)
            metadata["size"] = f"{width}x{height}"

            return metadata

    except Exception as e:
        logger.error("Failed to read PNG metadata from %s: %s", file_path, e)
        return None


@PromptServer.instance.routes.get("/metadata_overlay/image_metadata")
async def get_image_metadata(request):
    """API endpoint to extract generation metadata from a PNG image."""
    filename = request.rel_url.query.get("filename")
    if not filename:
        return web.json_response(
            {"error": "filename parameter required"}, status=400
        )

    file_type = request.rel_url.query.get("type", "output")
    subfolder = request.rel_url.query.get("subfolder", "")

    file_path = _resolve_file_path(filename, file_type, subfolder)
    if not file_path:
        return web.json_response({"error": "file not found"}, status=404)

    if not file_path.lower().endswith(".png"):
        return web.json_response(
            {"error": "only PNG files are supported"}, status=400
        )

    metadata = _read_png_metadata(file_path)
    if metadata is None:
        return web.json_response(
            {"error": "failed to read metadata"}, status=500
        )

    return web.json_response(metadata)


@PromptServer.instance.routes.get("/metadata_overlay/asset_metadata")
async def get_asset_metadata(request):
    """API endpoint to extract metadata from an asset by resolving its file path."""
    asset_id = request.rel_url.query.get("asset_id")
    if not asset_id:
        return web.json_response(
            {"error": "asset_id parameter required"}, status=400
        )

    try:
        import app.assets.manager as asset_manager

        owner_id = PromptServer.instance.user_manager.get_request_user_id(request)

        abs_path, content_type, download_name = (
            asset_manager.resolve_asset_content_for_download(
                asset_info_id=asset_id,
                owner_id=owner_id,
            )
        )
    except (ValueError, FileNotFoundError):
        return web.json_response({"error": "asset not found"}, status=404)
    except Exception as e:
        logger.error("Failed to resolve asset %s: %s", asset_id, e)
        return web.json_response(
            {"error": "failed to resolve asset"}, status=500
        )

    if not abs_path.lower().endswith(".png"):
        return web.json_response(
            {"error": "only PNG files are supported"}, status=400
        )

    metadata = _read_png_metadata(abs_path)
    if metadata is None:
        return web.json_response(
            {"error": "failed to read metadata"}, status=500
        )

    return web.json_response(metadata)


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
        try:
            import app.assets.manager as asset_manager

            owner_id = PromptServer.instance.user_manager.get_request_user_id(
                request
            )
            abs_path, _, _ = asset_manager.resolve_asset_content_for_download(
                asset_info_id=asset_id,
                owner_id=owner_id,
            )
        except (ValueError, FileNotFoundError):
            return web.Response(
                text="Asset not found",
                status=404,
                content_type="text/plain",
            )
        except Exception as e:
            logger.error("Failed to resolve asset %s: %s", asset_id, e)
            return web.Response(
                text="Failed to resolve asset",
                status=500,
                content_type="text/plain",
            )
        html_content = _build_viewer_html("", "", "", asset_id=asset_id)
    else:
        file_type = request.rel_url.query.get("type", "output")
        subfolder = request.rel_url.query.get("subfolder", "")
        file_path = _resolve_file_path(filename, file_type, subfolder)
        if not file_path:
            return web.Response(
                text="File not found",
                status=404,
                content_type="text/plain",
            )
        html_content = _build_viewer_html(filename, file_type, subfolder)

    return web.Response(
        text=html_content,
        content_type="text/html",
        charset="utf-8",
    )
