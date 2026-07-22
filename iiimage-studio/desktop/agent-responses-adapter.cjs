"use strict";

function agentModelUsesResponsesApi(model = "") {
  return /^gpt-5\.(?:5|6)(?:[-.:]|$)/i.test(String(model || "").trim());
}

function responsesContentPartFromChat(part = {}) {
  if (typeof part === "string") return { type: "input_text", text: part };
  const type = String(part?.type || "");
  if (type === "input_text") return { type: "input_text", text: String(part.text || "") };
  if (type === "text") return { type: "input_text", text: String(part.text || "") };
  if (type === "input_image") {
    const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    return {
      type: "input_image",
      image_url: String(imageUrl || ""),
      ...(part.detail ? { detail: part.detail } : {})
    };
  }
  if (type === "image_url") {
    const source = part.image_url;
    const imageUrl = typeof source === "string" ? source : source?.url;
    const detail = typeof source === "object" ? source?.detail : part.detail;
    return {
      type: "input_image",
      image_url: String(imageUrl || ""),
      ...(detail ? { detail } : {})
    };
  }
  const text = String(part?.text ?? part?.content ?? "");
  return text ? { type: "input_text", text } : null;
}

function responsesInputFromChatMessages(messages = []) {
  const input = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || "user");
    if (role === "responses_items") {
      for (const item of Array.isArray(message?.items) ? message.items : []) {
        const normalized = responsesInputItemFromOutput(item);
        if (normalized) input.push(normalized);
      }
      continue;
    }
    if (role === "tool") {
      const rawOutput = message?.content;
      const output = Array.isArray(rawOutput)
        ? rawOutput.map(responsesContentPartFromChat).filter((part) => part && ["input_text", "input_image"].includes(part.type))
        : typeof rawOutput === "string"
          ? rawOutput
          : JSON.stringify(rawOutput ?? {});
      input.push({
        type: "function_call_output",
        call_id: String(message?.tool_call_id || message?.call_id || ""),
        output
      });
      continue;
    }

    if (Array.isArray(message?.responses_output) && message.responses_output.length) {
      for (const item of message.responses_output) {
        const normalized = responsesInputItemFromOutput(item);
        if (normalized) input.push(normalized);
      }
      continue;
    }

    const rawContent = message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map(responsesContentPartFromChat).filter(Boolean)
      : String(rawContent ?? "");
    if ((typeof content === "string" && content) || (Array.isArray(content) && content.length)) {
      input.push({ role: role === "system" ? "developer" : role, content });
    }

    for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
      const name = String(call?.function?.name || call?.name || "").trim();
      if (!name) continue;
      const rawArguments = call?.function?.arguments ?? call?.arguments ?? {};
      input.push({
        type: "function_call",
        call_id: String(call?.id || call?.call_id || `${name}-${input.length}`),
        name,
        arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments)
      });
    }
  }
  return input;
}

function responsesInputItemFromOutput(item = {}) {
  const type = String(item?.type || "");
  if (type === "message") {
    const content = (Array.isArray(item.content) ? item.content : []).map((part) => {
      const partType = String(part?.type || "");
      if (partType === "output_text") return { type: "output_text", text: String(part.text || "") };
      return responsesContentPartFromChat(part);
    }).filter(Boolean);
    return content.length ? { type, role: String(item.role || "assistant"), content } : null;
  }
  if (type === "reasoning") {
    if (!item.encrypted_content) return null;
    return {
      type,
      ...(item.id ? { id: String(item.id) } : {}),
      summary: Array.isArray(item.summary) ? item.summary : [],
      encrypted_content: String(item.encrypted_content)
    };
  }
  if (type === "function_call") {
    const name = String(item.name || "").trim();
    const callId = String(item.call_id || item.id || "").trim();
    if (!name || !callId) return null;
    return {
      type,
      call_id: callId,
      name,
      arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
    };
  }
  if (type === "function_call_output") {
    const callId = String(item.call_id || "").trim();
    if (!callId) return null;
    const output = Array.isArray(item.output)
      ? item.output.map(responsesContentPartFromChat).filter((part) => part && ["input_text", "input_image"].includes(part.type))
      : typeof item.output === "string"
        ? item.output
        : JSON.stringify(item.output ?? {});
    return { type, call_id: callId, output };
  }
  if (type === "web_search_call") {
    return {
      type,
      ...(item.id ? { id: String(item.id) } : {}),
      ...(item.status ? { status: String(item.status) } : {}),
      ...(item.action && typeof item.action === "object" ? { action: item.action } : {})
    };
  }
  if (["compaction", "context_compaction"].includes(type) && item.encrypted_content) {
    return { type, ...(item.id ? { id: String(item.id) } : {}), encrypted_content: String(item.encrypted_content) };
  }
  return null;
}

function responsesToolsFromChatTools(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .map((tool) => {
      if (String(tool?.type || "") === "web_search") {
        const allowedKeys = ["search_context_size", "filters", "user_location", "external_web_access", "indexed_web_access", "search_content_types"];
        return Object.fromEntries([
          ["type", "web_search"],
          ...allowedKeys.filter((key) => tool[key] !== undefined).map((key) => [key, tool[key]])
        ]);
      }
      const fn = tool?.function || tool;
      const name = String(fn?.name || "").trim();
      if (!name) return null;
      return {
        type: "function",
        name,
        description: String(fn?.description || ""),
        parameters: fn?.parameters || { type: "object", properties: {} },
        ...(typeof fn?.strict === "boolean" ? { strict: fn.strict } : {})
      };
    })
    .filter(Boolean);
}

function responsesToolChoiceFromChat(choice) {
  if (!choice || typeof choice === "string") return choice || "auto";
  const name = String(choice?.function?.name || choice?.name || "").trim();
  return name ? { type: "function", name } : "auto";
}

function responsesRequestFromChatRequest(requestBody = {}) {
  const tools = responsesToolsFromChatTools(requestBody.tools);
  const reasoningEffort = String(requestBody.reasoning_effort || "").trim();
  const responseBody = {
    model: requestBody.model,
    input: responsesInputFromChatMessages(requestBody.messages),
    stream: Boolean(requestBody.stream),
    store: false,
    parallel_tool_calls: requestBody.parallel_tool_calls !== false,
    include: ["reasoning.encrypted_content"],
    ...(tools.length ? { tools, tool_choice: responsesToolChoiceFromChat(requestBody.tool_choice) } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(requestBody.service_tier ? { service_tier: requestBody.service_tier } : {})
  };
  if (requestBody.max_output_tokens !== undefined) responseBody.max_output_tokens = requestBody.max_output_tokens;
  if (requestBody.metadata !== undefined) responseBody.metadata = requestBody.metadata;
  return responseBody;
}

module.exports = {
  agentModelUsesResponsesApi,
  responsesContentPartFromChat,
  responsesInputFromChatMessages,
  responsesInputItemFromOutput,
  responsesRequestFromChatRequest,
  responsesToolChoiceFromChat,
  responsesToolsFromChatTools
};
