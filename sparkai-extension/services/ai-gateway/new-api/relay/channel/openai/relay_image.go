package openai

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

var errOpenAIImageResponseTooLarge = errors.New("upstream image response exceeds the configured size limit")
var errOpenAIImageResponseMissingAsset = errors.New("upstream image response does not contain a usable image asset")
var errOpenAIImageStreamIncomplete = errors.New("upstream image stream ended without a complete usable image result")

func readOpenAIImageResponseBody(body io.Reader) ([]byte, error) {
	megabytes := common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_MAX_RESPONSE_MB", 64)
	if megabytes < 1 {
		megabytes = 1
	}
	if megabytes > 256 {
		megabytes = 256
	}
	limit := int64(megabytes) << 20
	responseBody, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(responseBody)) > limit {
		return nil, errOpenAIImageResponseTooLarge
	}
	return responseBody, nil
}

func openAIImageResponseError(c *gin.Context, resp *http.Response, err error, errorCode types.ErrorCode, statusCode int) *types.NewAPIError {
	if markOpenAIImageOutcomeUnknown(c, resp) {
		return types.NewOpenAIError(err, errorCode, statusCode, types.ErrOptionWithSkipRetry())
	}
	return types.NewOpenAIError(err, errorCode, statusCode)
}

func openAIImageResponseReadError(c *gin.Context, resp *http.Response, err error) *types.NewAPIError {
	if errors.Is(err, errOpenAIImageResponseTooLarge) {
		return openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	return openAIImageResponseError(c, resp, err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
}

func markOpenAIImageOutcomeUnknown(c *gin.Context, resp *http.Response) bool {
	if c != nil && resp != nil && resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		c.Set(common.ManagedImageOutcomeUnknownKey, true)
		return true
	}
	return false
}

func openAIImageResultHasAsset(record gjson.Result) bool {
	for _, field := range []string{"b64_json", "image_base64", "base64", "url"} {
		if strings.TrimSpace(record.Get(field).String()) != "" {
			return true
		}
	}
	return false
}

func openAIImageJSONHasAsset(body []byte, requireDataArray bool) bool {
	payload := gjson.ParseBytes(body)
	if !requireDataArray && openAIImageResultHasAsset(payload) {
		return true
	}
	data := payload.Get("data")
	if !data.IsArray() {
		return false
	}
	for _, item := range data.Array() {
		if openAIImageResultHasAsset(item) {
			return true
		}
	}
	return false
}

func updateOpenAIImageCount(info *relaycommon.RelayInfo, count int64) {
	if info == nil || !info.PriceData.UsePrice || count <= 0 || count > int64(dto.MaxImageN) {
		return
	}
	info.PriceData.AddOtherRatio("n", float64(count))
}

// OpenaiImageHandler handles non-streaming OpenAI image responses
// (generations/edits), returning the parsed usage for billing.
func OpenaiImageHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := readOpenAIImageResponseBody(resp.Body)
	if err != nil {
		return nil, openAIImageResponseReadError(c, resp, err)
	}

	var usageResp dto.SimpleResponse
	err = common.Unmarshal(responseBody, &usageResp)
	if err != nil {
		return nil, openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	if oaiError := usageResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices && !openAIImageJSONHasAsset(responseBody, true) {
		return nil, openAIImageResponseError(c, resp, errOpenAIImageResponseMissingAsset, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}

	updateOpenAIImageCount(info, gjson.GetBytes(responseBody, "data.#").Int())

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	normalizeOpenAIUsage(&usageResp.Usage)
	applyUsagePostProcessing(info, &usageResp.Usage, responseBody)
	return &usageResp.Usage, nil
}

// normalizeOpenAIUsage maps the OpenAI Images usage shape (input_tokens /
// output_tokens / input_tokens_details) onto the canonical prompt/completion
// fields. It is used only on the OpenAI image relay paths (generations/edits,
// streaming and non-streaming): the image API never returns prompt_tokens /
// completion_tokens, so the overwrite (=) semantics here are equivalent to the
// previous additive (+=) behavior while avoiding any future double-counting if
// both field sets are ever populated. Do not reuse this on chat/embedding paths
// without revisiting the overwrite semantics.
func normalizeOpenAIUsage(usage *dto.Usage) {
	if usage == nil {
		return
	}
	if usage.InputTokens != 0 {
		usage.PromptTokens = usage.InputTokens
	}
	if usage.OutputTokens != 0 {
		usage.CompletionTokens = usage.OutputTokens
	}
	if usage.InputTokensDetails != nil {
		usage.PromptTokensDetails.CachedTokens = usage.InputTokensDetails.CachedTokens
		usage.PromptTokensDetails.CachedCreationTokens = usage.InputTokensDetails.CachedCreationTokens
		usage.PromptTokensDetails.CacheWriteTokens = usage.InputTokensDetails.CacheWriteTokens
		usage.PromptTokensDetails.ImageTokens = usage.InputTokensDetails.ImageTokens
		usage.PromptTokensDetails.TextTokens = usage.InputTokensDetails.TextTokens
		usage.PromptTokensDetails.AudioTokens = usage.InputTokensDetails.AudioTokens
	}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
}

func OpenaiImageStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid image stream response")
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return OpenaiImageHandler(c, info, resp)
	}
	if !strings.Contains(contentType, "text/event-stream") {
		return openaiImageJSONAsStreamHandler(c, info, resp)
	}
	// Reuse the shared streaming engine (helper.StreamScannerHandler) so the
	// image streaming path gets the same ping keepalive, streaming-timeout
	// watchdog, client-disconnect detection, panic recovery and goroutine
	// cleanup as every other relay stream. The scanner delivers only the
	// "data:" payload, so the SSE "event:" line is rebuilt from the JSON "type"
	// field (real OpenAI image events keep event == type).
	usage := &dto.Usage{}
	var lastStreamData []byte
	hasImageAsset := false
	var completedImages int64

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		raw := common.StringToByteSlice(data)
		lastStreamData = raw
		if isOpenAIImageStreamErrorEvent(raw) {
			// Record the error as a soft error; the scanner drives the final
			// EndReason. HasErrors() flags the failure for logging/handling.
			sr.Error(fmt.Errorf("%s", extractOpenAIImageStreamErrorMessage(raw)))
		}
		if openAIImageJSONHasAsset(raw, false) {
			hasImageAsset = true
		}
		var chunk struct {
			Type  string    `json:"type"`
			Usage dto.Usage `json:"usage"`
		}
		if err := common.Unmarshal(raw, &chunk); err == nil {
			normalizeOpenAIUsage(&chunk.Usage)
			if service.ValidUsage(&chunk.Usage) {
				usage = &chunk.Usage
			}
			if chunk.Type == "image_generation.completed" || chunk.Type == "image_edit.completed" {
				completedImages++
			}
		}
		if err := writeOpenaiImageStreamChunk(c, raw); err != nil {
			sr.Stop(err)
		}
	})

	// StreamScannerHandler consumes the upstream [DONE]; re-emit it so the
	// client still receives a terminal data: [DONE].
	if info != nil && info.StreamStatus != nil && info.StreamStatus.EndReason == relaycommon.StreamEndReasonDone {
		helper.Done(c)
	}

	if info == nil || info.StreamStatus == nil {
		return nil, openAIImageResponseError(c, resp, errOpenAIImageStreamIncomplete, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	clientAborted := info.StreamStatus.EndReason == relaycommon.StreamEndReasonClientGone ||
		info.StreamStatus.EndReason == relaycommon.StreamEndReasonHandlerStop
	streamFinished := info.StreamStatus.EndReason == relaycommon.StreamEndReasonDone ||
		info.StreamStatus.EndReason == relaycommon.StreamEndReasonEOF
	if clientAborted {
		// The upstream may already have completed and charged the image while the
		// downstream disappeared. Mark the managed replay record ambiguous, but do
		// not surface a relay error to a client that is already gone.
		markOpenAIImageOutcomeUnknown(c, resp)
	} else if !streamFinished || info.StreamStatus.HasErrors() || !hasImageAsset {
		return nil, openAIImageResponseError(c, resp, errOpenAIImageStreamIncomplete, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	applyUsagePostProcessing(info, usage, lastStreamData)
	// Only trust completedImages when upstream finished the stream (done/eof).
	// On client-side aborts (client_gone, or handler_stop from a failed client
	// write) the counter undercounts what upstream actually generated and
	// charged, so keep the requested n — otherwise a client could pay for one
	// image by disconnecting right after the first completed event. The abort
	// guard only blocks lowering the charge: if completed events already
	// exceed the recorded n, bill the higher actual count regardless.
	requestedN := 1.0
	if n, ok := info.PriceData.OtherRatios()["n"]; ok {
		requestedN = n
	}
	if streamFinished || float64(completedImages) > requestedN {
		updateOpenAIImageCount(info, completedImages)
	}
	return usage, nil
}

// writeOpenaiImageStreamChunk rebuilds the SSE frame for an image stream chunk:
// it emits an "event:" line derived from the JSON "type" field (when present)
// followed by the verbatim "data:" payload, mirroring helper.ResponseChunkData.
func writeOpenaiImageStreamChunk(c *gin.Context, data []byte) error {
	var payload struct {
		Type string `json:"type"`
	}
	_ = common.Unmarshal(data, &payload)
	if eventName := strings.TrimSpace(payload.Type); eventName != "" {
		return helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventName}, string(data))
	}
	return helper.StringData(c, string(data))
}

// isOpenAIImageStreamErrorEvent detects upstream error chunks by JSON content
// only ("type" of error/upstream_error, or a non-empty "error" field). The SSE
// "event:" line is not available here: StreamScannerHandler delivers only the
// "data:" payload. A payload carrying just a "message" key is deliberately NOT
// treated as an error to avoid false positives.
func isOpenAIImageStreamErrorEvent(data []byte) bool {
	if !json.Valid(data) {
		return false
	}
	var payload struct {
		Type  string          `json:"type"`
		Error json.RawMessage `json:"error"`
	}
	if err := common.Unmarshal(data, &payload); err != nil {
		return false
	}
	payloadType := strings.ToLower(strings.TrimSpace(payload.Type))
	return payloadType == "error" || payloadType == "upstream_error" || len(payload.Error) > 0
}

func extractOpenAIImageStreamErrorMessage(data []byte) string {
	if len(data) == 0 || !json.Valid(data) {
		return "upstream image stream returned error event"
	}
	var payload struct {
		Message string          `json:"message"`
		Error   json.RawMessage `json:"error"`
	}
	if err := common.Unmarshal(data, &payload); err != nil {
		return "upstream image stream returned error event"
	}
	if msg := strings.TrimSpace(payload.Message); msg != "" {
		return msg
	}
	if len(payload.Error) > 0 {
		var nested struct {
			Message string `json:"message"`
		}
		if err := common.Unmarshal(payload.Error, &nested); err == nil {
			if msg := strings.TrimSpace(nested.Message); msg != "" {
				return msg
			}
		}
		if msg := strings.TrimSpace(common.JsonRawMessageToString(payload.Error)); msg != "" {
			return msg
		}
	}
	return "upstream image stream returned error event"
}

func openaiImageJSONAsStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := readOpenAIImageResponseBody(resp.Body)
	if err != nil {
		return nil, openAIImageResponseReadError(c, resp, err)
	}

	// Only decode usage/error. Do not Unmarshal data[] into dto.ImageResponse —
	// b64_json values are large and would be copied into Go strings then
	// re-marshaled for each SSE event.
	var usageResp dto.SimpleResponse
	if err := common.Unmarshal(responseBody, &usageResp); err != nil {
		return nil, openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := usageResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices && !openAIImageJSONHasAsset(responseBody, true) {
		return nil, openAIImageResponseError(c, resp, errOpenAIImageResponseMissingAsset, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	normalizeOpenAIUsage(&usageResp.Usage)
	applyUsagePostProcessing(info, &usageResp.Usage, responseBody)

	imageCount := gjson.GetBytes(responseBody, "data.#").Int()
	updateOpenAIImageCount(info, imageCount)

	helper.SetEventStreamHeaders(c)
	c.Status(http.StatusOK)

	created := gjson.GetBytes(responseBody, "created").Int()
	if created == 0 {
		created = time.Now().Unix()
	}
	if info != nil {
		info.SetFirstResponseTime()
	}

	validUsage := service.ValidUsage(&usageResp.Usage)
	var usageJSON []byte
	if validUsage {
		usageJSON, err = common.Marshal(usageResp.Usage)
		if err != nil {
			return nil, openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
	}

	for i := int64(0); i < imageCount; i++ {
		image := gjson.GetBytes(responseBody, "data."+strconv.FormatInt(i, 10))
		payload := []byte(`{"type":"image_generation.completed"}`)
		payload, err = sjson.SetBytes(payload, "created_at", created)
		if err != nil {
			return nil, openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
		}
		if validUsage {
			payload, err = sjson.SetRawBytes(payload, "usage", usageJSON)
			if err != nil {
				return nil, openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
		}
		// b64_json goes last: every sjson.Set* reallocates the whole payload,
		// so inserting the large blob after all small fields avoids re-copying
		// multi-MB buffers.
		for _, field := range []string{"url", "revised_prompt", "b64_json"} {
			value := image.Get(field)
			if value.Type != gjson.String || value.Raw == `""` {
				continue
			}
			raw := []byte(value.Raw)
			if value.Index > 0 {
				raw = responseBody[value.Index : value.Index+len(value.Raw)]
			}
			payload, err = sjson.SetRawBytes(payload, field, raw)
			if err != nil {
				return nil, openAIImageResponseError(c, resp, err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			}
		}
		if writeErr := helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: "image_generation.completed"}, string(payload)); writeErr != nil {
			if info != nil && info.StreamStatus != nil {
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, writeErr)
			}
			return &usageResp.Usage, nil
		}
	}
	if err := writeOpenaiImageStreamDone(c); err != nil {
		if info != nil && info.StreamStatus != nil {
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, err)
		}
		return &usageResp.Usage, nil
	}
	if info != nil {
		info.ReceivedResponseCount += int(imageCount)
		if info.StreamStatus == nil {
			info.StreamStatus = relaycommon.NewStreamStatus()
		}
		info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	}
	return &usageResp.Usage, nil
}

// OpenaiImageJSONAsStreamHandler is retained for compatibility with existing
// internal callers and regression tests while the implementation stays local
// to this package.
func OpenaiImageJSONAsStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	return openaiImageJSONAsStreamHandler(c, info, resp)
}

func writeOpenaiImageStreamDone(c *gin.Context) error {
	return helper.StringData(c, "[DONE]")
}
