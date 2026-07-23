package controller

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	desktopReleaseSchemaVersion = 1
	desktopReleaseProduct       = "naimage-studio"
	desktopReleaseLegacyProduct = "iiimage-studio"
	desktopDownloadPath         = "/downloads/naimage-studio/windows"
	desktopDownloadLegacyPath   = "/downloads/iiimage-studio/windows"
	desktopClientProductHeader  = "X-Naimage-Desktop-Product"
)

type desktopReleaseArtifactFile struct {
	Filename string `json:"filename"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
}

type desktopReleaseFile struct {
	SchemaVersion  int                         `json:"schema_version"`
	Product        string                      `json:"product"`
	Channel        string                      `json:"channel"`
	Version        string                      `json:"version"`
	PublishedAt    string                      `json:"published_at"`
	MinimumVersion string                      `json:"minimum_version"`
	Compatibility  string                      `json:"compatibility"`
	Notes          []string                    `json:"notes"`
	Signature      string                      `json:"signature"`
	Restart        *desktopReleaseArtifactFile `json:"restart,omitempty"`
	Installer      desktopReleaseArtifactFile  `json:"installer"`
}

type desktopReleaseManifest struct {
	SchemaVersion  int
	Product        string
	Channel        string
	Version        string
	PublishedAt    string
	MinimumVersion string
	Compatibility  string
	Notes          []string
	Signature      string
	Restart        *desktopInstallerManifest
	Installer      desktopInstallerManifest
}

type desktopReleaseCacheState struct {
	mu       sync.Mutex
	cacheKey string
	release  desktopReleaseManifest
	err      error
}

type desktopUpdateRequest struct {
	Product        string `json:"product"`
	CurrentVersion string `json:"current_version"`
	Platform       string `json:"platform"`
	Architecture   string `json:"architecture"`
	Compatibility  string `json:"compatibility"`
}

func desktopClientProduct(c *gin.Context, supplied string) string {
	product := strings.TrimSpace(c.GetHeader(desktopClientProductHeader))
	supplied = strings.TrimSpace(supplied)
	if product != "" && supplied != "" && !strings.EqualFold(product, supplied) {
		return "invalid-conflicting-desktop-product"
	}
	if product != "" {
		return product
	}
	return supplied
}

func desktopClientProductSupported(product string) bool {
	product = strings.TrimSpace(product)
	return product == "" ||
		strings.EqualFold(product, desktopReleaseProduct) ||
		strings.EqualFold(product, desktopReleaseLegacyProduct)
}

func desktopReleaseProductForClient(product string) string {
	if strings.EqualFold(strings.TrimSpace(product), desktopReleaseProduct) {
		return desktopReleaseProduct
	}
	return desktopReleaseLegacyProduct
}

func desktopDownloadPathForProduct(product string) string {
	if strings.EqualFold(strings.TrimSpace(product), desktopReleaseProduct) {
		return desktopDownloadPath
	}
	// Clients released before the rename reject any URL outside the legacy
	// prefix. A missing declaration therefore stays on the direct alias;
	// unknown declarations are rejected before this helper is called.
	return desktopDownloadLegacyPath
}

type desktopResolvedUpdate struct {
	CurrentVersion  string
	UpdateAvailable bool
	UpdateType      string
	RequiresCaptcha bool
	Release         desktopReleaseManifest
	Artifact        desktopInstallerManifest
}

var (
	desktopReleaseCache       desktopReleaseCacheState
	desktopReleaseLegacyCache desktopReleaseCacheState
)

func desktopReleaseCacheForProduct(product string) *desktopReleaseCacheState {
	if desktopReleaseProductForClient(product) == desktopReleaseLegacyProduct {
		return &desktopReleaseLegacyCache
	}
	return &desktopReleaseCache
}

func desktopSemver(value string) ([3]int, bool) {
	var parsed [3]int
	clean := strings.TrimSpace(value)
	if index := strings.IndexAny(clean, "-+"); index >= 0 {
		clean = clean[:index]
	}
	parts := strings.Split(clean, ".")
	if len(parts) != len(parsed) {
		return parsed, false
	}
	for index, part := range parts {
		if part == "" {
			return parsed, false
		}
		item, err := strconv.Atoi(part)
		if err != nil || item < 0 {
			return parsed, false
		}
		parsed[index] = item
	}
	return parsed, true
}

func compareDesktopSemver(left string, right string) (int, bool) {
	leftVersion, leftOK := desktopSemver(left)
	rightVersion, rightOK := desktopSemver(right)
	if !leftOK || !rightOK {
		return 0, false
	}
	for index := range leftVersion {
		if leftVersion[index] < rightVersion[index] {
			return -1, true
		}
		if leftVersion[index] > rightVersion[index] {
			return 1, true
		}
	}
	return 0, true
}

func desktopArtifactFromFile(directory string, version string, kind string, source desktopReleaseArtifactFile) (desktopInstallerManifest, error) {
	filename := strings.TrimSpace(source.Filename)
	if filename == "" || filepath.Base(filename) != filename {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	extension := strings.ToLower(filepath.Ext(filename))
	if (kind == "installer" && extension != ".exe") || (kind == "restart" && extension != ".asar") {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	path := filepath.Join(directory, filename)
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || (source.Size > 0 && source.Size != info.Size()) {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	expectedHash := strings.ToLower(strings.TrimSpace(source.SHA256))
	if len(expectedHash) != 64 {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	file, err := os.Open(path)
	if err != nil {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	hasher := sha256.New()
	_, copyErr := io.Copy(hasher, file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(expectedHash), []byte(actualHash)) != 1 {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	return desktopInstallerManifest{
		Path:       path,
		Kind:       kind,
		Filename:   filename,
		Version:    version,
		SHA256:     actualHash,
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UnixNano(),
	}, nil
}

func desktopReleaseManifestPathForProduct(product string) string {
	if desktopReleaseProductForClient(product) == desktopReleaseLegacyProduct {
		if legacyPath := strings.TrimSpace(os.Getenv("DESKTOP_RELEASE_LEGACY_MANIFEST_PATH")); legacyPath != "" {
			return legacyPath
		}
	}
	return strings.TrimSpace(os.Getenv("DESKTOP_RELEASE_MANIFEST_PATH"))
}

func loadDesktopReleaseManifestForProduct(product string) (desktopReleaseManifest, error) {
	configuredPath := desktopReleaseManifestPathForProduct(product)
	if configuredPath == "" {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	manifestPath, err := filepath.Abs(configuredPath)
	if err != nil {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	manifestInfo, err := os.Stat(manifestPath)
	if err != nil || !manifestInfo.Mode().IsRegular() || manifestInfo.Size() <= 0 || manifestInfo.Size() > 256*1024 {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	contents, err := os.ReadFile(manifestPath)
	if err != nil {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	var source desktopReleaseFile
	if err := common.Unmarshal(contents, &source); err != nil {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	expectedProduct := desktopReleaseProductForClient(product)
	manifestProduct := strings.TrimSpace(source.Product)
	if source.SchemaVersion != desktopReleaseSchemaVersion ||
		manifestProduct != expectedProduct {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	if _, valid := desktopSemver(source.Version); !valid {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	if source.MinimumVersion != "" {
		if _, valid := desktopSemver(source.MinimumVersion); !valid {
			return desktopReleaseManifest{}, errDesktopInstallerNotReady
		}
	}
	if strings.TrimSpace(source.Signature) == "" {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	if _, err := base64.StdEncoding.DecodeString(source.Signature); err != nil {
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	directory := filepath.Dir(manifestPath)
	artifactStats := []string{manifestPath, strconv.FormatInt(manifestInfo.Size(), 10), strconv.FormatInt(manifestInfo.ModTime().UnixNano(), 10)}
	for _, artifact := range []*desktopReleaseArtifactFile{&source.Installer, source.Restart} {
		if artifact == nil || strings.TrimSpace(artifact.Filename) == "" {
			continue
		}
		info, statErr := os.Stat(filepath.Join(directory, filepath.Base(strings.TrimSpace(artifact.Filename))))
		if statErr != nil {
			return desktopReleaseManifest{}, errDesktopInstallerNotReady
		}
		artifactStats = append(artifactStats, artifact.Filename, strconv.FormatInt(info.Size(), 10), strconv.FormatInt(info.ModTime().UnixNano(), 10))
	}
	cacheKey := strings.Join(artifactStats, "|")
	cache := desktopReleaseCacheForProduct(expectedProduct)
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.cacheKey == cacheKey {
		return cache.release, cache.err
	}
	installer, err := desktopArtifactFromFile(directory, source.Version, "installer", source.Installer)
	if err != nil {
		cache.cacheKey = cacheKey
		cache.release = desktopReleaseManifest{}
		cache.err = errDesktopInstallerNotReady
		return desktopReleaseManifest{}, errDesktopInstallerNotReady
	}
	var restart *desktopInstallerManifest
	if source.Restart != nil && strings.TrimSpace(source.Restart.Filename) != "" {
		artifact, artifactErr := desktopArtifactFromFile(directory, source.Version, "restart", *source.Restart)
		if artifactErr != nil {
			cache.cacheKey = cacheKey
			cache.release = desktopReleaseManifest{}
			cache.err = errDesktopInstallerNotReady
			return desktopReleaseManifest{}, errDesktopInstallerNotReady
		}
		restart = &artifact
	}
	notes := make([]string, 0, len(source.Notes))
	for _, note := range source.Notes {
		clean := strings.TrimSpace(note)
		if clean != "" && len(notes) < 12 {
			notes = append(notes, clean)
		}
	}
	release := desktopReleaseManifest{
		SchemaVersion: source.SchemaVersion,
		// Preserve the signed product identity exactly. New manifests use
		// naimage-studio, while historical iiimage-studio manifests must keep
		// their original value so desktop signature verification still works.
		Product:        manifestProduct,
		Channel:        strings.TrimSpace(source.Channel),
		Version:        strings.TrimSpace(source.Version),
		PublishedAt:    strings.TrimSpace(source.PublishedAt),
		MinimumVersion: strings.TrimSpace(source.MinimumVersion),
		Compatibility:  strings.TrimSpace(source.Compatibility),
		Notes:          notes,
		Signature:      strings.TrimSpace(source.Signature),
		Restart:        restart,
		Installer:      installer,
	}
	cache.cacheKey = cacheKey
	cache.release = release
	cache.err = nil
	return release, nil
}

func loadDesktopReleaseManifest() (desktopReleaseManifest, error) {
	return loadDesktopReleaseManifestForProduct(desktopReleaseProduct)
}

func resolveDesktopUpdate(request desktopUpdateRequest) (desktopResolvedUpdate, error) {
	if !desktopClientProductSupported(request.Product) {
		return desktopResolvedUpdate{}, errors.New("unsupported desktop product")
	}
	current := strings.TrimSpace(request.CurrentVersion)
	currentSemver, currentOK := desktopSemver(current)
	if !currentOK {
		return desktopResolvedUpdate{}, errors.New("invalid current desktop version")
	}
	platform := strings.ToLower(strings.TrimSpace(request.Platform))
	architecture := strings.ToLower(strings.TrimSpace(request.Architecture))
	if platform != "win32" && platform != "windows" {
		return desktopResolvedUpdate{}, errors.New("unsupported desktop platform")
	}
	if architecture != "x64" {
		return desktopResolvedUpdate{}, errors.New("unsupported desktop architecture")
	}
	release, err := loadDesktopReleaseManifestForProduct(request.Product)
	if err != nil {
		return desktopResolvedUpdate{}, errDesktopInstallerNotReady
	}
	comparison, valid := compareDesktopSemver(current, release.Version)
	if !valid {
		return desktopResolvedUpdate{}, errDesktopInstallerNotReady
	}
	resolved := desktopResolvedUpdate{
		CurrentVersion:  current,
		UpdateAvailable: comparison < 0,
		UpdateType:      "none",
		Release:         release,
	}
	if !resolved.UpdateAvailable {
		return resolved, nil
	}
	latestSemver, _ := desktopSemver(release.Version)
	minimumOK := true
	if release.MinimumVersion != "" {
		minimumComparison, comparable := compareDesktopSemver(current, release.MinimumVersion)
		minimumOK = comparable && minimumComparison >= 0
	}
	compatibility := strings.TrimSpace(request.Compatibility)
	canRestart := release.Restart != nil &&
		currentSemver[0] == latestSemver[0] &&
		minimumOK &&
		compatibility != "" &&
		subtle.ConstantTimeCompare([]byte(compatibility), []byte(release.Compatibility)) == 1
	if canRestart {
		resolved.UpdateType = "restart"
		resolved.Artifact = *release.Restart
		return resolved, nil
	}
	resolved.UpdateType = "installer"
	resolved.RequiresCaptcha = true
	resolved.Artifact = release.Installer
	return resolved, nil
}

func desktopReleaseResponse(resolved desktopResolvedUpdate) gin.H {
	return gin.H{
		"schema_version":   resolved.Release.SchemaVersion,
		"product":          resolved.Release.Product,
		"channel":          resolved.Release.Channel,
		"current_version":  resolved.CurrentVersion,
		"latest_version":   resolved.Release.Version,
		"published_at":     resolved.Release.PublishedAt,
		"minimum_version":  resolved.Release.MinimumVersion,
		"compatibility":    resolved.Release.Compatibility,
		"notes":            resolved.Release.Notes,
		"signature":        resolved.Release.Signature,
		"restart":          resolved.Release.Restart,
		"installer":        resolved.Release.Installer,
		"update_available": resolved.UpdateAvailable,
		"update_type":      resolved.UpdateType,
		"requires_captcha": resolved.RequiresCaptcha,
		"artifact":         resolved.Artifact,
	}
}

func desktopUpdateRequestFromContext(c *gin.Context) desktopUpdateRequest {
	return desktopUpdateRequest{
		Product:        desktopClientProduct(c, c.Query("product")),
		CurrentVersion: strings.TrimSpace(c.Query("current_version")),
		Platform:       strings.TrimSpace(c.Query("platform")),
		Architecture:   strings.TrimSpace(c.Query("architecture")),
		Compatibility:  strings.TrimSpace(c.Query("compatibility")),
	}
}

func CheckDesktopUpdate(c *gin.Context) {
	if !requireCurrentDesktopUser(c) {
		return
	}
	resolved, err := resolveDesktopUpdate(desktopUpdateRequestFromContext(c))
	if err != nil {
		if errors.Is(err, errDesktopInstallerNotReady) {
			desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_update_not_ready", "更新服务暂不可用，请稍后再试。")
			return
		}
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_update_request_invalid", "当前客户端版本或平台信息无效。")
		return
	}
	c.Header("Cache-Control", "private, no-store, max-age=0")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": desktopReleaseResponse(resolved)})
}

func desktopUpdateLimits() model.DesktopDownloadLimits {
	return model.DesktopDownloadLimits{
		IPHourly:   desktopPositiveEnv("DESKTOP_UPDATE_IP_HOURLY_LIMIT", 12),
		IPDaily:    desktopPositiveEnv("DESKTOP_UPDATE_IP_DAILY_LIMIT", 50),
		UserHourly: desktopPositiveEnv("DESKTOP_UPDATE_USER_HOURLY_LIMIT", 8),
		UserDaily:  desktopPositiveEnv("DESKTOP_UPDATE_USER_DAILY_LIMIT", 30),
	}
}

func AuthorizeDesktopRestartUpdate(c *gin.Context) {
	if !requireCurrentDesktopUser(c) {
		return
	}
	var request desktopUpdateRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_update_request_invalid", "更新请求无效，请重新检查更新。")
		return
	}
	request.Product = desktopClientProduct(c, request.Product)
	resolved, err := resolveDesktopUpdate(request)
	if err != nil || !resolved.UpdateAvailable || resolved.UpdateType != "restart" {
		desktopDownloadFailure(c, http.StatusConflict, "desktop_restart_update_unavailable", "当前版本不能使用重启更新，请重新检查更新。")
		return
	}
	identity := desktopIdentity(c, c.GetInt("id"))
	reserveErr := model.ReserveDesktopDownload(identity.UserID, identity.IP, time.Now(), desktopUpdateLimits(), map[string]interface{}{
		"kind":            "restart-update",
		"filename":        resolved.Artifact.Filename,
		"version":         resolved.Artifact.Version,
		"sha256":          resolved.Artifact.SHA256,
		"size":            resolved.Artifact.Size,
		"current_version": resolved.CurrentVersion,
		"compatibility":   resolved.Release.Compatibility,
	})
	if errors.Is(reserveErr, model.ErrDesktopDownloadRateLimited) {
		c.Header("Retry-After", "3600")
		desktopDownloadFailure(c, http.StatusTooManyRequests, "desktop_update_rate_limited", "当前账号或网络的更新下载次数已达上限，请稍后再试。")
		return
	}
	if reserveErr != nil {
		desktopDownloadFailure(c, http.StatusInternalServerError, "desktop_update_audit_failed", "更新授权失败，请稍后再试。")
		return
	}
	ticketID, err := defaultDesktopDownloadManager.issueTicket(identity, resolved.Artifact)
	if err != nil {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_update_ticket_unavailable", "更新授权失败，请稍后再试。")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"download_url": desktopDownloadPathForProduct(request.Product) + "?ticket=" + url.QueryEscape(ticketID),
			"expires_in":   int(desktopDownloadTicketTTL / time.Second),
			"release":      desktopReleaseResponse(resolved),
		},
	})
}
