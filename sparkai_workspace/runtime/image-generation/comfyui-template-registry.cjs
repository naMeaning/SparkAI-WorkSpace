"use strict";

// Only stock `nodes` classes reviewed for the first local adapter. Custom
// nodes remain refused even if the local server advertises them.
const CORE_NODES = Object.freeze({
  CheckpointLoaderSimple: { inputs: { ckpt_name: "file" }, outputs: ["MODEL", "CLIP", "VAE"] },
  CLIPTextEncode: { inputs: { text: "text", clip: "CLIP" }, outputs: ["CONDITIONING"] },
  EmptyLatentImage: { inputs: { width: "dimension", height: "dimension", batch_size: "batch" }, outputs: ["LATENT"] },
  KSampler: { inputs: { model: "MODEL", positive: "CONDITIONING", negative: "CONDITIONING", latent_image: "LATENT", seed: "seed", steps: "steps", cfg: "cfg", sampler_name: "choice", scheduler: "choice", denoise: "denoise" }, outputs: ["LATENT"] },
  VAEDecode: { inputs: { samples: "LATENT", vae: "VAE" }, outputs: ["IMAGE"] },
  VAEEncode: { inputs: { pixels: "IMAGE", vae: "VAE" }, outputs: ["LATENT"] },
  VAELoader: { inputs: { vae_name: "file" }, outputs: ["VAE"] },
  LoadImage: { inputs: { image: "file" }, outputs: ["IMAGE", "MASK"] },
  SaveImage: { inputs: { images: "IMAGE", filename_prefix: "prefix" }, outputs: [], outputNode: true },
  PreviewImage: { inputs: { images: "IMAGE" }, outputs: [], outputNode: true }
});

// Bumping this value changes the reviewed template contract.  It is included
// in every template hash so a policy change is rejected before a prompt is
// posted to ComfyUI.
const TEMPLATE_SCHEMA_VERSION = 2;
const TEMPLATE_POLICY_VERSION = "comfyui-core-v2";
const MAPPING_PORTS = Object.freeze({
  image: ["LoadImage.image"], prompt: ["CLIPTextEncode.text"], negative: ["CLIPTextEncode.text"],
  model: ["CheckpointLoaderSimple.ckpt_name"], seed: ["KSampler.seed"],
  steps: ["KSampler.steps"], cfg: ["KSampler.cfg"], sampler: ["KSampler.sampler_name"],
  scheduler: ["KSampler.scheduler"], denoise: ["KSampler.denoise"],
  width: ["EmptyLatentImage.width"], height: ["EmptyLatentImage.height"]
});
module.exports = { CORE_NODES, MAPPING_PORTS, TEMPLATE_SCHEMA_VERSION, TEMPLATE_POLICY_VERSION };
