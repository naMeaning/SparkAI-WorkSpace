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
const MAPPING_PORTS = Object.freeze({
  image: ["LoadImage.image"], prompt: ["CLIPTextEncode.text"], negative: ["CLIPTextEncode.text"],
  model: ["CheckpointLoaderSimple.ckpt_name"], seed: ["KSampler.seed"],
  width: ["EmptyLatentImage.width"], height: ["EmptyLatentImage.height"]
});
module.exports = { CORE_NODES, MAPPING_PORTS };
