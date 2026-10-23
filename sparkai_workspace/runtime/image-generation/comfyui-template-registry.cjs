"use strict";

// Reviewed stock classes only. Module identities are class-specific; a
// custom node with the same class name is not an approved dependency.
const CORE_NODES = Object.freeze({
  CheckpointLoaderSimple: { inputs: { ckpt_name: "file" }, outputs: ["MODEL", "CLIP", "VAE"] },
  CLIPTextEncode: { inputs: { text: "text", clip: "CLIP" }, outputs: ["CONDITIONING"] },
  EmptyLatentImage: { inputs: { width: "dimension", height: "dimension", batch_size: "batch" }, outputs: ["LATENT"] },
  KSampler: { inputs: { model: "MODEL", positive: "CONDITIONING", negative: "CONDITIONING", latent_image: "LATENT", seed: "seed", steps: "steps", cfg: "cfg", sampler_name: "choice", scheduler: "choice", denoise: "denoise" }, outputs: ["LATENT"] },
  VAEDecode: { inputs: { samples: "LATENT", vae: "VAE" }, outputs: ["IMAGE"] },
  VAEEncode: { inputs: { pixels: "IMAGE", vae: "VAE" }, outputs: ["LATENT"] },
  VAELoader: { inputs: { vae_name: "file" }, outputs: ["VAE"] },
  LoadImage: { inputs: { image: "file" }, outputs: ["IMAGE", "MASK"] },
  LoadImageMask: { inputs: { image: "file", channel: "channel" }, outputs: ["MASK"], modules: ["nodes"] },
  VAEEncodeForInpaint: { inputs: { pixels: "IMAGE", vae: "VAE", mask: "MASK", grow_mask_by: "grow" }, outputs: ["LATENT"], modules: ["nodes"] },
  SetLatentNoiseMask: { inputs: { samples: "LATENT", mask: "MASK" }, outputs: ["LATENT"], modules: ["nodes"] },
  ImageCompositeMasked: { inputs: { destination: "IMAGE", source: "IMAGE", x: "offset", y: "offset", resize_source: "boolean", mask: "MASK" }, outputs: ["IMAGE"], modules: ["comfy_extras.nodes_mask"] },
  MaskToImage: { inputs: { mask: "MASK" }, outputs: ["IMAGE"], modules: ["comfy_extras.nodes_mask"] },
  ImageToMask: { inputs: { image: "IMAGE", channel: "channel" }, outputs: ["MASK"], modules: ["comfy_extras.nodes_mask"] },
  InvertMask: { inputs: { mask: "MASK" }, outputs: ["MASK"], modules: ["comfy_extras.nodes_mask"] },
  JoinImageWithAlpha: { inputs: { image: "IMAGE", alpha: "MASK" }, outputs: ["IMAGE"], modules: ["comfy_extras.nodes_compositing"] },
  SaveImage: { inputs: { images: "IMAGE", filename_prefix: "prefix" }, outputs: [], outputNode: true },
  PreviewImage: { inputs: { images: "IMAGE" }, outputs: [], outputNode: true }
});

// Bumping this value changes the reviewed template contract.  It is included
// in every template hash so a policy change is rejected before a prompt is
// posted to ComfyUI.
const TEMPLATE_SCHEMA_VERSION = 2;
const TEMPLATE_POLICY_VERSION = "comfyui-core-v2";
// Legacy generate/img2img retain their v2 policy/hash. New typed workflows
// explicitly select this policy instead of invalidating historical tasks.
const CAPABILITY_SCHEMA_VERSION = 3;
const CAPABILITY_POLICY_VERSION = "comfyui-capabilities-v3";
const WORKFLOW_CAPABILITIES = Object.freeze(["generate", "img2img", "inpaint", "cutout"]);
const IMAGE_MAPPING_KINDS = Object.freeze(["image", "sourceImage", "maskImage", "referenceImages"]);
const MAPPING_PORTS = Object.freeze({
  image: ["LoadImage.image"], sourceImage: ["LoadImage.image"], maskImage: ["LoadImageMask.image"], referenceImages: ["LoadImage.image"],
  prompt: ["CLIPTextEncode.text"], negative: ["CLIPTextEncode.text"],
  model: ["CheckpointLoaderSimple.ckpt_name"], seed: ["KSampler.seed"],
  steps: ["KSampler.steps"], cfg: ["KSampler.cfg"], sampler: ["KSampler.sampler_name"],
  scheduler: ["KSampler.scheduler"], denoise: ["KSampler.denoise"],
  width: ["EmptyLatentImage.width"], height: ["EmptyLatentImage.height"]
});
module.exports = { CORE_NODES, MAPPING_PORTS, TEMPLATE_SCHEMA_VERSION, TEMPLATE_POLICY_VERSION, CAPABILITY_SCHEMA_VERSION, CAPABILITY_POLICY_VERSION, WORKFLOW_CAPABILITIES, IMAGE_MAPPING_KINDS };
