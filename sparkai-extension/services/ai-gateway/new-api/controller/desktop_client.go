package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const desktopClientEventSchemaVersion = 1

var desktopClientEventNames = map[string]struct{}{
	"app_started":            {},
	"app_closed":             {},
	"agent_request_failed":   {},
	"image_request_failed":   {},
	"update_check_failed":    {},
	"update_download_failed": {},
	"update_applied":         {},
	"renderer_crashed":       {},
	"main_process_crashed":   {},
	"health_check_failed":    {},
}

var desktopClientEventComponents = map[string]struct{}{
	"app":       {},
	"agent":     {},
	"image_gen": {},
	"canvas":    {},
	"update":    {},
	"renderer":  {},
	"main":      {},
}

type desktopClientEventRequest struct {
	SchemaVersion  int    `json:"schema_version"`
	Event          string `json:"event"`
	AppVersion     string `json:"app_version"`
	Platform       string `json:"platform"`
	Architecture   string `json:"architecture"`
	ReleaseChannel string `json:"release_channel"`
	Component      string `json:"component"`
	ErrorCode      string `json:"error_code"`
	DurationMs     *int64 `json:"duration_ms"`
	Count          int    `json:"count"`
}

func validDesktopClientToken(value string, maxLength int, punctuation string) bool {
	if value == "" || len(value) > maxLength {
		return false
	}
	for _, character := range value {
		isASCIIAlphaNumeric := character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9'
		if !isASCIIAlphaNumeric && !strings.ContainsRune(punctuation, character) {
			return false
		}
	}
	return true
}

func RecordDesktopClientEvent(c *gin.Context) {
	if !requireCurrentDesktopUser(c) {
		return
	}
	var request desktopClientEventRequest
	if err := common.DecodeJsonStrict(c.Request.Body, &request); err != nil {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_invalid", "客户端状态数据无效。")
		return
	}
	request.Event = strings.ToLower(strings.TrimSpace(request.Event))
	request.AppVersion = strings.TrimSpace(request.AppVersion)
	request.Platform = strings.ToLower(strings.TrimSpace(request.Platform))
	request.Architecture = strings.ToLower(strings.TrimSpace(request.Architecture))
	request.ReleaseChannel = strings.ToLower(strings.TrimSpace(request.ReleaseChannel))
	request.Component = strings.ToLower(strings.TrimSpace(request.Component))
	request.ErrorCode = strings.TrimSpace(request.ErrorCode)

	_, eventOK := desktopClientEventNames[request.Event]
	_, componentOK := desktopClientEventComponents[request.Component]
	_, versionOK := desktopSemver(request.AppVersion)
	if request.SchemaVersion != desktopClientEventSchemaVersion ||
		!eventOK ||
		!componentOK ||
		!versionOK ||
		!validDesktopClientToken(request.AppVersion, 64, ".-+") {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_invalid", "客户端状态数据无效。")
		return
	}
	if request.Platform == "windows" {
		request.Platform = "win32"
	}
	if request.Platform != "win32" || request.Architecture != "x64" {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_platform_invalid", "客户端平台信息无效。")
		return
	}
	if request.ReleaseChannel == "" {
		request.ReleaseChannel = "stable"
	}
	if request.ReleaseChannel != "stable" && request.ReleaseChannel != "beta" {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_channel_invalid", "客户端发布通道无效。")
		return
	}
	if request.ErrorCode != "" {
		if !validDesktopClientToken(request.ErrorCode, 64, "._:-") {
			desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_error_code_invalid", "客户端错误代码无效。")
			return
		}
	}
	if request.DurationMs != nil && (*request.DurationMs < 0 || *request.DurationMs > 24*60*60*1000) {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_duration_invalid", "客户端耗时数据无效。")
		return
	}
	if request.Count == 0 {
		request.Count = 1
	}
	if request.Count < 1 || request.Count > 100 {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_client_event_count_invalid", "客户端事件数量无效。")
		return
	}

	details := map[string]interface{}{
		"schema_version":  request.SchemaVersion,
		"event":           request.Event,
		"app_version":     request.AppVersion,
		"platform":        request.Platform,
		"architecture":    request.Architecture,
		"release_channel": request.ReleaseChannel,
		"component":       request.Component,
		"count":           request.Count,
	}
	if request.ErrorCode != "" {
		details["error_code"] = request.ErrorCode
	}
	if request.DurationMs != nil {
		details["duration_ms"] = *request.DurationMs
	}
	if err := model.RecordDesktopClientEvent(c.GetInt("id"), c.GetString(common.RequestIdKey), details); err != nil {
		desktopDownloadFailure(c, http.StatusInternalServerError, "desktop_client_event_store_failed", "客户端状态暂时无法记录。")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
