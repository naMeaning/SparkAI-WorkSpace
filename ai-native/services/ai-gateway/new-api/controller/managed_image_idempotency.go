package controller

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const (
	managedImageIdempotencyUnavailable    = "unavailable"
	managedImageIdempotencyMismatch       = "mismatch"
	managedImageIdempotencyTTLDefault     = time.Hour
	managedImageProcessingLeaseDefault    = 15 * time.Minute
	managedImageTransientLeaseDefault     = 30 * time.Second
	managedImageResponseLimitDefault      = 64 << 20
	managedImageTotalLimitDefault         = int64(8 << 30)
	managedImageUserTotalLimitDefault     = int64(1 << 30)
	managedImageRecordLimitDefault        = 10_000
	managedImageUserRecordLimitDefault    = 1_000
	managedImageCleanupBatchDefault       = 500
	managedImageCleanupIntervalDefault    = time.Minute
	managedImageUpstreamIdempotencyPrefix = "naimage-"
)

type managedImageIdempotencyResult struct {
	state       string
	statusCode  int
	contentType string
	body        []byte
	requestId   string
}

type managedImageIdempotencyCall struct {
	requestHash string
	done        chan struct{}
	result      managedImageIdempotencyResult
}

type managedImageIdempotencyFlights struct {
	mu    sync.Mutex
	calls map[string]*managedImageIdempotencyCall
}

type managedImageIdempotencyConfig struct {
	flights            *managedImageIdempotencyFlights
	cleanup            *managedImageIdempotencyCleanup
	now                func() time.Time
	ttl                time.Duration
	processingLease    time.Duration
	transientLease     time.Duration
	maxResponseBytes   int
	maxStoredBytes     int64
	maxUserStoredBytes int64
	maxRecords         int64
	maxUserRecords     int64
	cleanupBatch       int
	cleanupInterval    time.Duration
	storageDir         string
}

type managedImageIdempotencyCleanup struct {
	mu   sync.Mutex
	next time.Time
}

type managedImageCaptureWriter struct {
	gin.ResponseWriter
	file       *os.File
	temporary  string
	digest     hash.Hash
	bytes      int64
	maxBytes   int64
	overflow   bool
	captureErr error
	writeErr   error
	closed     bool
	committed  bool
}

var (
	defaultManagedImageIdempotencyFlights = newManagedImageIdempotencyFlights()
	defaultManagedImageIdempotencyCleanup = &managedImageIdempotencyCleanup{}
	managedImageIdempotencyCapacityMu     sync.Mutex
)

func newManagedImageIdempotencyFlights() *managedImageIdempotencyFlights {
	return &managedImageIdempotencyFlights{calls: map[string]*managedImageIdempotencyCall{}}
}

func (flights *managedImageIdempotencyFlights) begin(
	scopeHash string,
	requestHash string,
) (*managedImageIdempotencyCall, bool, bool) {
	flights.mu.Lock()
	defer flights.mu.Unlock()
	if call, exists := flights.calls[scopeHash]; exists {
		return call, false, call.requestHash != requestHash
	}
	call := &managedImageIdempotencyCall{
		requestHash: requestHash,
		done:        make(chan struct{}),
	}
	flights.calls[scopeHash] = call
	return call, true, false
}

func (flights *managedImageIdempotencyFlights) finish(
	scopeHash string,
	call *managedImageIdempotencyCall,
	result managedImageIdempotencyResult,
) {
	flights.mu.Lock()
	call.result = result
	if flights.calls[scopeHash] == call {
		delete(flights.calls, scopeHash)
	}
	close(call.done)
	flights.mu.Unlock()
}

func managedImageResponsePath(storageDir string, fileName string) (string, error) {
	cleanName := filepath.Base(strings.TrimSpace(fileName))
	if cleanName == "" || cleanName != fileName || !strings.HasSuffix(cleanName, ".response") {
		return "", errors.New("invalid managed image response file")
	}
	root, err := filepath.Abs(storageDir)
	if err != nil {
		return "", err
	}
	target := filepath.Join(root, cleanName)
	relation, err := filepath.Rel(root, target)
	if err != nil || relation == ".." || strings.HasPrefix(relation, ".."+string(filepath.Separator)) {
		return "", errors.New("managed image response path escapes storage directory")
	}
	return target, nil
}

func readManagedImageResponseFile(config managedImageIdempotencyConfig, record model.ManagedImageIdempotencyRecord) ([]byte, error) {
	filePath, err := managedImageResponsePath(config.storageDir, record.ResponseFile)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(filePath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("managed image response file is unavailable")
	}
	if info.Size() <= 0 || info.Size() != record.ResponseSize || info.Size() > int64(config.maxResponseBytes) {
		return nil, errors.New("managed image response file size mismatch")
	}
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, int64(config.maxResponseBytes)+1))
	if err != nil || int64(len(body)) != record.ResponseSize {
		return nil, errors.New("managed image response file could not be read completely")
	}
	digest := sha256.Sum256(body)
	if record.ResponseHash == "" || subtle.ConstantTimeCompare([]byte(record.ResponseHash), []byte(hex.EncodeToString(digest[:]))) != 1 {
		return nil, errors.New("managed image response file hash mismatch")
	}
	return body, nil
}

func removeManagedImageResponseFile(storageDir string, fileName string) {
	filePath, err := managedImageResponsePath(storageDir, fileName)
	if err == nil {
		_ = os.Remove(filePath)
	}
}

func cleanupManagedImageResponseOrphans(storageDir string, now time.Time, cutoff time.Time, limit int) {
	entries, err := os.ReadDir(storageDir)
	if err != nil {
		return
	}
	activeResponseFiles, err := model.GetActiveManagedImageIdempotencyResponseFiles(now.Unix())
	if err != nil {
		common.SysError("list active managed image response files: " + err.Error())
		return
	}
	activeResponseFileSet := make(map[string]struct{}, len(activeResponseFiles))
	for _, fileName := range activeResponseFiles {
		activeResponseFileSet[fileName] = struct{}{}
	}
	removed := 0
	for _, entry := range entries {
		if removed >= limit {
			break
		}
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".response") && !strings.HasPrefix(name, ".tmp-response-") {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.ModTime().Before(cutoff) {
			continue
		}
		if strings.HasSuffix(name, ".response") {
			if _, referenced := activeResponseFileSet[name]; referenced {
				continue
			}
		}
		if removeErr := os.Remove(filepath.Join(storageDir, name)); removeErr == nil {
			removed++
		}
	}
}

func (cleanup *managedImageIdempotencyCleanup) run(now time.Time, interval time.Duration, batch int, storageDir string, orphanAge time.Duration) {
	if cleanup == nil || batch <= 0 {
		return
	}
	cleanup.mu.Lock()
	if now.Before(cleanup.next) {
		cleanup.mu.Unlock()
		return
	}
	cleanup.next = now.Add(interval)
	cleanup.mu.Unlock()

	deleted, responseFiles, err := model.CleanupExpiredManagedImageIdempotency(now.Unix(), batch)
	if err != nil {
		common.SysError("cleanup managed image idempotency: " + err.Error())
		return
	}
	for _, fileName := range responseFiles {
		removeManagedImageResponseFile(storageDir, fileName)
	}
	cleanupManagedImageResponseOrphans(storageDir, now, now.Add(-orphanAge), batch)
	if deleted >= int64(batch) {
		cleanup.mu.Lock()
		cleanup.next = now.Add(5 * time.Second)
		cleanup.mu.Unlock()
	}
}

func newManagedImageCaptureWriter(responseWriter gin.ResponseWriter, storageDir string, maxBytes int) (*managedImageCaptureWriter, error) {
	if err := os.MkdirAll(storageDir, 0o700); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(storageDir, ".tmp-response-capture-*")
	if err != nil {
		return nil, err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return nil, err
	}
	return &managedImageCaptureWriter{
		ResponseWriter: responseWriter,
		file:           file,
		temporary:      file.Name(),
		digest:         sha256.New(),
		maxBytes:       int64(maxBytes),
	}, nil
}

func (writer *managedImageCaptureWriter) Write(value []byte) (int, error) {
	if !writer.overflow && writer.captureErr == nil {
		if writer.bytes+int64(len(value)) > writer.maxBytes {
			writer.overflow = true
		} else {
			written, err := writer.file.Write(value)
			if err != nil {
				writer.captureErr = err
			} else if written != len(value) {
				writer.captureErr = io.ErrShortWrite
			} else {
				writer.bytes += int64(written)
				_, _ = writer.digest.Write(value)
			}
		}
	}
	written, err := writer.ResponseWriter.Write(value)
	if err != nil && writer.writeErr == nil {
		writer.writeErr = err
	} else if written != len(value) && writer.writeErr == nil {
		writer.writeErr = io.ErrShortWrite
	}
	return written, err
}

func (writer *managedImageCaptureWriter) WriteString(value string) (int, error) {
	return writer.Write([]byte(value))
}

func (writer *managedImageCaptureWriter) closeCapture() error {
	if writer.closed {
		return writer.captureErr
	}
	writer.closed = true
	if writer.captureErr == nil && !writer.overflow {
		if err := writer.file.Sync(); err != nil {
			writer.captureErr = err
		}
	}
	if err := writer.file.Close(); err != nil && writer.captureErr == nil {
		writer.captureErr = err
	}
	return writer.captureErr
}

func (writer *managedImageCaptureWriter) responseBody() ([]byte, error) {
	if err := writer.closeCapture(); err != nil {
		return nil, err
	}
	if writer.overflow || writer.bytes <= 0 {
		return nil, errors.New("managed image response capture is empty or oversized")
	}
	file, err := os.Open(writer.temporary)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, writer.maxBytes+1))
	if err != nil || int64(len(body)) != writer.bytes {
		return nil, errors.New("managed image response capture is incomplete")
	}
	return body, nil
}

func (writer *managedImageCaptureWriter) commit(scopeHash string) (string, int64, string, error) {
	if err := writer.closeCapture(); err != nil {
		return "", 0, "", err
	}
	if writer.overflow || writer.bytes <= 0 {
		return "", 0, "", errors.New("managed image response capture is empty or oversized")
	}
	finalName := scopeHash + "-" + strings.TrimPrefix(filepath.Base(writer.temporary), ".tmp-") + ".response"
	finalPath, err := managedImageResponsePath(filepath.Dir(writer.temporary), finalName)
	if err != nil {
		return "", 0, "", err
	}
	if err := os.Rename(writer.temporary, finalPath); err != nil {
		return "", 0, "", err
	}
	writer.committed = true
	return finalName, writer.bytes, hex.EncodeToString(writer.digest.Sum(nil)), nil
}

func (writer *managedImageCaptureWriter) discard() {
	_ = writer.closeCapture()
	if !writer.committed && writer.temporary != "" {
		_ = os.Remove(writer.temporary)
	}
}

func managedImageIdempotencyDuration(envName string, fallback time.Duration, minimum time.Duration) time.Duration {
	minutes := common.GetEnvOrDefault(envName, int(fallback/time.Minute))
	duration := time.Duration(minutes) * time.Minute
	if duration < minimum {
		return minimum
	}
	return duration
}

func managedImageIdempotencyResponseLimit() int {
	megabytes := common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_MAX_RESPONSE_MB", managedImageResponseLimitDefault>>20)
	if megabytes < 1 {
		megabytes = 1
	}
	if megabytes > 256 {
		megabytes = 256
	}
	return megabytes << 20
}

func managedImageIdempotencyTotalLimit() int64 {
	megabytes := common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_MAX_TOTAL_MB", int(managedImageTotalLimitDefault>>20))
	if megabytes < 16 {
		megabytes = 16
	}
	if megabytes > 65_536 {
		megabytes = 65_536
	}
	return int64(megabytes) << 20
}

func managedImageIdempotencyUserRecordLimit() int64 {
	records := common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_MAX_USER_RECORDS", managedImageUserRecordLimitDefault)
	if records < 20 {
		records = 20
	}
	if records > 20_000 {
		records = 20_000
	}
	return int64(records)
}

func managedImageIdempotencyUserTotalLimit() int64 {
	megabytes := common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_MAX_USER_TOTAL_MB", int(managedImageUserTotalLimitDefault>>20))
	if megabytes < 64 {
		megabytes = 64
	}
	if megabytes > 16_384 {
		megabytes = 16_384
	}
	return int64(megabytes) << 20
}

func managedImageIdempotencyStorageDir() string {
	configured := strings.TrimSpace(common.GetEnvOrDefaultString("MANAGED_IMAGE_IDEMPOTENCY_STORAGE_DIR", filepath.Join("data", "managed-image-idempotency")))
	absolute, err := filepath.Abs(configured)
	if err != nil {
		return configured
	}
	return absolute
}

func managedImageIdempotencyRecordLimit() int64 {
	records := common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_MAX_RECORDS", managedImageRecordLimitDefault)
	if records < 100 {
		records = 100
	}
	if records > 100_000 {
		records = 100_000
	}
	return int64(records)
}

func defaultManagedImageIdempotencyConfig() managedImageIdempotencyConfig {
	return managedImageIdempotencyConfig{
		flights:            defaultManagedImageIdempotencyFlights,
		cleanup:            defaultManagedImageIdempotencyCleanup,
		now:                time.Now,
		ttl:                managedImageIdempotencyDuration("MANAGED_IMAGE_IDEMPOTENCY_TTL_MINUTES", managedImageIdempotencyTTLDefault, 30*time.Minute),
		processingLease:    managedImageIdempotencyDuration("MANAGED_IMAGE_IDEMPOTENCY_PROCESSING_MINUTES", managedImageProcessingLeaseDefault, 5*time.Minute),
		transientLease:     managedImageTransientLeaseDefault,
		maxResponseBytes:   managedImageIdempotencyResponseLimit(),
		maxStoredBytes:     managedImageIdempotencyTotalLimit(),
		maxUserStoredBytes: managedImageIdempotencyUserTotalLimit(),
		maxRecords:         managedImageIdempotencyRecordLimit(),
		maxUserRecords:     managedImageIdempotencyUserRecordLimit(),
		cleanupBatch:       common.GetEnvOrDefault("MANAGED_IMAGE_IDEMPOTENCY_CLEANUP_BATCH", managedImageCleanupBatchDefault),
		cleanupInterval:    managedImageCleanupIntervalDefault,
		storageDir:         managedImageIdempotencyStorageDir(),
	}
}

func managedImageTransientStatus(statusCode int) bool {
	if statusCode >= http.StatusOK && statusCode < http.StatusMultipleChoices {
		return false
	}
	// Persist only request-shape failures that cannot recover without changing
	// the payload. Authentication/quota/channel/server outcomes can change, so
	// holding them under the same key would turn a recoverable failure into a
	// one-hour replay loop.
	switch statusCode {
	case http.StatusBadRequest,
		http.StatusRequestEntityTooLarge,
		http.StatusUnsupportedMediaType,
		http.StatusUnprocessableEntity:
		return false
	default:
		return true
	}
}

func managedImageRecordHasAsset(record map[string]any) bool {
	for _, field := range []string{"b64_json", "image_base64", "base64", "url"} {
		if value, isString := record[field].(string); isString && strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

func managedImagePayloadInvalid(payload map[string]any) bool {
	if value, exists := payload["success"].(bool); exists && !value {
		return true
	}
	if value, exists := payload["ok"].(bool); exists && !value {
		return true
	}
	if value, exists := payload["error"]; exists && value != nil {
		if message, isString := value.(string); !isString || strings.TrimSpace(message) != "" {
			return true
		}
	}
	payloadType, _ := payload["type"].(string)
	payloadType = strings.ToLower(strings.TrimSpace(payloadType))
	return payloadType == "error" || payloadType == "upstream_error"
}

func managedImagePayloadHasAsset(payload map[string]any) bool {
	if managedImageRecordHasAsset(payload) {
		return true
	}
	items, ok := payload["data"].([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if record, isRecord := item.(map[string]any); isRecord && managedImageRecordHasAsset(record) {
			return true
		}
	}
	return false
}

func managedImageEventStreamComplete(body []byte) bool {
	scanner := bufio.NewScanner(bytes.NewReader(body))
	scanner.Buffer(make([]byte, 64*1024), len(body)+1)
	dataLines := make([]string, 0, 1)
	eventName := ""
	hasDone := false
	hasAsset := false
	invalid := false
	flushEvent := func() {
		if invalid {
			dataLines = dataLines[:0]
			eventName = ""
			return
		}
		normalizedEvent := strings.ToLower(strings.TrimSpace(eventName))
		if normalizedEvent == "error" || normalizedEvent == "upstream_error" {
			invalid = true
		}
		if len(dataLines) == 0 {
			eventName = ""
			return
		}
		data := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		eventName = ""
		if data == "[DONE]" {
			hasDone = true
			return
		}
		var payload map[string]any
		if data == "" || common.Unmarshal([]byte(data), &payload) != nil || managedImagePayloadInvalid(payload) {
			invalid = true
			return
		}
		if managedImagePayloadHasAsset(payload) {
			hasAsset = true
		}
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			flushEvent()
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, hasValue := strings.Cut(line, ":")
		if !hasValue {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch strings.TrimSpace(field) {
		case "event":
			eventName = value
		case "data":
			dataLines = append(dataLines, value)
		}
	}
	flushEvent()
	return scanner.Err() == nil && !invalid && hasDone && hasAsset
}

func managedImageSuccessfulResponseComplete(
	statusCode int,
	contentType string,
	body []byte,
	writeErr error,
	requestErr error,
) bool {
	if statusCode < http.StatusOK || statusCode >= http.StatusMultipleChoices {
		return true
	}
	if writeErr != nil || requestErr != nil {
		return false
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return false
	}
	normalizedContentType := strings.ToLower(contentType)
	if strings.Contains(normalizedContentType, "text/event-stream") {
		return managedImageEventStreamComplete(trimmed)
	}
	if strings.Contains(normalizedContentType, "json") || trimmed[0] == '{' || trimmed[0] == '[' {
		var payload map[string]any
		if common.Unmarshal(trimmed, &payload) != nil {
			return false
		}
		if managedImagePayloadInvalid(payload) {
			return false
		}
		data, exists := payload["data"]
		items, valid := data.([]any)
		if !exists || !valid || len(items) == 0 {
			return false
		}
		for _, item := range items {
			record, isRecord := item.(map[string]any)
			if !isRecord {
				continue
			}
			if managedImageRecordHasAsset(record) {
				return true
			}
		}
		return false
	}
	return false
}

func managedSessionRelayNativePath(path string) string {
	if strings.HasPrefix(path, "/naimage/v1/") {
		return strings.TrimPrefix(path, "/naimage")
	}
	return path
}

func isManagedImageRelayRequest(c *gin.Context) bool {
	if c.Request.Method != http.MethodPost || !c.GetBool("managed_session_relay") {
		return false
	}
	path := managedSessionRelayNativePath(c.Request.URL.Path)
	return path == "/v1/images/generations" || path == "/v1/images/edits"
}

func validManagedImageIdempotencyKey(value string) bool {
	if value == "" || len(value) > 255 {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < 0x21 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

func managedImageScopeHash(userId int, idempotencyKey string) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userId, idempotencyKey)))
	return hex.EncodeToString(digest[:])
}

func writeManagedImageHashField(target hash.Hash, value string) {
	_, _ = io.WriteString(target, fmt.Sprintf("%d:", len(value)))
	_, _ = io.WriteString(target, value)
}

func writeManagedImageRawBodyHash(target hash.Hash, storage common.BodyStorage) error {
	if _, err := storage.Seek(0, io.SeekStart); err != nil {
		return err
	}
	_, err := io.Copy(target, storage)
	return err
}

func writeManagedImageMultipartHash(
	target hash.Hash,
	storage common.BodyStorage,
	boundary string,
) error {
	if _, err := storage.Seek(0, io.SeekStart); err != nil {
		return err
	}
	reader := multipart.NewReader(storage, boundary)
	for index := 0; ; index++ {
		part, err := reader.NextPart()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		writeManagedImageHashField(target, fmt.Sprintf("part:%d", index))
		writeManagedImageHashField(target, part.FormName())
		writeManagedImageHashField(target, part.FileName())
		writeManagedImageHashField(target, part.Header.Get("Content-Type"))
		partHash := sha256.New()
		size, copyErr := io.Copy(partHash, part)
		closeErr := part.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		writeManagedImageHashField(target, fmt.Sprintf("%d", size))
		_, _ = target.Write(partHash.Sum(nil))
	}
}

func managedImageRequestHash(c *gin.Context) (string, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return "", err
	}
	defer func() {
		_, _ = storage.Seek(0, io.SeekStart)
		c.Request.Body = io.NopCloser(storage)
	}()

	target := sha256.New()
	writeManagedImageHashField(target, c.Request.Method)
	writeManagedImageHashField(target, managedSessionRelayNativePath(c.Request.URL.Path))

	contentType := strings.TrimSpace(c.GetHeader("Content-Type"))
	mediaType, params, mediaErr := mime.ParseMediaType(contentType)
	if mediaErr != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	writeManagedImageHashField(target, mediaType)

	switch mediaType {
	case "application/json":
		if _, seekErr := storage.Seek(0, io.SeekStart); seekErr != nil {
			return "", seekErr
		}
		var body any
		if decodeErr := common.DecodeJsonStrict(storage, &body); decodeErr == nil {
			canonical, marshalErr := common.Marshal(body)
			if marshalErr != nil {
				return "", marshalErr
			}
			_, _ = target.Write(canonical)
			break
		}
		if err := writeManagedImageRawBodyHash(target, storage); err != nil {
			return "", err
		}
	case "application/x-www-form-urlencoded":
		body, bytesErr := storage.Bytes()
		if bytesErr != nil {
			return "", bytesErr
		}
		values, parseErr := url.ParseQuery(string(body))
		if parseErr != nil {
			if err := writeManagedImageRawBodyHash(target, storage); err != nil {
				return "", err
			}
			break
		}
		_, _ = io.WriteString(target, values.Encode())
	case "multipart/form-data":
		boundary := params["boundary"]
		if boundary == "" || writeManagedImageMultipartHash(target, storage, boundary) != nil {
			if err := writeManagedImageRawBodyHash(target, storage); err != nil {
				return "", err
			}
		}
	default:
		if err := writeManagedImageRawBodyHash(target, storage); err != nil {
			return "", err
		}
	}

	return hex.EncodeToString(target.Sum(nil)), nil
}

func managedImageIdempotencyError(c *gin.Context, status int, code string, message string) {
	c.Header("Cache-Control", "no-store")
	c.AbortWithStatusJSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    "idempotency_error",
			"code":    code,
		},
	})
}

func replayManagedImageResult(c *gin.Context, result managedImageIdempotencyResult) {
	if result.state == managedImageIdempotencyUnavailable {
		managedImageIdempotencyError(c, http.StatusServiceUnavailable, "idempotency_unavailable", "暂时无法保障本次生图请求不会重复执行，请稍后重试。")
		return
	}
	if result.state == managedImageIdempotencyMismatch {
		managedImageIdempotencyError(c, http.StatusConflict, "idempotency_payload_mismatch", "同一个 Idempotency-Key 已用于不同的生图请求，请为新请求生成新的键。")
		return
	}
	if result.state == model.ManagedImageIdempotencyProcessing {
		c.Header("Retry-After", "2")
		managedImageIdempotencyError(c, http.StatusTooEarly, "idempotency_request_in_progress", "相同的生图请求仍在处理中，请稍后使用同一个 Idempotency-Key 查询结果。")
		return
	}
	if result.state == model.ManagedImageIdempotencyUnknown {
		managedImageIdempotencyError(c, http.StatusConflict, "idempotency_outcome_unknown", "此前请求的最终状态无法确认。为避免重复扣费或重复生图，请核对历史结果后使用新的 Idempotency-Key。")
		return
	}

	contentType := strings.TrimSpace(result.contentType)
	if contentType == "" {
		contentType = "application/json; charset=utf-8"
	}
	if result.state == model.ManagedImageIdempotencyFailed {
		c.Header("Idempotency-Status", "replayed-failure")
	} else {
		c.Header("Idempotency-Status", "replayed")
	}
	if result.requestId != "" {
		c.Header("Idempotency-Original-Request-Id", result.requestId)
	}
	c.Header("Cache-Control", "private, no-store, max-age=0")
	c.Data(result.statusCode, contentType, result.body)
	c.Abort()
}

func resultFromManagedImageRecord(record model.ManagedImageIdempotencyRecord, config managedImageIdempotencyConfig) managedImageIdempotencyResult {
	body := append([]byte(nil), record.ResponseBody...)
	if record.ResponseFile != "" {
		storedBody, err := readManagedImageResponseFile(config, record)
		if err != nil {
			now := config.now()
			invalidated, invalidateErr := model.InvalidateManagedImageIdempotencyResponseFile(
				record.ScopeHash,
				record.RequestHash,
				record.ResponseFile,
				now.Unix(),
				now.Add(config.ttl).Unix(),
			)
			if invalidateErr != nil {
				common.SysError("invalidate managed image response file: " + invalidateErr.Error())
			}
			if invalidated {
				removeManagedImageResponseFile(config.storageDir, record.ResponseFile)
			}
			return managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: record.RequestId}
		}
		body = storedBody
	}
	if len(body) == 0 {
		return managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: record.RequestId}
	}
	return managedImageIdempotencyResult{
		state:       record.State,
		statusCode:  record.StatusCode,
		contentType: record.ContentType,
		body:        body,
		requestId:   record.RequestId,
	}
}

func managedImageExistingResult(
	record model.ManagedImageIdempotencyRecord,
	now time.Time,
	processingLease time.Duration,
	config managedImageIdempotencyConfig,
) managedImageIdempotencyResult {
	if record.State == model.ManagedImageIdempotencyProcessing {
		if now.Sub(time.Unix(record.UpdatedAt, 0)) <= processingLease {
			return managedImageIdempotencyResult{state: model.ManagedImageIdempotencyProcessing, requestId: record.RequestId}
		}
		return managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: record.RequestId}
	}
	if record.State == model.ManagedImageIdempotencySucceeded || record.State == model.ManagedImageIdempotencyFailed {
		return resultFromManagedImageRecord(record, config)
	}
	return managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: record.RequestId}
}

// ManagedImageIdempotency coalesces matching managed image requests before
// channel selection and billing. The client header remains optional for
// backward compatibility; callers that provide it receive durable replay and
// explicit mismatch/unknown semantics.
func ManagedImageIdempotency() gin.HandlerFunc {
	return managedImageIdempotency(defaultManagedImageIdempotencyConfig())
}

func managedImageIdempotency(config managedImageIdempotencyConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !isManagedImageRelayRequest(c) {
			c.Next()
			return
		}

		idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if idempotencyKey == "" {
			c.Next()
			return
		}
		if !validManagedImageIdempotencyKey(idempotencyKey) {
			managedImageIdempotencyError(c, http.StatusBadRequest, "idempotency_key_invalid", "Idempotency-Key 必须是 1 至 255 个可打印 ASCII 字符。")
			return
		}
		userId := c.GetInt("id")
		if userId <= 0 {
			managedImageIdempotencyError(c, http.StatusUnauthorized, "idempotency_identity_missing", "无法确认当前生图请求的用户身份，请重新登录。")
			return
		}
		requestHash, err := managedImageRequestHash(c)
		if err != nil {
			if common.IsRequestBodyTooLargeError(err) {
				managedImageIdempotencyError(c, http.StatusRequestEntityTooLarge, "idempotency_request_too_large", "本次生图请求过大，请压缩参考图后使用新的 Idempotency-Key 重试。")
				return
			}
			managedImageIdempotencyError(c, http.StatusBadRequest, "idempotency_request_unreadable", "无法读取本次生图请求，请检查图片或参数后重试。")
			return
		}

		scopeHash := managedImageScopeHash(userId, idempotencyKey)
		call, leader, mismatch := config.flights.begin(scopeHash, requestHash)
		if mismatch {
			managedImageIdempotencyError(c, http.StatusConflict, "idempotency_payload_mismatch", "同一个 Idempotency-Key 已用于不同的生图请求，请为新请求生成新的键。")
			return
		}
		if !leader {
			select {
			case <-call.done:
				replayManagedImageResult(c, call.result)
			case <-c.Request.Context().Done():
				c.Abort()
			}
			return
		}

		finalResult := managedImageIdempotencyResult{state: managedImageIdempotencyUnavailable}
		claimed := false
		claimFinished := false
		defer func() {
			if claimed && !claimFinished {
				now := config.now()
				if markErr := model.MarkManagedImageIdempotencyUnknown(
					scopeHash,
					requestHash,
					c.GetString(common.RequestIdKey),
					now.Unix(),
					now.Add(config.ttl).Unix(),
				); markErr != nil {
					common.SysError("mark managed image idempotency unknown: " + markErr.Error())
				}
				finalResult = managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown}
			}
			config.flights.finish(scopeHash, call, finalResult)
		}()

		now := config.now()
		config.cleanup.run(now, config.cleanupInterval, config.cleanupBatch, config.storageDir, config.ttl+config.processingLease+5*time.Minute)
		managedImageIdempotencyCapacityMu.Lock()
		record, didClaim, claimErr := model.ClaimManagedImageIdempotency(model.ManagedImageIdempotencyRecord{
			ScopeHash:   scopeHash,
			UserId:      userId,
			RequestHash: requestHash,
			RequestId:   c.GetString(common.RequestIdKey),
			ExpiresAt:   now.Add(config.ttl).Unix(),
		}, now.Unix(), config.maxRecords, config.maxUserRecords)
		managedImageIdempotencyCapacityMu.Unlock()
		if claimErr != nil {
			if errors.Is(claimErr, model.ErrManagedImageIdempotencyCapacity) {
				managedImageIdempotencyError(c, http.StatusServiceUnavailable, "idempotency_capacity_reached", "生图请求保护队列暂时繁忙，请稍后重试。")
				return
			}
			managedImageIdempotencyError(c, http.StatusServiceUnavailable, "idempotency_unavailable", "暂时无法保障本次生图请求不会重复执行，请稍后重试。")
			return
		}
		if !didClaim {
			if record.RequestHash != requestHash {
				finalResult = managedImageIdempotencyResult{state: managedImageIdempotencyMismatch}
				managedImageIdempotencyError(c, http.StatusConflict, "idempotency_payload_mismatch", "同一个 Idempotency-Key 已用于不同的生图请求，请为新请求生成新的键。")
				return
			}
			finalResult = managedImageExistingResult(record, now, config.processingLease, config)
			replayManagedImageResult(c, finalResult)
			return
		}
		claimed = true

		// Do not expose the raw client key to a shared upstream account. A stable
		// user-scoped derivative still lets compatible upstreams deduplicate. Its
		// wire prefix intentionally remains stable across the public route rename.
		c.Request.Header.Set("Idempotency-Key", managedImageUpstreamIdempotencyPrefix+scopeHash)
		c.Header("Idempotency-Status", "created")
		capture, captureCreateErr := newManagedImageCaptureWriter(c.Writer, config.storageDir, config.maxResponseBytes)
		if captureCreateErr != nil {
			claimFinished = true
			_ = model.ReleaseManagedImageIdempotency(scopeHash, requestHash)
			managedImageIdempotencyError(c, http.StatusServiceUnavailable, "idempotency_storage_unavailable", "生图结果保护存储暂时不可用，请稍后重试。")
			return
		}
		defer capture.discard()
		c.Writer = capture
		c.Next()

		completedAt := config.now()
		requestId := c.GetString(common.RequestIdKey)
		statusCode := capture.Status()
		contentType := strings.TrimSpace(capture.Header().Get("Content-Type"))
		if len(contentType) > 255 {
			contentType = contentType[:255]
		}
		responseBody, responseCaptureErr := capture.responseBody()
		if c.GetBool(common.ManagedImageOutcomeUnknownKey) {
			claimFinished = true
			if markErr := model.MarkManagedImageIdempotencyUnknown(
				scopeHash,
				requestHash,
				requestId,
				completedAt.Unix(),
				completedAt.Add(config.ttl).Unix(),
			); markErr != nil {
				common.SysError("mark ambiguous managed image response unknown: " + markErr.Error())
			}
			finalResult = managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: requestId}
			return
		}
		if managedImageTransientStatus(statusCode) {
			claimFinished = true
			releaseErr := model.ReleaseManagedImageIdempotency(scopeHash, requestHash)
			if releaseErr != nil {
				if markErr := model.MarkManagedImageIdempotencyUnknown(
					scopeHash,
					requestHash,
					requestId,
					completedAt.Unix(),
					completedAt.Add(config.transientLease).Unix(),
				); markErr != nil {
					common.SysError("release transient managed image idempotency: " + releaseErr.Error() + "; mark unknown: " + markErr.Error())
				}
			}
			if capture.overflow || responseCaptureErr != nil {
				finalResult = managedImageIdempotencyResult{state: managedImageIdempotencyUnavailable, requestId: requestId}
			} else {
				finalResult = managedImageIdempotencyResult{
					state:       model.ManagedImageIdempotencyFailed,
					statusCode:  statusCode,
					contentType: contentType,
					body:        responseBody,
					requestId:   requestId,
				}
			}
			return
		}
		if capture.overflow || responseCaptureErr != nil || !managedImageSuccessfulResponseComplete(
			statusCode,
			contentType,
			responseBody,
			capture.writeErr,
			c.Request.Context().Err(),
		) {
			claimFinished = true
			if markErr := model.MarkManagedImageIdempotencyUnknown(
				scopeHash,
				requestHash,
				requestId,
				completedAt.Unix(),
				completedAt.Add(config.ttl).Unix(),
			); markErr != nil {
				common.SysError("mark oversized managed image response unknown: " + markErr.Error())
			}
			finalResult = managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: requestId}
			return
		}

		state := model.ManagedImageIdempotencySucceeded
		if statusCode < http.StatusOK || statusCode >= http.StatusMultipleChoices {
			state = model.ManagedImageIdempotencyFailed
		}
		responseBodyForDatabase := responseBody
		responseFile := ""
		responseSize := int64(0)
		responseHash := ""
		managedImageIdempotencyCapacityMu.Lock()
		var completeErr error
		if state == model.ManagedImageIdempotencySucceeded {
			responseFile, responseSize, responseHash, completeErr = capture.commit(scopeHash)
			if completeErr == nil {
				responseBodyForDatabase = nil
			}
		}
		if completeErr == nil {
			completeErr = model.CompleteManagedImageIdempotency(
				scopeHash,
				userId,
				requestHash,
				state,
				statusCode,
				contentType,
				responseBodyForDatabase,
				responseFile,
				responseSize,
				responseHash,
				requestId,
				completedAt.Unix(),
				completedAt.Add(config.ttl).Unix(),
				config.maxStoredBytes,
				config.maxUserStoredBytes,
			)
		}
		managedImageIdempotencyCapacityMu.Unlock()
		claimFinished = true
		if completeErr != nil {
			if responseFile != "" {
				removeManagedImageResponseFile(config.storageDir, responseFile)
			}
			if markErr := model.MarkManagedImageIdempotencyUnknown(
				scopeHash,
				requestHash,
				requestId,
				completedAt.Unix(),
				completedAt.Add(config.ttl).Unix(),
			); markErr != nil {
				common.SysError("complete managed image idempotency: " + completeErr.Error() + "; mark unknown: " + markErr.Error())
			}
			finalResult = managedImageIdempotencyResult{state: model.ManagedImageIdempotencyUnknown, requestId: requestId}
			return
		}
		finalResult = managedImageIdempotencyResult{
			state:       state,
			statusCode:  statusCode,
			contentType: contentType,
			body:        responseBody,
			requestId:   requestId,
		}
	}
}
