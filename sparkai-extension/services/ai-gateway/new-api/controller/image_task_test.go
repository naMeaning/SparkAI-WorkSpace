package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupImageTaskControllerTestDB(t *testing.T) {
	t.Helper()
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.SystemTask{}, &model.SystemTaskLock{}))
}

func newImageTaskCreateContext(t *testing.T, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", gin.MIMEJSON)
	c.Request.Header.Set("Idempotency-Key", "naimage-image-task-test")
	c.Set(common.RequestIdKey, "request-image-task-test")
	common.SetContextKey(c, constant.ContextKeyUserId, 42)
	common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(c, constant.ContextKeyUserQuota, 1_000_000)
	common.SetContextKey(c, constant.ContextKeyTokenId, 7)
	common.SetContextKey(c, constant.ContextKeyTokenKey, "token-fixture")
	common.SetContextKey(c, constant.ContextKeyTokenUnlimited, true)
	common.SetContextKey(c, constant.ContextKeyTokenGroup, "default")
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "gpt-image-2")
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
	common.SetContextKey(c, constant.ContextKeyChannelId, 9)
	common.SetContextKey(c, constant.ContextKeyChannelName, "image-fixture")
	common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, "http://image-upstream.test")
	common.SetContextKey(c, constant.ContextKeyChannelKey, "upstream-fixture")
	common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{})
	common.SetContextKey(c, constant.ContextKeyChannelOtherSetting, dto.ChannelOtherSettings{})
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	return c, recorder
}

func queryImageTaskForUser(t *testing.T, userID int, taskID string) imageTaskResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/image-tasks/"+taskID, nil)
	c.Params = gin.Params{{Key: "id", Value: taskID}}
	c.Set("id", userID)
	GetImageTask(c)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var response imageTaskResponse
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestImageTaskCreateReturnsBeforeBackgroundGenerationAndCompletesOnce(t *testing.T) {
	setupImageTaskControllerTestDB(t)

	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan ImageTaskRunSummary, 1)
	var calls atomic.Int64
	previousExecutor := executeImageTaskRequest
	executeImageTaskRequest = func(_ context.Context, task *model.Task) (json.RawMessage, error) {
		calls.Add(1)
		if string(task.Status) != string(model.TaskStatusInProgress) {
			return nil, errors.New("task was not claimed before execution")
		}
		close(started)
		<-release
		return json.RawMessage(`{"created":123,"data":[{"b64_json":"bW9jay1pbWFnZQ=="}]}`), nil
	}
	t.Cleanup(func() { executeImageTaskRequest = previousExecutor })

	c, recorder := newImageTaskCreateContext(t, `{
		"model":"gpt-image-2",
		"prompt":"slow mock image",
		"size":"1024x1024",
		"quality":"high",
		"n":1,
		"stream":true,
		"partial_images":3,
		"group":"default"
	}`)
	createStarted := time.Now()
	CreateImageTask(c)
	require.Equal(t, http.StatusAccepted, recorder.Code, recorder.Body.String())
	assert.Less(t, time.Since(createStarted), time.Second)
	assert.Zero(t, calls.Load(), "creating the task must not call the image provider")

	var created imageTaskResponse
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &created))
	require.NotEmpty(t, created.TaskID)
	assert.Equal(t, "queued", created.Status)

	task, exists, err := model.GetByTaskId(42, created.TaskID)
	require.NoError(t, err)
	require.True(t, exists)
	require.NotNil(t, task.PrivateData.ImageTask)
	assert.Equal(t, "naimage-image-task-test", task.PrivateData.ImageTask.IdempotencyKey)
	var storedRequest map[string]any
	require.NoError(t, json.Unmarshal(task.PrivateData.ImageTask.Request, &storedRequest))
	assert.Equal(t, false, storedRequest["stream"])
	assert.NotContains(t, storedRequest, "partial_images")
	assert.NotContains(t, storedRequest, "group")

	go func() { done <- runImageTasksOnce(context.Background(), nil) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("background image task did not start")
	}
	running := queryImageTaskForUser(t, 42, created.TaskID)
	assert.Equal(t, "running", running.Status)
	assert.Empty(t, running.Result)

	close(release)
	var summary ImageTaskRunSummary
	select {
	case summary = <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("background image task did not finish")
	}
	assert.EqualValues(t, 1, summary.Started)
	assert.EqualValues(t, 1, summary.Succeeded)
	assert.Zero(t, summary.Failed)
	assert.EqualValues(t, 1, calls.Load())

	succeeded := queryImageTaskForUser(t, 42, created.TaskID)
	assert.Equal(t, "succeeded", succeeded.Status)
	assert.JSONEq(t, `{"created":123,"data":[{"b64_json":"bW9jay1pbWFnZQ=="}]}`, string(succeeded.Result))

	secondPass := runImageTasksOnce(context.Background(), nil)
	assert.Zero(t, secondPass.Started)
	assert.EqualValues(t, 1, calls.Load(), "a terminal task must never execute twice")

	notFoundRecorder := httptest.NewRecorder()
	notFoundContext, _ := gin.CreateTestContext(notFoundRecorder)
	notFoundContext.Request = httptest.NewRequest(http.MethodGet, "/v1/image-tasks/"+created.TaskID, nil)
	notFoundContext.Params = gin.Params{{Key: "id", Value: created.TaskID}}
	notFoundContext.Set("id", 99)
	GetImageTask(notFoundContext)
	assert.Equal(t, http.StatusNotFound, notFoundRecorder.Code)
}

func TestImageTaskRunPersistsProviderFailure(t *testing.T) {
	setupImageTaskControllerTestDB(t)

	var calls atomic.Int64
	previousExecutor := executeImageTaskRequest
	executeImageTaskRequest = func(context.Context, *model.Task) (json.RawMessage, error) {
		calls.Add(1)
		return nil, errors.New("mock provider rejected the image")
	}
	t.Cleanup(func() { executeImageTaskRequest = previousExecutor })

	c, recorder := newImageTaskCreateContext(t, `{
		"model":"gpt-image-2",
		"prompt":"provider failure fixture",
		"size":"1024x1024",
		"quality":"high",
		"n":1
	}`)
	CreateImageTask(c)
	require.Equal(t, http.StatusAccepted, recorder.Code, recorder.Body.String())

	var created imageTaskResponse
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &created))
	summary := runImageTasksOnce(context.Background(), nil)
	assert.EqualValues(t, 1, summary.Started)
	assert.EqualValues(t, 1, summary.Failed)
	assert.Zero(t, summary.Succeeded)
	assert.EqualValues(t, 1, calls.Load())

	failed := queryImageTaskForUser(t, 42, created.TaskID)
	assert.Equal(t, "failed", failed.Status)
	require.NotNil(t, failed.Error)
	assert.Contains(t, failed.Error.Message, "mock provider rejected")

	task, exists, err := model.GetByTaskId(42, created.TaskID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Nil(t, task.PrivateData.ImageTask, "terminal tasks must not retain the normalized prompt payload")
}

func TestImageTaskRunFailsOrphanedRunningTaskWithoutCallingProviderAgain(t *testing.T) {
	setupImageTaskControllerTestDB(t)

	task := &model.Task{
		TaskID:     "task_orphaned_fixture",
		Platform:   constant.TaskPlatformImage,
		UserId:     42,
		ChannelId:  9,
		Action:     constant.TaskActionImageGeneration,
		Status:     model.TaskStatusInProgress,
		Progress:   "10%",
		SubmitTime: time.Now().Add(-time.Minute).Unix(),
		StartTime:  time.Now().Add(-time.Minute).Unix(),
		PrivateData: model.TaskPrivateData{
			TokenId: 7,
			ImageTask: &model.ImageTaskPrivateData{
				Request: json.RawMessage(`{"model":"gpt-image-2","prompt":"orphan"}`),
			},
		},
	}
	require.NoError(t, task.Insert())

	var calls atomic.Int64
	previousExecutor := executeImageTaskRequest
	executeImageTaskRequest = func(context.Context, *model.Task) (json.RawMessage, error) {
		calls.Add(1)
		return nil, errors.New("must not execute")
	}
	t.Cleanup(func() { executeImageTaskRequest = previousExecutor })

	summary := runImageTasksOnce(context.Background(), nil)
	assert.EqualValues(t, 1, summary.Orphaned)
	assert.EqualValues(t, 1, summary.Failed)
	assert.Zero(t, calls.Load())

	failed := queryImageTaskForUser(t, 42, task.TaskID)
	assert.Equal(t, "failed", failed.Status)
	require.NotNil(t, failed.Error)
	assert.Contains(t, failed.Error.Message, "后台执行被中断")
}
