package controller

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func managedImageIdempotencyTestConfig(t *testing.T, now time.Time) managedImageIdempotencyConfig {
	t.Helper()
	return managedImageIdempotencyConfig{
		flights:            newManagedImageIdempotencyFlights(),
		cleanup:            &managedImageIdempotencyCleanup{},
		now:                func() time.Time { return now },
		ttl:                time.Hour,
		processingLease:    15 * time.Minute,
		transientLease:     30 * time.Second,
		maxResponseBytes:   2 << 20,
		maxStoredBytes:     4 << 20,
		maxUserStoredBytes: 2 << 20,
		maxRecords:         100,
		maxUserRecords:     50,
		cleanupBatch:       20,
		cleanupInterval:    time.Minute,
		storageDir:         t.TempDir(),
	}
}

func setupManagedImageIdempotencyTestDB(t *testing.T) {
	t.Helper()
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ManagedImageIdempotencyRecord{}))
}

func managedImageIdempotencyTestRouter(
	config managedImageIdempotencyConfig,
	handler gin.HandlerFunc,
) *gin.Engine {
	return managedImageIdempotencyTestRouterForUser(config, 27, handler)
}

func managedImageIdempotencyTestRouterForUser(
	config managedImageIdempotencyConfig,
	userId int,
	handler gin.HandlerFunc,
) *gin.Engine {
	router := gin.New()
	var requestCounter int64
	router.Use(func(c *gin.Context) {
		defer common.CleanupBodyStorage(c)
		c.Set("id", userId)
		c.Set("managed_session_relay", true)
		c.Set(common.RequestIdKey, "managed-image-test-"+common.GetTimeString()+"-"+strconv.FormatInt(atomic.AddInt64(&requestCounter, 1), 10))
		c.Next()
	})
	router.Use(managedImageIdempotency(config))
	router.POST("/v1/images/generations", handler)
	router.POST("/v1/images/edits", handler)
	return router
}

func performManagedImageRequest(
	router http.Handler,
	path string,
	contentType string,
	body []byte,
	idempotencyKey string,
) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Idempotency-Key", idempotencyKey)
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestManagedImageIdempotencySingleFlightsBillableHandlerAndPersistsReplay(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	now := time.Unix(1_800_000_000, 0)
	config := managedImageIdempotencyTestConfig(t, now)
	var billableCalls atomic.Int32
	var settlementCalls atomic.Int32
	var upstreamKey atomic.Value
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once

	handler := func(c *gin.Context) {
		billableCalls.Add(1)
		upstreamKey.Store(c.GetHeader("Idempotency-Key"))
		startOnce.Do(func() { close(started) })
		<-release
		settlementCalls.Add(1)
		c.JSON(http.StatusOK, gin.H{
			"created": 1_800_000_000,
			"data":    []gin.H{{"url": "https://example.invalid/generated.png"}},
		})
	}
	router := managedImageIdempotencyTestRouter(config, handler)
	body := []byte(`{"model":"image-2","prompt":"draw once"}`)
	const requestCount = 8
	recorders := make([]*httptest.ResponseRecorder, requestCount)
	var waitGroup sync.WaitGroup
	waitGroup.Add(1)
	go func() {
		defer waitGroup.Done()
		recorders[0] = performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "image-job-001")
	}()
	<-started
	for index := 1; index < requestCount; index++ {
		waitGroup.Add(1)
		go func(resultIndex int) {
			defer waitGroup.Done()
			recorders[resultIndex] = performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "image-job-001")
		}(index)
	}
	close(release)
	waitGroup.Wait()

	require.Equal(t, int32(1), billableCalls.Load(), "pre-consume/upstream must execute once")
	require.Equal(t, int32(1), settlementCalls.Load(), "successful billing settlement must execute once")
	require.NotNil(t, upstreamKey.Load())
	assert.NotEqual(t, "image-job-001", upstreamKey.Load().(string))
	assert.Contains(t, upstreamKey.Load().(string), "iiimage-")
	for index, recorder := range recorders {
		require.Equal(t, http.StatusOK, recorder.Code, "request %d: %s", index, recorder.Body.String())
		require.Equal(t, recorders[0].Body.String(), recorder.Body.String())
	}
	assert.Equal(t, "created", recorders[0].Header().Get("Idempotency-Status"))
	for index := 1; index < requestCount; index++ {
		assert.Equal(t, "replayed", recorders[index].Header().Get("Idempotency-Status"))
	}

	// A new flight group simulates a process restart. The durable response must
	// still replay without entering the billable handler again.
	restartedConfig := managedImageIdempotencyTestConfig(t, now.Add(time.Minute))
	restartedConfig.storageDir = config.storageDir
	restartedRouter := managedImageIdempotencyTestRouter(restartedConfig, handler)
	replayed := performManagedImageRequest(restartedRouter, "/v1/images/generations", "application/json", body, "image-job-001")
	require.Equal(t, http.StatusOK, replayed.Code)
	require.Equal(t, recorders[0].Body.String(), replayed.Body.String())
	assert.Equal(t, "replayed", replayed.Header().Get("Idempotency-Status"))
	require.Equal(t, int32(1), billableCalls.Load())
	require.Equal(t, int32(1), settlementCalls.Load())

	mismatch := performManagedImageRequest(
		restartedRouter,
		"/v1/images/generations",
		"application/json",
		[]byte(`{"model":"image-2","prompt":"different work"}`),
		"image-job-001",
	)
	require.Equal(t, http.StatusConflict, mismatch.Code)
	assert.Contains(t, mismatch.Body.String(), "idempotency_payload_mismatch")
	require.Equal(t, int32(1), billableCalls.Load())

	var records []model.ManagedImageIdempotencyRecord
	require.NoError(t, model.DB.Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, model.ManagedImageIdempotencySucceeded, records[0].State)
	assert.Empty(t, records[0].ResponseBody)
	assert.NotEmpty(t, records[0].ResponseFile)
	storedBody, err := readManagedImageResponseFile(config, records[0])
	require.NoError(t, err)
	assert.Equal(t, recorders[0].Body.Bytes(), storedBody)
}

func TestManagedImageIdempotencyDurableClaimBlocksASecondProcess(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	now := time.Unix(1_800_000_050, 0)
	firstConfig := managedImageIdempotencyTestConfig(t, now)
	secondConfig := managedImageIdempotencyTestConfig(t, now)
	secondConfig.storageDir = firstConfig.storageDir
	started := make(chan struct{})
	release := make(chan struct{})
	var firstCalls atomic.Int32
	var secondCalls atomic.Int32
	firstRouter := managedImageIdempotencyTestRouter(firstConfig, func(c *gin.Context) {
		firstCalls.Add(1)
		close(started)
		<-release
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.invalid/cross-process.png"}}})
	})
	secondRouter := managedImageIdempotencyTestRouter(secondConfig, func(c *gin.Context) {
		secondCalls.Add(1)
		c.Status(http.StatusNoContent)
	})
	body := []byte(`{"model":"image-2","prompt":"cross process"}`)
	var first *httptest.ResponseRecorder
	done := make(chan struct{})
	go func() {
		defer close(done)
		first = performManagedImageRequest(firstRouter, "/v1/images/generations", "application/json", body, "cross-process-key")
	}()
	<-started

	processing := performManagedImageRequest(secondRouter, "/v1/images/generations", "application/json", body, "cross-process-key")
	require.Equal(t, http.StatusTooEarly, processing.Code)
	assert.Contains(t, processing.Body.String(), "idempotency_request_in_progress")
	require.Zero(t, secondCalls.Load())
	close(release)
	<-done
	require.Equal(t, http.StatusOK, first.Code)
	require.Equal(t, int32(1), firstCalls.Load())

	replayed := performManagedImageRequest(secondRouter, "/v1/images/generations", "application/json", body, "cross-process-key")
	require.Equal(t, http.StatusOK, replayed.Code)
	assert.Equal(t, "replayed", replayed.Header().Get("Idempotency-Status"))
	require.Zero(t, secondCalls.Load())
}

func TestManagedImageIdempotencyInvalidatesMissingOrCorruptResponseFiles(t *testing.T) {
	for _, testCase := range []struct {
		name   string
		mutate func(t *testing.T, filePath string)
	}{
		{
			name: "missing",
			mutate: func(t *testing.T, filePath string) {
				require.NoError(t, os.Remove(filePath))
			},
		},
		{
			name: "size mismatch",
			mutate: func(t *testing.T, filePath string) {
				require.NoError(t, os.WriteFile(filePath, []byte("short"), 0o600))
			},
		},
		{
			name: "hash mismatch",
			mutate: func(t *testing.T, filePath string) {
				body, err := os.ReadFile(filePath)
				require.NoError(t, err)
				require.NotEmpty(t, body)
				body[len(body)-1] ^= 0xff
				require.NoError(t, os.WriteFile(filePath, body, 0o600))
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			setupManagedImageIdempotencyTestDB(t)
			now := time.Unix(1_800_000_075, 0)
			config := managedImageIdempotencyTestConfig(t, now)
			var handlerCalls atomic.Int32
			router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
				handlerCalls.Add(1)
				c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "valid-image-payload"}}})
			})
			body := []byte(`{"model":"image-2","prompt":"durable file"}`)
			key := "response-file-" + strings.ReplaceAll(testCase.name, " ", "-")
			first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusOK, first.Code)

			var record model.ManagedImageIdempotencyRecord
			require.NoError(t, model.DB.First(&record).Error)
			require.NotEmpty(t, record.ResponseFile)
			filePath, err := managedImageResponsePath(config.storageDir, record.ResponseFile)
			require.NoError(t, err)
			testCase.mutate(t, filePath)

			second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusConflict, second.Code)
			assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
			third := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusConflict, third.Code)
			assert.Contains(t, third.Body.String(), "idempotency_outcome_unknown")
			require.Equal(t, int32(1), handlerCalls.Load(), "corrupt replay must never re-enter the billable handler")

			require.NoError(t, model.DB.First(&record).Error)
			assert.Equal(t, model.ManagedImageIdempotencyUnknown, record.State)
			assert.Empty(t, record.ResponseFile)
			assert.Zero(t, record.ResponseSize)
			assert.Empty(t, record.ResponseHash)
		})
	}
}

func TestManagedImageIdempotencyReplaysPermanentFailureWithoutSecondChargeAttempt(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_100, 0))
	var preConsumeCalls atomic.Int32
	var refundCalls atomic.Int32
	handler := func(c *gin.Context) {
		preConsumeCalls.Add(1)
		refundCalls.Add(1)
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": gin.H{"message": "request cannot be processed", "type": "invalid_request_error"},
		})
	}
	router := managedImageIdempotencyTestRouter(config, handler)
	body := []byte(`{"model":"image-2","prompt":"known failure"}`)

	first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "image-job-failed")
	second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "image-job-failed")
	require.Equal(t, http.StatusUnprocessableEntity, first.Code)
	require.Equal(t, first.Body.String(), second.Body.String())
	assert.Equal(t, "replayed-failure", second.Header().Get("Idempotency-Status"))
	require.Equal(t, int32(1), preConsumeCalls.Load())
	require.Equal(t, int32(1), refundCalls.Load(), "one failed billable attempt receives one refund")

	var record model.ManagedImageIdempotencyRecord
	require.NoError(t, model.DB.First(&record).Error)
	assert.Equal(t, model.ManagedImageIdempotencyFailed, record.State)
}

func TestManagedImageIdempotencyReleasesTransientFailureForRealRetry(t *testing.T) {
	statuses := []int{
		http.StatusTemporaryRedirect,
		http.StatusForbidden,
		http.StatusPaymentRequired,
		http.StatusRequestTimeout,
		http.StatusTooEarly,
		http.StatusTooManyRequests,
		http.StatusInternalServerError,
		http.StatusBadGateway,
		http.StatusServiceUnavailable,
		http.StatusGatewayTimeout,
	}
	for _, statusCode := range statuses {
		t.Run(strconv.Itoa(statusCode), func(t *testing.T) {
			setupManagedImageIdempotencyTestDB(t)
			config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_150, 0))
			var billableCalls atomic.Int32
			handler := func(c *gin.Context) {
				call := billableCalls.Add(1)
				if call == 1 {
					c.JSON(statusCode, gin.H{
						"error": gin.H{"message": "image service temporarily unavailable", "type": "upstream_error"},
					})
					return
				}
				c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.invalid/recovered.png"}}})
			}
			router := managedImageIdempotencyTestRouter(config, handler)
			body := []byte(`{"model":"image-2","prompt":"retry transient"}`)
			key := "image-job-transient-" + strconv.Itoa(statusCode)

			first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, statusCode, first.Code)
			var countAfterFailure int64
			require.NoError(t, model.DB.Model(&model.ManagedImageIdempotencyRecord{}).Count(&countAfterFailure).Error)
			require.Zero(t, countAfterFailure, "transient failures must release the durable claim")

			second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusOK, second.Code)
			require.Equal(t, int32(2), billableCalls.Load())
			third := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusOK, third.Code)
			assert.Equal(t, "replayed", third.Header().Get("Idempotency-Status"))
			require.Equal(t, int32(2), billableCalls.Load())
		})
	}
}

func TestManagedImageIdempotencyDoesNotReleaseAmbiguousTransientResponse(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_165, 0))
	var billableCalls atomic.Int32
	router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
		billableCalls.Add(1)
		c.Set(common.ManagedImageOutcomeUnknownKey, true)
		c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{"message": "upstream accepted the image request but its response could not be verified"}})
	})
	body := []byte(`{"model":"image-2","prompt":"ambiguous upstream outcome"}`)
	first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "ambiguous-outcome")
	require.Equal(t, http.StatusBadGateway, first.Code)
	second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "ambiguous-outcome")
	require.Equal(t, http.StatusConflict, second.Code)
	assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
	require.Equal(t, int32(1), billableCalls.Load(), "an ambiguous upstream outcome must never be released for automatic retry")
	var record model.ManagedImageIdempotencyRecord
	require.NoError(t, model.DB.First(&record).Error)
	assert.Equal(t, model.ManagedImageIdempotencyUnknown, record.State)
}

func TestManagedImageIdempotencyAllowsDerivedKeyAfter413CompressionRetry(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_175, 0))
	var handlerCalls atomic.Int32
	handler := func(c *gin.Context) {
		if handlerCalls.Add(1) == 1 {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": gin.H{"message": "request body too large", "type": "invalid_request_error"},
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.invalid/compressed.png"}}})
	}
	router := managedImageIdempotencyTestRouter(config, handler)
	largeBody := []byte(`{"model":"image-2","prompt":"edit","image":"large-original"}`)
	compressedBody := []byte(`{"model":"image-2","prompt":"edit","image":"aggressively-compressed"}`)

	first := performManagedImageRequest(router, "/v1/images/edits", "application/json", largeBody, "K")
	require.Equal(t, http.StatusRequestEntityTooLarge, first.Code)
	replayed413 := performManagedImageRequest(router, "/v1/images/edits", "application/json", largeBody, "K")
	require.Equal(t, http.StatusRequestEntityTooLarge, replayed413.Code)
	assert.Equal(t, "replayed-failure", replayed413.Header().Get("Idempotency-Status"))

	mismatch := performManagedImageRequest(router, "/v1/images/edits", "application/json", compressedBody, "K")
	require.Equal(t, http.StatusConflict, mismatch.Code)
	assert.Contains(t, mismatch.Body.String(), "idempotency_payload_mismatch")
	require.Equal(t, int32(1), handlerCalls.Load())

	derived := performManagedImageRequest(router, "/v1/images/edits", "application/json", compressedBody, "K-aggressive")
	require.Equal(t, http.StatusOK, derived.Code)
	require.Equal(t, int32(2), handlerCalls.Load())
}

func TestManagedImageIdempotencyMapsBodyLimitTo413AndAcceptsAggressiveDerivedKey(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	previousLimit := constant.MaxRequestBodyMB
	constant.MaxRequestBodyMB = 1
	t.Cleanup(func() {
		constant.MaxRequestBodyMB = previousLimit
	})
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_180, 0))
	var handlerCalls atomic.Int32
	router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
		handlerCalls.Add(1)
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.invalid/aggressive.png"}}})
	})

	tooLarge := bytes.Repeat([]byte("x"), (1<<20)+1)
	first := performManagedImageRequest(router, "/v1/images/edits", "application/octet-stream", tooLarge, "K-limit")
	require.Equal(t, http.StatusRequestEntityTooLarge, first.Code)
	assert.Contains(t, first.Body.String(), "idempotency_request_too_large")
	require.Zero(t, handlerCalls.Load())

	compressed := []byte(`{"model":"image-2","prompt":"edit","image":"small"}`)
	derived := performManagedImageRequest(router, "/v1/images/edits", "application/json", compressed, "K-limit-aggressive")
	require.Equal(t, http.StatusOK, derived.Code)
	require.Equal(t, int32(1), handlerCalls.Load())
}

func TestManagedImageIdempotencyDoesNotReexecuteProcessingOrUnknownClaims(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	now := time.Unix(1_800_000_200, 0)
	body := []byte(`{"model":"image-2","prompt":"uncertain"}`)
	requestHash := managedImageRequestHashForTest(t, "/v1/images/generations", "application/json", body)
	var handlerCalls atomic.Int32
	handler := func(c *gin.Context) {
		handlerCalls.Add(1)
		c.Status(http.StatusNoContent)
	}

	for _, testCase := range []struct {
		name          string
		key           string
		updatedAt     time.Time
		expectedCode  int
		expectedError string
	}{
		{name: "processing", key: "image-job-processing", updatedAt: now.Add(-time.Minute), expectedCode: http.StatusTooEarly, expectedError: "idempotency_request_in_progress"},
		{name: "unknown", key: "image-job-unknown", updatedAt: now.Add(-20 * time.Minute), expectedCode: http.StatusConflict, expectedError: "idempotency_outcome_unknown"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
				ScopeHash:   managedImageScopeHash(27, testCase.key),
				UserId:      27,
				RequestHash: requestHash,
				State:       model.ManagedImageIdempotencyProcessing,
				RequestId:   "original-processing-request",
				CreatedAt:   testCase.updatedAt.Unix(),
				UpdatedAt:   testCase.updatedAt.Unix(),
				ExpiresAt:   now.Add(time.Hour).Unix(),
			}).Error)
			config := managedImageIdempotencyTestConfig(t, now)
			router := managedImageIdempotencyTestRouter(config, handler)
			response := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, testCase.key)
			require.Equal(t, testCase.expectedCode, response.Code)
			assert.Contains(t, response.Body.String(), testCase.expectedError)
		})
	}
	require.Zero(t, handlerCalls.Load())
}

func TestManagedImageIdempotencyDoesNotCacheIncompleteSuccessfulResponses(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		handler gin.HandlerFunc
	}{
		{
			name: "empty 200",
			handler: func(c *gin.Context) {
				c.Status(http.StatusOK)
			},
		},
		{
			name: "partial json",
			handler: func(c *gin.Context) {
				c.Header("Content-Type", "application/json")
				c.Status(http.StatusOK)
				_, _ = c.Writer.Write([]byte(`{"data":[`))
			},
		},
		{
			name: "empty image data",
			handler: func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"data": []any{}})
			},
		},
		{
			name: "success false with data",
			handler: func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"success": false, "data": []gin.H{{"url": "https://example.invalid/not-success.png"}}})
			},
		},
		{
			name: "error with data",
			handler: func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"error": gin.H{"message": "upstream failed"}, "data": []gin.H{{"url": "https://example.invalid/not-success.png"}}})
			},
		},
		{
			name: "image item without asset",
			handler: func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"revised_prompt": "no actual image"}}})
			},
		},
		{
			name: "unterminated event stream",
			handler: func(c *gin.Context) {
				c.Header("Content-Type", "text/event-stream")
				c.Status(http.StatusOK)
				_, _ = c.Writer.Write([]byte("event: image_generation.partial_image\ndata: {\"b64_json\":\"partial\"}\n\n"))
			},
		},
		{
			name: "done event stream without image asset",
			handler: func(c *gin.Context) {
				c.Header("Content-Type", "text/event-stream")
				c.Status(http.StatusOK)
				_, _ = c.Writer.Write([]byte("event: image_generation.completed\ndata: {\"type\":\"image_generation.completed\"}\n\ndata: [DONE]\n\n"))
			},
		},
		{
			name: "error data without event line",
			handler: func(c *gin.Context) {
				c.Header("Content-Type", "text/event-stream")
				c.Status(http.StatusOK)
				_, _ = c.Writer.Write([]byte("data: {\"type\":\"upstream_error\",\"error\":{\"message\":\"failed\"}}\n\ndata: [DONE]\n\n"))
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			setupManagedImageIdempotencyTestDB(t)
			config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_250, 0))
			var handlerCalls atomic.Int32
			router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
				handlerCalls.Add(1)
				testCase.handler(c)
			})
			body := []byte(`{"model":"image-2","prompt":"incomplete"}`)
			key := "incomplete-" + strings.ReplaceAll(testCase.name, " ", "-")
			first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusOK, first.Code)
			second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, key)
			require.Equal(t, http.StatusConflict, second.Code)
			assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
			require.Equal(t, int32(1), handlerCalls.Load())
			var record model.ManagedImageIdempotencyRecord
			require.NoError(t, model.DB.First(&record).Error)
			assert.Equal(t, model.ManagedImageIdempotencyUnknown, record.State)
			assert.Empty(t, record.ResponseBody)
		})
	}
}

func TestManagedImageIdempotencyDoesNotCacheSuccessAfterClientCancellation(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_260, 0))
	var handlerCalls atomic.Int32
	router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
		handlerCalls.Add(1)
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"url": "https://example.invalid/disconnected.png"}}})
	})
	body := []byte(`{"model":"image-2","prompt":"disconnect"}`)
	cancelledContext, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(body)).WithContext(cancelledContext)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "client-disconnected")
	first := httptest.NewRecorder()
	router.ServeHTTP(first, request)
	require.Equal(t, http.StatusOK, first.Code)

	second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "client-disconnected")
	require.Equal(t, http.StatusConflict, second.Code)
	assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
	require.Equal(t, int32(1), handlerCalls.Load())
}

func TestManagedImageIdempotencyReleasesClaimWhenCaptureStorageCannotBeCreated(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_265, 0))
	notDirectory := filepath.Join(t.TempDir(), "not-a-directory")
	require.NoError(t, os.WriteFile(notDirectory, []byte("occupied"), 0o600))
	config.storageDir = notDirectory
	var handlerCalls atomic.Int32
	router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
		handlerCalls.Add(1)
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "must-not-run"}}})
	})
	response := performManagedImageRequest(router, "/v1/images/generations", "application/json", []byte(`{"model":"image-2","prompt":"storage unavailable"}`), "capture-storage-unavailable")
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
	assert.Contains(t, response.Body.String(), "idempotency_storage_unavailable")
	require.Zero(t, handlerCalls.Load())
	var recordCount int64
	require.NoError(t, model.DB.Model(&model.ManagedImageIdempotencyRecord{}).Count(&recordCount).Error)
	assert.Zero(t, recordCount, "capture creation failure must release the durable claim")
}

func TestManagedImageIdempotencyMarksUnknownWhenCaptureWriteFails(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_268, 0))
	var handlerCalls atomic.Int32
	router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
		handlerCalls.Add(1)
		capture, ok := c.Writer.(*managedImageCaptureWriter)
		require.True(t, ok)
		require.NoError(t, capture.file.Close())
		c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "client-may-have-seen-this"}}})
	})
	body := []byte(`{"model":"image-2","prompt":"capture write failure"}`)
	first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "capture-write-failure")
	require.Equal(t, http.StatusOK, first.Code)
	second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "capture-write-failure")
	require.Equal(t, http.StatusConflict, second.Code)
	assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
	require.Equal(t, int32(1), handlerCalls.Load())
	var record model.ManagedImageIdempotencyRecord
	require.NoError(t, model.DB.First(&record).Error)
	assert.Equal(t, model.ManagedImageIdempotencyUnknown, record.State)
	entries, err := os.ReadDir(config.storageDir)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestManagedImageIdempotencyReplaysOnlyCompletedImageEventStream(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	config := managedImageIdempotencyTestConfig(t, time.Unix(1_800_000_270, 0))
	var handlerCalls atomic.Int32
	router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
		handlerCalls.Add(1)
		c.Header("Content-Type", "text/event-stream")
		c.Status(http.StatusOK)
		_, _ = c.Writer.Write([]byte("event: image_generation.completed\ndata: {\"type\":\"image_generation.completed\",\"b64_json\":\"final-image\"}\n\ndata: [DONE]\n\n"))
	})
	body := []byte(`{"model":"image-2","prompt":"complete stream","stream":true}`)
	first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "complete-stream")
	second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "complete-stream")
	require.Equal(t, http.StatusOK, first.Code)
	require.Equal(t, first.Body.String(), second.Body.String())
	assert.Equal(t, "replayed", second.Header().Get("Idempotency-Status"))
	require.Equal(t, int32(1), handlerCalls.Load())
}

func TestManagedImageRequestHashIgnoresMultipartBoundaryButPreservesContent(t *testing.T) {
	firstBody, firstContentType := managedImageMultipartBody(t, "boundary-one", []byte("same-image"))
	secondBody, secondContentType := managedImageMultipartBody(t, "boundary-two", []byte("same-image"))
	changedBody, changedContentType := managedImageMultipartBody(t, "boundary-three", []byte("changed-image"))

	firstHash := managedImageRequestHashForTest(t, "/v1/images/edits", firstContentType, firstBody)
	secondHash := managedImageRequestHashForTest(t, "/v1/images/edits", secondContentType, secondBody)
	changedHash := managedImageRequestHashForTest(t, "/v1/images/edits", changedContentType, changedBody)
	assert.Equal(t, firstHash, secondHash)
	assert.NotEqual(t, firstHash, changedHash)
}

func TestManagedImageRequestHashDoesNotCanonicalizeTrailingJSONValues(t *testing.T) {
	validBody := []byte(`{"model":"image-2","prompt":"one image"}`)
	trailingBody := []byte(`{"model":"image-2","prompt":"one image"} {}`)

	validHash := managedImageRequestHashForTest(t, "/v1/images/generations", "application/json", validBody)
	trailingHash := managedImageRequestHashForTest(t, "/v1/images/generations", "application/json", trailingBody)
	assert.NotEqual(t, validHash, trailingHash)
}

func TestManagedImageIdempotencyEnforcesRecordAndResponseStorageCapacity(t *testing.T) {
	t.Run("record limit", func(t *testing.T) {
		setupManagedImageIdempotencyTestDB(t)
		now := time.Unix(1_800_000_300, 0)
		require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
			ScopeHash:    managedImageScopeHash(99, "existing"),
			UserId:       99,
			RequestHash:  "existing-request",
			State:        model.ManagedImageIdempotencySucceeded,
			StatusCode:   http.StatusOK,
			ResponseBody: []byte("stored"),
			CreatedAt:    now.Unix(),
			UpdatedAt:    now.Unix(),
			ExpiresAt:    now.Add(time.Hour).Unix(),
		}).Error)
		config := managedImageIdempotencyTestConfig(t, now)
		config.maxRecords = 1
		var handlerCalls atomic.Int32
		router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
			handlerCalls.Add(1)
			c.Status(http.StatusNoContent)
		})
		response := performManagedImageRequest(
			router,
			"/v1/images/generations",
			"application/json",
			[]byte(`{"model":"image-2","prompt":"capacity"}`),
			"at-capacity",
		)
		require.Equal(t, http.StatusServiceUnavailable, response.Code)
		assert.Contains(t, response.Body.String(), "idempotency_capacity_reached")
		require.Zero(t, handlerCalls.Load())
	})

	t.Run("concurrent claims cannot jointly cross the global record limit", func(t *testing.T) {
		setupManagedImageIdempotencyTestDB(t)
		now := time.Unix(1_800_000_305, 0)
		config := managedImageIdempotencyTestConfig(t, now)
		config.maxRecords = 1
		var handlerCalls atomic.Int32
		router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
			handlerCalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "one-winner"}}})
		})
		responses := make([]*httptest.ResponseRecorder, 2)
		start := make(chan struct{})
		var waitGroup sync.WaitGroup
		for index := range responses {
			waitGroup.Add(1)
			go func(resultIndex int) {
				defer waitGroup.Done()
				<-start
				responses[resultIndex] = performManagedImageRequest(
					router,
					"/v1/images/generations",
					"application/json",
					[]byte(`{"model":"image-2","prompt":"one capacity winner"}`),
					"capacity-race-"+strconv.Itoa(resultIndex),
				)
			}(index)
		}
		close(start)
		waitGroup.Wait()
		statusCounts := map[int]int{}
		for _, response := range responses {
			statusCounts[response.Code]++
		}
		assert.Equal(t, 1, statusCounts[http.StatusOK])
		assert.Equal(t, 1, statusCounts[http.StatusServiceUnavailable])
		require.Equal(t, int32(1), handlerCalls.Load())
		var recordCount int64
		require.NoError(t, model.DB.Model(&model.ManagedImageIdempotencyRecord{}).Count(&recordCount).Error)
		assert.Equal(t, int64(1), recordCount)
	})

	t.Run("total response bytes", func(t *testing.T) {
		setupManagedImageIdempotencyTestDB(t)
		now := time.Unix(1_800_000_310, 0)
		config := managedImageIdempotencyTestConfig(t, now)
		config.maxStoredBytes = 8
		var handlerCalls atomic.Int32
		router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
			handlerCalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "response-larger-than-eight-bytes"}}})
		})
		body := []byte(`{"model":"image-2","prompt":"storage capacity"}`)
		first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "storage-capacity")
		require.Equal(t, http.StatusOK, first.Code)
		second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "storage-capacity")
		require.Equal(t, http.StatusConflict, second.Code)
		assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
		require.Equal(t, int32(1), handlerCalls.Load())
		usage, err := model.GetManagedImageIdempotencyUsage(now.Unix())
		require.NoError(t, err)
		assert.Equal(t, int64(1), usage.RecordCount)
		assert.Zero(t, usage.ResponseBytes)
		entries, err := os.ReadDir(config.storageDir)
		require.NoError(t, err)
		assert.Empty(t, entries, "a response rejected by capacity must not leave a final or temporary file")
	})

	t.Run("per user record limit does not block another user", func(t *testing.T) {
		setupManagedImageIdempotencyTestDB(t)
		now := time.Unix(1_800_000_315, 0)
		require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
			ScopeHash:   managedImageScopeHash(27, "existing-user-record"),
			UserId:      27,
			RequestHash: "existing-user-request",
			State:       model.ManagedImageIdempotencyUnknown,
			CreatedAt:   now.Unix(),
			UpdatedAt:   now.Unix(),
			ExpiresAt:   now.Add(time.Hour).Unix(),
		}).Error)
		config := managedImageIdempotencyTestConfig(t, now)
		config.maxUserRecords = 1
		var userACalls atomic.Int32
		userARouter := managedImageIdempotencyTestRouterForUser(config, 27, func(c *gin.Context) {
			userACalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "user-a"}}})
		})
		userAResponse := performManagedImageRequest(userARouter, "/v1/images/generations", "application/json", []byte(`{"model":"image-2","prompt":"user a"}`), "user-a-at-capacity")
		require.Equal(t, http.StatusServiceUnavailable, userAResponse.Code)
		assert.Contains(t, userAResponse.Body.String(), "idempotency_capacity_reached")
		require.Zero(t, userACalls.Load())

		var userBCalls atomic.Int32
		userBRouter := managedImageIdempotencyTestRouterForUser(config, 28, func(c *gin.Context) {
			userBCalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "user-b"}}})
		})
		userBResponse := performManagedImageRequest(userBRouter, "/v1/images/generations", "application/json", []byte(`{"model":"image-2","prompt":"user b"}`), "user-b-has-capacity")
		require.Equal(t, http.StatusOK, userBResponse.Code)
		require.Equal(t, int32(1), userBCalls.Load())
	})

	t.Run("per user response bytes become unknown without blocking another user", func(t *testing.T) {
		setupManagedImageIdempotencyTestDB(t)
		now := time.Unix(1_800_000_318, 0)
		require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
			ScopeHash:    managedImageScopeHash(27, "existing-user-bytes"),
			UserId:       27,
			RequestHash:  "existing-user-bytes-request",
			State:        model.ManagedImageIdempotencyFailed,
			StatusCode:   http.StatusBadRequest,
			ResponseBody: bytes.Repeat([]byte("x"), 48),
			CreatedAt:    now.Unix(),
			UpdatedAt:    now.Unix(),
			ExpiresAt:    now.Add(time.Hour).Unix(),
		}).Error)
		config := managedImageIdempotencyTestConfig(t, now)
		config.maxUserStoredBytes = 64
		var userACalls atomic.Int32
		userARouter := managedImageIdempotencyTestRouterForUser(config, 27, func(c *gin.Context) {
			userACalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "small"}}})
		})
		bodyA := []byte(`{"model":"image-2","prompt":"user byte limit"}`)
		firstA := performManagedImageRequest(userARouter, "/v1/images/generations", "application/json", bodyA, "user-byte-capacity")
		require.Equal(t, http.StatusOK, firstA.Code)
		secondA := performManagedImageRequest(userARouter, "/v1/images/generations", "application/json", bodyA, "user-byte-capacity")
		require.Equal(t, http.StatusConflict, secondA.Code)
		assert.Contains(t, secondA.Body.String(), "idempotency_outcome_unknown")
		require.Equal(t, int32(1), userACalls.Load())

		var userBCalls atomic.Int32
		userBRouter := managedImageIdempotencyTestRouterForUser(config, 28, func(c *gin.Context) {
			userBCalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "small"}}})
		})
		bodyB := []byte(`{"model":"image-2","prompt":"other user"}`)
		firstB := performManagedImageRequest(userBRouter, "/v1/images/generations", "application/json", bodyB, "other-user-byte-capacity")
		require.Equal(t, http.StatusOK, firstB.Code)
		secondB := performManagedImageRequest(userBRouter, "/v1/images/generations", "application/json", bodyB, "other-user-byte-capacity")
		require.Equal(t, http.StatusOK, secondB.Code)
		assert.Equal(t, "replayed", secondB.Header().Get("Idempotency-Status"))
		require.Equal(t, int32(1), userBCalls.Load())
	})

	t.Run("per response bytes", func(t *testing.T) {
		setupManagedImageIdempotencyTestDB(t)
		now := time.Unix(1_800_000_320, 0)
		config := managedImageIdempotencyTestConfig(t, now)
		config.maxResponseBytes = 8
		var handlerCalls atomic.Int32
		router := managedImageIdempotencyTestRouter(config, func(c *gin.Context) {
			handlerCalls.Add(1)
			c.JSON(http.StatusOK, gin.H{"data": []gin.H{{"b64_json": "response-larger-than-eight-bytes"}}})
		})
		body := []byte(`{"model":"image-2","prompt":"response limit"}`)
		first := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "response-limit")
		require.Equal(t, http.StatusOK, first.Code)
		second := performManagedImageRequest(router, "/v1/images/generations", "application/json", body, "response-limit")
		require.Equal(t, http.StatusConflict, second.Code)
		assert.Contains(t, second.Body.String(), "idempotency_outcome_unknown")
		require.Equal(t, int32(1), handlerCalls.Load())
	})
}

func TestCleanupExpiredManagedImageIdempotencyIsBatched(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	now := time.Unix(1_800_000_400, 0)
	for index := 0; index < 3; index++ {
		require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
			ScopeHash:   managedImageScopeHash(27, "expired-"+string(rune('a'+index))),
			UserId:      27,
			RequestHash: "expired-request",
			State:       model.ManagedImageIdempotencyUnknown,
			CreatedAt:   now.Add(-time.Hour).Unix(),
			UpdatedAt:   now.Add(-time.Hour).Unix(),
			ExpiresAt:   now.Add(-time.Minute).Unix(),
		}).Error)
	}
	require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
		ScopeHash:   managedImageScopeHash(27, "active"),
		UserId:      27,
		RequestHash: "active-request",
		State:       model.ManagedImageIdempotencyProcessing,
		CreatedAt:   now.Unix(),
		UpdatedAt:   now.Unix(),
		ExpiresAt:   now.Add(time.Hour).Unix(),
	}).Error)

	deleted, _, err := model.CleanupExpiredManagedImageIdempotency(now.Unix(), 2)
	require.NoError(t, err)
	require.Equal(t, int64(2), deleted)
	var remaining int64
	require.NoError(t, model.DB.Model(&model.ManagedImageIdempotencyRecord{}).Count(&remaining).Error)
	require.Equal(t, int64(2), remaining)
	deleted, _, err = model.CleanupExpiredManagedImageIdempotency(now.Unix(), 2)
	require.NoError(t, err)
	require.Equal(t, int64(1), deleted)
}

func TestCleanupManagedImageResponseFilesPreservesActiveReferencesAndRemovesExpiredOrphans(t *testing.T) {
	setupManagedImageIdempotencyTestDB(t)
	now := time.Unix(1_800_000_450, 0)
	storageDir := t.TempDir()
	oldTime := now.Add(-2 * time.Hour)
	createOldFile := func(name string) string {
		t.Helper()
		path := filepath.Join(storageDir, name)
		require.NoError(t, os.WriteFile(path, []byte(name), 0o600))
		require.NoError(t, os.Chtimes(path, oldTime, oldTime))
		return path
	}
	activePath := createOldFile("active.response")
	expiredPath := createOldFile("expired.response")
	orphanPath := createOldFile("orphan.response")
	temporaryPath := createOldFile(".tmp-response-orphan")
	freshPath := filepath.Join(storageDir, "fresh.response")
	require.NoError(t, os.WriteFile(freshPath, []byte("fresh"), 0o600))
	require.NoError(t, os.Chtimes(freshPath, now, now))

	require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
		ScopeHash:    managedImageScopeHash(27, "active-file"),
		UserId:       27,
		RequestHash:  "active-file-request",
		State:        model.ManagedImageIdempotencySucceeded,
		StatusCode:   http.StatusOK,
		ResponseFile: "active.response",
		ResponseSize: 1,
		ResponseHash: strings.Repeat("a", 64),
		CreatedAt:    now.Add(-time.Hour).Unix(),
		UpdatedAt:    now.Add(-time.Hour).Unix(),
		ExpiresAt:    now.Add(time.Hour).Unix(),
	}).Error)
	require.NoError(t, model.DB.Create(&model.ManagedImageIdempotencyRecord{
		ScopeHash:    managedImageScopeHash(27, "expired-file"),
		UserId:       27,
		RequestHash:  "expired-file-request",
		State:        model.ManagedImageIdempotencySucceeded,
		StatusCode:   http.StatusOK,
		ResponseFile: "expired.response",
		ResponseSize: 1,
		ResponseHash: strings.Repeat("b", 64),
		CreatedAt:    now.Add(-2 * time.Hour).Unix(),
		UpdatedAt:    now.Add(-2 * time.Hour).Unix(),
		ExpiresAt:    now.Add(-time.Minute).Unix(),
	}).Error)

	cleanup := &managedImageIdempotencyCleanup{}
	cleanup.run(now, time.Minute, 20, storageDir, time.Hour)
	assert.FileExists(t, activePath)
	assert.FileExists(t, freshPath)
	assert.NoFileExists(t, expiredPath)
	assert.NoFileExists(t, orphanPath)
	assert.NoFileExists(t, temporaryPath)
	var records []model.ManagedImageIdempotencyRecord
	require.NoError(t, model.DB.Order("scope_hash").Find(&records).Error)
	require.Len(t, records, 1)
	assert.Equal(t, "active.response", records[0].ResponseFile)
}

func managedImageRequestHashForTest(t *testing.T, path string, contentType string, body []byte) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	context.Request.Header.Set("Content-Type", contentType)
	requestHash, err := managedImageRequestHash(context)
	require.NoError(t, err)
	common.CleanupBodyStorage(context)
	return requestHash
}

func managedImageMultipartBody(t *testing.T, boundary string, image []byte) ([]byte, string) {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := multipart.NewWriter(buffer)
	require.NoError(t, writer.SetBoundary(boundary))
	require.NoError(t, writer.WriteField("model", "image-2"))
	require.NoError(t, writer.WriteField("prompt", "replace the subject"))
	imagePart, err := writer.CreateFormFile("image", "source.png")
	require.NoError(t, err)
	_, err = imagePart.Write(image)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return buffer.Bytes(), writer.FormDataContentType()
}
