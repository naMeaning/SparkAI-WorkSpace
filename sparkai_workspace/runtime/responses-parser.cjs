"use strict";

function safeJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "json stringify failed" });
  }
}

function responsesTextPart(part = {}) {
  if (typeof part === "string") return part;
  return String(part.text ?? part.output_text ?? part.content ?? part.refusal ?? "");
}

function responseToolCallFromItem(item = {}, index = 0) {
  const type = String(item.type || "");
  if (type && !/(^|_)function_call$|tool_call/i.test(type)) return null;
  const name = String(item.name || item.function?.name || "").trim();
  if (!name) return null;
  const rawArgs = item.arguments ?? item.input ?? item.function?.arguments ?? {};
  return {
    id: String(item.call_id || item.id || `responses-call-${index}`),
    type: "function",
    function: {
      name,
      arguments: typeof rawArgs === "string" ? rawArgs : safeJson(rawArgs)
    }
  };
}

function messageFromResponsesOutput(data) {
  const output = Array.isArray(data?.output) ? data.output : [];
  if (!output.length && !data?.output_text) return null;
  const content = [];
  const outputText = data?.output_text ? String(data.output_text) : "";
  const toolCalls = [];
  output.forEach((item, index) => {
    const type = String(item?.type || "");
    if (type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        const text = responsesTextPart(part);
        if (text) content.push(text);
      }
    } else if (/output_text|text|refusal/i.test(type)) {
      const text = responsesTextPart(item);
      if (text) content.push(text);
    }
    const call = responseToolCallFromItem(item, index);
    if (call) toolCalls.push(call);
  });
  if (!content.length && outputText) content.push(outputText);
  return {
    role: "assistant",
    content: content.join(""),
    tool_calls: toolCalls,
    responses_output: output
  };
}

function messageFromResponse(data) {
  const choice = data?.choices?.[0];
  if (choice?.message) return choice.message;
  const responsesMessage = messageFromResponsesOutput(data);
  if (responsesMessage) return responsesMessage;
  return data?.message ?? { role: "assistant", content: data?.output_text ?? choice?.text ?? "" };
}

function reasoningDeltaFromChunk(chunk = {}) {
  const delta = chunk?.choices?.[0]?.delta ?? chunk?.delta ?? {};
  return (
    delta.reasoning_content ??
    delta.reasoning ??
    delta.reasoning_text ??
    delta.thinking ??
    chunk.reasoning_content ??
    chunk.reasoning ??
    ""
  );
}

function contentDeltaFromChunk(chunk = {}) {
  const eventType = String(chunk.type || "");
  if (/response\.(output_text|refusal)\.delta/i.test(eventType)) return String(chunk.delta ?? "");
  if (/response\.content_part\.delta/i.test(eventType)) return responsesTextPart(chunk.delta ?? chunk.part ?? {});
  const delta = chunk?.choices?.[0]?.delta ?? chunk?.delta ?? {};
  return delta.content ?? chunk.content ?? "";
}

function mergeToolCallDelta(toolCalls, deltaToolCalls = []) {
  for (const item of deltaToolCalls || []) {
    const index = Number.isFinite(Number(item.index)) ? Number(item.index) : toolCalls.length;
    const current = toolCalls[index] ?? { id: "", type: "function", function: { name: "", arguments: "" } };
    const fn = item.function ?? {};
    toolCalls[index] = {
      ...current,
      id: item.id || current.id,
      type: item.type || current.type || "function",
      function: {
        name: fn.name || current.function?.name || "",
        arguments: `${current.function?.arguments || ""}${fn.arguments || ""}`
      }
    };
  }
}

function upsertResponsesToolCall(toolCalls, nextCall, index) {
  const targetIndex = Number.isFinite(Number(index))
    ? Number(index)
    : toolCalls.findIndex((call) => call.id && call.id === nextCall.id);
  const safeIndex = targetIndex >= 0 ? targetIndex : toolCalls.length;
  const current = toolCalls[safeIndex] ?? { id: "", type: "function", function: { name: "", arguments: "" } };
  toolCalls[safeIndex] = {
    ...current,
    id: nextCall.id || current.id || `responses-call-${safeIndex}`,
    type: "function",
    function: {
      name: nextCall.function?.name || current.function?.name || "",
      arguments:
        nextCall.function?.arguments !== undefined && (String(nextCall.function.arguments) || !current.function?.arguments)
          ? String(nextCall.function.arguments)
          : String(current.function?.arguments || "")
    }
  };
}

function mergeResponsesToolCallEvent(toolCalls, chunk = {}) {
  const eventType = String(chunk.type || "");
  const item = chunk.item ?? chunk.output_item;
  const itemCall = responseToolCallFromItem(item, Number(chunk.output_index ?? toolCalls.length));
  if (itemCall) {
    upsertResponsesToolCall(toolCalls, itemCall, chunk.output_index);
    return;
  }
  if (!/function_call_arguments/i.test(eventType)) return;
  const outputIndex = Number(chunk.output_index);
  const byItemId = String(chunk.item_id || chunk.call_id || "");
  const targetIndex = Number.isFinite(outputIndex)
    ? outputIndex
    : toolCalls.findIndex((call) => call.id === byItemId);
  const safeIndex = targetIndex >= 0 ? targetIndex : toolCalls.length;
  const current = toolCalls[safeIndex] ?? {
    id: byItemId || `responses-call-${safeIndex}`,
    type: "function",
    function: { name: "", arguments: "" }
  };
  const doneArgs = chunk.arguments ?? chunk.final_arguments;
  const deltaArgs = chunk.delta ?? "";
  toolCalls[safeIndex] = {
    ...current,
    id: current.id || byItemId || `responses-call-${safeIndex}`,
    type: "function",
    function: {
      name: current.function?.name || "",
      arguments:
        doneArgs !== undefined
          ? String(doneArgs)
          : `${current.function?.arguments || ""}${String(deltaArgs || "")}`
    }
  };
}

function responseFromStreamChunks(chunks = []) {
  let content = "";
  let reasoning = "";
  let model = "";
  let finishReason = "";
  let finalResponse = null;
  const toolCalls = [];
  const responsesOutput = [];
  for (const chunk of chunks) {
    if (chunk?.done) continue;
    if (chunk?.response?.output || chunk?.response?.output_text) finalResponse = chunk.response;
    if (Array.isArray(chunk?.output)) finalResponse = chunk;
    if (chunk?.model) model = chunk.model;
    const choice = chunk?.choices?.[0] ?? {};
    const delta = choice.delta ?? chunk.delta ?? {};
    const contentDelta = contentDeltaFromChunk(chunk);
    const reasoningDelta = reasoningDeltaFromChunk(chunk);
    if (contentDelta) content += contentDelta;
    if (reasoningDelta) reasoning += reasoningDelta;
    if (Array.isArray(delta.tool_calls)) mergeToolCallDelta(toolCalls, delta.tool_calls);
    mergeResponsesToolCallEvent(toolCalls, chunk);
    const outputItem = chunk?.item ?? chunk?.output_item;
    if (outputItem && /output_item\.(?:done|added)/i.test(String(chunk?.type || ""))) {
      const id = String(outputItem.id || outputItem.call_id || `${outputItem.type || "item"}-${chunk.output_index ?? responsesOutput.length}`);
      const index = responsesOutput.findIndex((item) => String(item.id || item.call_id || "") === id);
      if (index >= 0) responsesOutput[index] = outputItem;
      else responsesOutput.push(outputItem);
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  if (finalResponse) {
    const finalMessage = messageFromResponse(finalResponse);
    const finalToolCalls = Array.isArray(finalMessage.tool_calls) && finalMessage.tool_calls.length ? finalMessage.tool_calls : toolCalls;
    return {
      model: finalResponse.model || model,
      choices: [
        {
          finish_reason: finishReason || finalResponse.status || undefined,
          message: {
            role: "assistant",
            content: finalMessage.content || content,
            reasoning_content: finalMessage.reasoning_content || reasoning,
            tool_calls: finalToolCalls.filter((call) => call?.function?.name),
            responses_output: finalMessage.responses_output || finalResponse.output || responsesOutput
          }
        }
      ]
    };
  }
  return {
    model,
    choices: [
      {
        finish_reason: finishReason || undefined,
        message: {
          role: "assistant",
          content,
          reasoning_content: reasoning,
          tool_calls: toolCalls.filter((call) => call?.function?.name),
          responses_output: responsesOutput
        }
      }
    ]
  };
}

module.exports = {
  contentDeltaFromChunk,
  mergeResponsesToolCallEvent,
  mergeToolCallDelta,
  messageFromResponse,
  messageFromResponsesOutput,
  reasoningDeltaFromChunk,
  responseFromStreamChunks,
  responseToolCallFromItem,
  responsesTextPart,
  upsertResponsesToolCall
};
