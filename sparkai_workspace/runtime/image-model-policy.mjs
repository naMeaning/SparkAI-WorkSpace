/** Shared by the Agent runtime and configuration summaries. */
export function preferredImageTaskModel(pool = [], primary = "", explicit = "") {
  const selected = pool.find(model => model.toLowerCase() === String(explicit).toLowerCase());
  const image2 = pool.find(model => /(?:^|[/_.:-])gpt-image-2(?:$|[/_.:-])/i.test(model)) || pool.find(model => /gpt-image-2/i.test(model));
  return explicit ? selected || primary || image2 || pool[0] || "" : image2 || primary || pool[0] || "";
}

export function imageQualityValues(model = "", capabilities, protocol = "") {
  if (capabilities?.supportedQualities?.length) return capabilities.supportedQualities;
  if (protocol === "gemini-native" || !protocol && /gemini/i.test(model)) return ["auto"];
  if (protocol === "xai-images" || !protocol && /grok|xai/i.test(model)) return ["auto", "low", "medium"];
  return ["auto", "low", "medium", "high"];
}
