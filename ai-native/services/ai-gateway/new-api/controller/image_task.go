package controller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

const (
	imageTaskBatchSize   = 32
	imageTaskConcurrency = 2
)

type imageTaskResponse struct {
	TaskID      string          `json:"task_id"`
	Status      string          `json:"status"`
	CreatedAt   int64           `json:"created_at,omitempty"`
	StartedAt   int64           `json:"started_at,omitempty"`
	CompletedAt int64           `json:"completed_at,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       *imageTaskError `json:"error,omitempty"`
}

type imageTaskError struct {
	Message string `json:"message"`
}

type ImageTaskRunSummary struct {
	Queued    int64 `json:"queued"`
	Started   int64 `json:"started"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Orphaned  int64 `json:"orphaned"`
}

var executeImageTaskRequest = executeStoredImageTaskRequest

func writeImageTaskAPIError(c *gin.Context, status int, code string, err error) {
	message := "图片任务请求失败。"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		message = err.Error()
	}
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    "invalid_request_error",
			"code":    code,
		},
	})
}

func normalizedImageTaskRequest(c *gin.Context) (json.RawMessage, *dto.ImageRequest, error) {
	if c.ContentType() != gin.MIMEJSON {
		return nil, nil, errors.New("image tasks currently require an application/json Images generation request")
	}
	request, err := helper.GetAndValidateRequest(c, types.RelayFormatOpenAIImage)
	if err != nil {
		return nil, nil, err
	}
	imageRequest, ok := request.(*dto.ImageRequest)
	if !ok {
		return nil, nil, fmt.Errorf("invalid image task request type %T", request)
	}

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, nil, err
	}
	body, err := storage.Bytes()
	if err != nil {
		return nil, nil, err
	}
	var payload map[string]json.RawMessage
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil, nil, err
	}
	payload["stream"] = json.RawMessage("false")
	delete(payload, "partial_images")
	// Group routing has already been resolved by Distribute. It is server-side
	// context and must not leak into a pass-through provider request.
	delete(payload, "group")
	normalized, err := common.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	return json.RawMessage(normalized), imageRequest, nil
}

// CreateImageTask validates and persists a generation request after the normal
// token and channel middleware has run. No provider request is made here.
func CreateImageTask(c *gin.Context) {
	requestBody, imageRequest, err := normalizedImageTaskRequest(c)
	if err != nil {
		writeImageTaskAPIError(c, http.StatusBadRequest, "invalid_image_task_request", err)
		return
	}

	idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if idempotencyKey != "" && !validManagedImageIdempotencyKey(idempotencyKey) {
		writeImageTaskAPIError(c, http.StatusBadRequest, "invalid_idempotency_key", errors.New("Idempotency-Key contains invalid characters"))
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, imageRequest, nil)
	if err != nil {
		writeImageTaskAPIError(c, http.StatusBadRequest, "invalid_image_task_request", err)
		return
	}
	relayInfo.InitChannelMeta(c)
	if relayInfo.UserId <= 0 || relayInfo.TokenId <= 0 || relayInfo.ChannelId <= 0 {
		writeImageTaskAPIError(c, http.StatusInternalServerError, "image_task_context_missing", errors.New("image task routing context is incomplete"))
		return
	}

	task := model.InitTask(constant.TaskPlatformImage, relayInfo)
	task.Action = constant.TaskActionImageGeneration
	task.Status = model.TaskStatusQueued
	task.Progress = "0%"
	task.PrivateData.TokenId = relayInfo.TokenId
	task.PrivateData.ImageTask = &model.ImageTaskPrivateData{
		Request:        requestBody,
		IdempotencyKey: idempotencyKey,
		AutoGroup:      common.GetContextKeyString(c, constant.ContextKeyAutoGroup),
	}
	if err := task.Insert(); err != nil {
		writeImageTaskAPIError(c, http.StatusInternalServerError, "image_task_create_failed", errors.New("failed to persist image task"))
		return
	}

	if _, _, err := service.EnqueueSystemTask(model.SystemTaskTypeImageTaskRun, nil); err != nil {
		// The durable image task remains queued. The scheduled handler will pick
		// it up on the next pass even if this immediate wakeup failed.
		logger.LogError(c, fmt.Sprintf("enqueue image task runner failed for %s: %v", task.TaskID, err))
	}

	c.JSON(http.StatusAccepted, imageTaskResponse{
		TaskID:    task.TaskID,
		Status:    "queued",
		CreatedAt: task.CreatedAt,
	})
}

func imageTaskPublicStatus(status model.TaskStatus) string {
	switch status {
	case model.TaskStatusNotStart, model.TaskStatusSubmitted, model.TaskStatusQueued:
		return "queued"
	case model.TaskStatusInProgress:
		return "running"
	case model.TaskStatusSuccess:
		return "succeeded"
	case model.TaskStatusFailure:
		return "failed"
	default:
		return "failed"
	}
}

func GetImageTask(c *gin.Context) {
	taskID := strings.TrimSpace(c.Param("id"))
	if taskID == "" {
		writeImageTaskAPIError(c, http.StatusBadRequest, "image_task_id_required", errors.New("task id is required"))
		return
	}
	task, exists, err := model.GetByTaskId(c.GetInt("id"), taskID)
	if err != nil {
		writeImageTaskAPIError(c, http.StatusInternalServerError, "image_task_query_failed", errors.New("failed to query image task"))
		return
	}
	if !exists || task == nil || task.Platform != constant.TaskPlatformImage || task.Action != constant.TaskActionImageGeneration {
		writeImageTaskAPIError(c, http.StatusNotFound, "image_task_not_found", errors.New("image task not found"))
		return
	}

	response := imageTaskResponse{
		TaskID:      task.TaskID,
		Status:      imageTaskPublicStatus(task.Status),
		CreatedAt:   task.CreatedAt,
		StartedAt:   task.StartTime,
		CompletedAt: task.FinishTime,
	}
	if task.Status == model.TaskStatusSuccess && len(task.Data) > 0 {
		response.Result = task.Data
	}
	if task.Status == model.TaskStatusFailure {
		message := strings.TrimSpace(task.FailReason)
		if message == "" {
			message = "图片生成失败。"
		}
		response.Error = &imageTaskError{Message: message}
	}
	c.JSON(http.StatusOK, response)
}

func imageTaskFailureReason(err error) string {
	if err == nil {
		return "图片生成失败。"
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		return "图片生成失败。"
	}
	const maxRunes = 2000
	runes := []rune(message)
	if len(runes) > maxRunes {
		message = string(runes[:maxRunes])
	}
	return message
}

func transitionImageTaskToRunning(task *model.Task) (bool, error) {
	fromStatus := task.Status
	task.Status = model.TaskStatusInProgress
	task.Progress = "10%"
	task.StartTime = time.Now().Unix()
	return task.UpdateWithStatus(fromStatus)
}

func finishImageTask(task *model.Task, result json.RawMessage, runErr error) (bool, error) {
	task.FinishTime = time.Now().Unix()
	task.Progress = "100%"
	// The normalized prompt/request is needed only until the provider call has
	// reached a terminal state. Remove it from durable private data afterwards.
	task.PrivateData.ImageTask = nil
	if runErr != nil {
		task.Status = model.TaskStatusFailure
		task.FailReason = imageTaskFailureReason(runErr)
		task.Data = nil
	} else {
		task.Status = model.TaskStatusSuccess
		task.FailReason = ""
		task.Data = append(json.RawMessage(nil), result...)
	}
	return task.UpdateWithStatus(model.TaskStatusInProgress)
}

func failOrphanedImageTasks(ctx context.Context) int64 {
	var failed int64
	for {
		tasks := model.GetInProgressImageTasks(imageTaskBatchSize)
		if len(tasks) == 0 {
			return failed
		}
		madeProgress := false
		for _, task := range tasks {
			if ctx.Err() != nil {
				return failed
			}
			won, err := finishImageTask(task, nil, errors.New("图片任务后台执行被中断，请重新提交。"))
			if err != nil {
				logger.LogError(ctx, fmt.Sprintf("fail orphaned image task %s: %v", task.TaskID, err))
				continue
			}
			if won {
				failed++
				madeProgress = true
			}
		}
		if !madeProgress {
			return failed
		}
	}
}

func runOneImageTask(ctx context.Context, task *model.Task, summary *ImageTaskRunSummary) {
	won, err := transitionImageTaskToRunning(task)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("claim image task %s: %v", task.TaskID, err))
		return
	}
	if !won {
		return
	}
	atomic.AddInt64(&summary.Started, 1)

	result, runErr := executeImageTaskRequest(ctx, task)
	completed, updateErr := finishImageTask(task, result, runErr)
	if updateErr != nil {
		logger.LogError(ctx, fmt.Sprintf("finish image task %s: %v", task.TaskID, updateErr))
		return
	}
	if !completed {
		return
	}
	if runErr != nil {
		atomic.AddInt64(&summary.Failed, 1)
		logger.LogError(ctx, fmt.Sprintf("image task %s failed: %s", task.TaskID, imageTaskFailureReason(runErr)))
		return
	}
	atomic.AddInt64(&summary.Succeeded, 1)
}

func runImageTasksOnce(ctx context.Context, report func(processed, total int)) ImageTaskRunSummary {
	if ctx == nil {
		ctx = context.Background()
	}
	summary := ImageTaskRunSummary{}
	summary.Orphaned = failOrphanedImageTasks(ctx)
	summary.Failed += summary.Orphaned

	processed := 0
	for ctx.Err() == nil {
		tasks := model.GetQueuedImageTasks(imageTaskBatchSize)
		if len(tasks) == 0 {
			break
		}
		summary.Queued += int64(len(tasks))
		if report != nil {
			report(processed, processed+len(tasks))
		}

		jobs := make(chan *model.Task)
		workers := imageTaskConcurrency
		if len(tasks) < workers {
			workers = len(tasks)
		}
		var wait sync.WaitGroup
		for index := 0; index < workers; index++ {
			wait.Add(1)
			go func() {
				defer wait.Done()
				for task := range jobs {
					if ctx.Err() != nil {
						return
					}
					runOneImageTask(ctx, task, &summary)
				}
			}()
		}
	dispatchLoop:
		for _, task := range tasks {
			select {
			case jobs <- task:
				processed++
			case <-ctx.Done():
				break dispatchLoop
			}
		}
		close(jobs)
		wait.Wait()
	}
	if report != nil && ctx.Err() == nil {
		report(processed, processed)
	}
	return summary
}

func executeStoredImageTaskRequest(ctx context.Context, task *model.Task) (json.RawMessage, error) {
	if task == nil || task.PrivateData.ImageTask == nil || len(task.PrivateData.ImageTask.Request) == 0 {
		return nil, errors.New("图片任务请求数据缺失。")
	}
	token, err := model.GetTokenById(task.PrivateData.TokenId)
	if err != nil || token == nil {
		return nil, errors.New("图片任务令牌已不可用。")
	}
	if token.UserId != task.UserId {
		return nil, errors.New("图片任务令牌与用户不匹配。")
	}
	user, err := model.GetUserCache(task.UserId)
	if err != nil || user == nil || user.Status != common.UserStatusEnabled {
		return nil, errors.New("图片任务用户已不可用。")
	}
	channel, err := model.GetChannelById(task.ChannelId, true)
	if err != nil || channel == nil {
		return nil, errors.New("图片任务渠道已不可用。")
	}

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/v1/images/generations",
		bytes.NewReader(task.PrivateData.ImageTask.Request),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", gin.MIMEJSON)
	if task.PrivateData.ImageTask.IdempotencyKey != "" {
		request.Header.Set("Idempotency-Key", task.PrivateData.ImageTask.IdempotencyKey)
	}
	request.ContentLength = int64(len(task.PrivateData.ImageTask.Request))

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request
	c.Set(common.RequestIdKey, task.TaskID)
	user.WriteContext(c)
	usingGroup := strings.TrimSpace(task.Group)
	if usingGroup == "" {
		usingGroup = user.Group
	}
	common.SetContextKey(c, constant.ContextKeyUsingGroup, usingGroup)
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
	if autoGroup := strings.TrimSpace(task.PrivateData.ImageTask.AutoGroup); autoGroup != "" {
		common.SetContextKey(c, constant.ContextKeyAutoGroup, autoGroup)
	}
	if err := middleware.SetupContextForToken(c, token); err != nil {
		return nil, err
	}
	if relayErr := middleware.SetupContextForSelectedChannel(c, channel, task.Properties.OriginModelName); relayErr != nil {
		return nil, relayErr
	}
	defer common.CleanupBodyStorage(c)

	if relayErr := ExecuteRelay(c, types.RelayFormatOpenAIImage); relayErr != nil {
		return nil, relayErr
	}
	responseBody := bytes.TrimSpace(recorder.Body.Bytes())
	if len(responseBody) == 0 || !json.Valid(responseBody) {
		return nil, errors.New("图片上游返回了无效的最终 JSON 结果。")
	}
	return append(json.RawMessage(nil), responseBody...), nil
}

type imageTaskRunHandler struct{}

func (imageTaskRunHandler) Type() string { return model.SystemTaskTypeImageTaskRun }

func (imageTaskRunHandler) Enabled() bool { return model.HasUnfinishedImageTasks() }

func (imageTaskRunHandler) Interval() time.Duration { return 15 * time.Second }

func (imageTaskRunHandler) NewPayload() any { return nil }

func (imageTaskRunHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := runImageTasksOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
	if model.HasQueuedImageTasks() {
		if _, _, err := service.EnqueueSystemTask(model.SystemTaskTypeImageTaskRun, nil); err != nil {
			logger.LogError(ctx, fmt.Sprintf("enqueue follow-up image task runner: %v", err))
		}
	}
}
