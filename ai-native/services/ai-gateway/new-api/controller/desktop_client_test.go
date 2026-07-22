package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecordDesktopClientEventStoresOnlyNormalizedMetadata(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	gin.SetMode(gin.TestMode)
	payload, err := common.Marshal(map[string]interface{}{
		"schema_version":  1,
		"event":           "IMAGE_REQUEST_FAILED",
		"app_version":     "1.0.3",
		"platform":        "windows",
		"architecture":    "x64",
		"release_channel": "stable",
		"component":       "image_gen",
		"error_code":      "new_api_404",
		"duration_ms":     4321,
		"count":           2,
	})
	require.NoError(t, err)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Set(common.RequestIdKey, "request-desktop-event-1")
		c.Next()
	})
	router.POST("/events", RecordDesktopClientEvent)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/events", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())

	var stored model.Log
	require.NoError(t, model.LOG_DB.Order("id DESC").First(&stored).Error)
	assert.Equal(t, model.LogTypeSystem, stored.Type)
	assert.Equal(t, "Desktop client image_request_failed · image_gen · v1.0.3 · new_api_404 ×2", stored.Content)
	assert.Equal(t, "request-desktop-event-1", stored.RequestId)
	assert.Empty(t, stored.Ip)
	other, err := common.StrToMap(stored.Other)
	require.NoError(t, err)
	op, ok := other["op"].(map[string]interface{})
	require.True(t, ok)
	params, ok := op["params"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "image_request_failed", params["event"])
	assert.Equal(t, "win32", params["platform"])
	assert.Equal(t, "new_api_404", params["error_code"])
	assert.NotContains(t, params, "prompt")
	assert.NotContains(t, params, "project_path")
}

func TestRecordDesktopClientEventRejectsUnboundedOrIdentifyingFields(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/events", RecordDesktopClientEvent)

	tests := []map[string]interface{}{
		{"schema_version": 1, "event": "app_started", "app_version": "1.0.3", "platform": "win32", "architecture": "x64", "component": "app", "prompt": "must never be accepted"},
		{"schema_version": 1, "event": "app_started", "app_version": "1.0.3", "platform": "win32", "architecture": "x64", "component": "app", "project_path": "C:/private/project"},
		{"schema_version": 2, "event": "app_started", "app_version": "1.0.3", "platform": "win32", "architecture": "x64", "component": "app"},
		{"schema_version": 1, "event": "raw_log", "app_version": "1.0.3", "platform": "win32", "architecture": "x64", "component": "app"},
		{"schema_version": 1, "event": "app_started", "app_version": "latest", "platform": "win32", "architecture": "x64", "component": "app"},
		{"schema_version": 1, "event": "app_started", "app_version": "1.0.3-" + strings.Repeat("x", 80), "platform": "win32", "architecture": "x64", "component": "app"},
		{"schema_version": 1, "event": "app_started", "app_version": "1.0.3", "platform": "darwin", "architecture": "arm64", "component": "app"},
		{"schema_version": 1, "event": "agent_request_failed", "app_version": "1.0.3", "platform": "win32", "architecture": "x64", "component": "agent", "error_code": "raw error message with spaces"},
		{"schema_version": 1, "event": "app_started", "app_version": "1.0.3", "platform": "win32", "architecture": "x64", "component": "app", "count": 101},
	}
	for _, payload := range tests {
		body, err := common.Marshal(payload)
		require.NoError(t, err)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/events", bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
	}
}

func TestRecordDesktopClientEventRejectsDisabledCurrentUser(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
	payload, err := common.Marshal(map[string]interface{}{
		"schema_version": 1,
		"event":          "app_started",
		"app_version":    "1.0.3",
		"platform":       "win32",
		"architecture":   "x64",
		"component":      "app",
	})
	require.NoError(t, err)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/events", RecordDesktopClientEvent)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/events", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusUnauthorized, recorder.Code, recorder.Body.String())

	var eventCount int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("content LIKE ?", "Desktop client%").Count(&eventCount).Error)
	require.Zero(t, eventCount)
}

func TestRecordDesktopClientEventReturnsServiceUnavailableWhenAccountStateCannotBeRead(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	sqlDB, err := model.DB.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/events", RecordDesktopClientEvent)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/events", strings.NewReader(`{"schema_version":1,"event":"app_started","app_version":"1.0.3","platform":"win32","architecture":"x64","component":"app"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "desktop_client_account_check_failed")
}
