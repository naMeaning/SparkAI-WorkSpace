package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeDesktopReleaseFixture(t *testing.T, version string, minimumVersion string, compatibility string) string {
	return writeDesktopReleaseFixtureForProduct(t, version, minimumVersion, compatibility, desktopReleaseProduct)
}

func writeDesktopReleaseFixtureForProduct(t *testing.T, version string, minimumVersion string, compatibility string, product string) string {
	t.Helper()
	directory := t.TempDir()
	installerName := "naimage-Setup-" + version + "-x64.exe"
	restartName := "naimage-Restart-Update-" + version + "-x64.asar"
	installerBytes := []byte("installer-" + version)
	restartBytes := []byte("restart-" + version)
	require.NoError(t, os.WriteFile(filepath.Join(directory, installerName), installerBytes, 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(directory, restartName), restartBytes, 0o600))
	installerDigest := sha256.Sum256(installerBytes)
	restartDigest := sha256.Sum256(restartBytes)
	manifest := desktopReleaseFile{
		SchemaVersion:  desktopReleaseSchemaVersion,
		Product:        product,
		Channel:        "stable",
		Version:        version,
		PublishedAt:    "2026-07-18T12:00:00Z",
		MinimumVersion: minimumVersion,
		Compatibility:  compatibility,
		Notes:          []string{"更新体验与稳定性。"},
		Signature:      base64.StdEncoding.EncodeToString([]byte("test-signature")),
		Restart: &desktopReleaseArtifactFile{
			Filename: restartName,
			SHA256:   hex.EncodeToString(restartDigest[:]),
			Size:     int64(len(restartBytes)),
		},
		Installer: desktopReleaseArtifactFile{
			Filename: installerName,
			SHA256:   hex.EncodeToString(installerDigest[:]),
			Size:     int64(len(installerBytes)),
		},
	}
	contents, err := common.Marshal(manifest)
	require.NoError(t, err)
	manifestName := "desktop-release.json"
	if product == desktopReleaseLegacyProduct {
		manifestName = "desktop-release-legacy.json"
	}
	path := filepath.Join(directory, manifestName)
	require.NoError(t, os.WriteFile(path, contents, 0o600))
	cache := desktopReleaseCacheForProduct(product)
	cache.mu.Lock()
	cache.cacheKey = ""
	cache.release = desktopReleaseManifest{}
	cache.err = nil
	cache.mu.Unlock()
	if product == desktopReleaseLegacyProduct {
		t.Setenv("DESKTOP_RELEASE_LEGACY_MANIFEST_PATH", path)
	} else {
		t.Setenv("DESKTOP_RELEASE_MANIFEST_PATH", path)
	}
	return path
}

func TestDesktopDownloadChallengeIsOneTimeAndIdentityBound(t *testing.T) {
	manager := newDesktopDownloadManager()
	now := time.Unix(1_800_000_000, 0)
	manager.now = func() time.Time { return now }
	identity := desktopDownloadIdentity{UserID: 8, IP: "203.0.113.8", UserAgent: "browser-a"}

	challengeID, answer, err := manager.issueChallenge(identity)
	require.NoError(t, err)
	require.ErrorIs(t, manager.verifyChallenge(challengeID, answer, desktopDownloadIdentity{
		UserID: 8, IP: "203.0.113.9", UserAgent: "browser-a",
	}), errDesktopChallengeInvalid)
	require.ErrorIs(t, manager.verifyChallenge(challengeID, answer, identity), errDesktopChallengeInvalid)

	challengeID, answer, err = manager.issueChallenge(identity)
	require.NoError(t, err)
	require.NoError(t, manager.verifyChallenge(challengeID, answer, identity))
	require.ErrorIs(t, manager.verifyChallenge(challengeID, answer, identity), errDesktopChallengeInvalid)
}

func TestDesktopDownloadChallengeExpires(t *testing.T) {
	manager := newDesktopDownloadManager()
	now := time.Unix(1_800_000_000, 0)
	manager.now = func() time.Time { return now }
	identity := desktopDownloadIdentity{UserID: 8, IP: "198.51.100.8", UserAgent: "browser-a"}
	challengeID, answer, err := manager.issueChallenge(identity)
	require.NoError(t, err)
	now = now.Add(desktopDownloadChallengeTTL + time.Second)
	require.ErrorIs(t, manager.verifyChallenge(challengeID, answer, identity), errDesktopChallengeExpired)
}

func TestDesktopDownloadChallengeBindsProductAndRelease(t *testing.T) {
	manager := newDesktopDownloadManager()
	identity := desktopDownloadIdentity{UserID: 8, IP: "198.51.100.9", UserAgent: "browser-a"}
	manifest := desktopInstallerManifest{
		Filename: "naimage-Setup-1.0.5-x64.exe",
		Version:  "1.0.5",
		SHA256:   strings.Repeat("a", 64),
		Size:     1024,
	}
	binding := desktopDownloadChallengeBinding{Product: desktopReleaseProduct, Manifest: manifest}

	challengeID, answer, err := manager.issueChallenge(identity, binding)
	require.NoError(t, err)
	require.ErrorIs(t, manager.verifyChallenge(challengeID, answer, identity, desktopDownloadChallengeBinding{
		Product:  desktopReleaseLegacyProduct,
		Manifest: manifest,
	}), errDesktopChallengeInvalid)

	challengeID, answer, err = manager.issueChallenge(identity, binding)
	require.NoError(t, err)
	changedManifest := manifest
	changedManifest.SHA256 = strings.Repeat("b", 64)
	require.ErrorIs(t, manager.verifyChallenge(challengeID, answer, identity, desktopDownloadChallengeBinding{
		Product:  desktopReleaseProduct,
		Manifest: changedManifest,
	}), errDesktopChallengeInvalid)
}

func TestCreateDesktopDownloadCaptchaDoesNotRotateSessionCookie(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")
	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/captcha", CreateDesktopDownloadCaptcha)
	request := httptest.NewRequest(http.MethodPost, "/captcha", nil)
	request.Header.Set("User-Agent", "naimage-captcha-test")
	request.Header.Set(desktopClientProductHeader, desktopReleaseProduct)
	request.RemoteAddr = "203.0.113.17:42000"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Empty(t, recorder.Header().Values("Set-Cookie"))
	require.Contains(t, recorder.Body.String(), "challenge_id")
}

func TestDesktopDownloadChallengesAuthorizeOutOfOrderWithoutCookieState(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")
	t.Setenv("DESKTOP_DOWNLOAD_IP_HOURLY_LIMIT", "20")
	t.Setenv("DESKTOP_DOWNLOAD_IP_DAILY_LIMIT", "20")
	t.Setenv("DESKTOP_DOWNLOAD_USER_HOURLY_LIMIT", "20")
	t.Setenv("DESKTOP_DOWNLOAD_USER_DAILY_LIMIT", "20")

	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})

	identity := desktopDownloadIdentity{
		UserID:    user.Id,
		IP:        "203.0.113.18",
		UserAgent: "naimage-download-test",
	}
	type challengeAnswer struct {
		challengeId string
		answer      string
	}
	issued := make([]challengeAnswer, 2)
	manifest, err := loadDesktopInstallerManifestForProduct(desktopReleaseProduct)
	require.NoError(t, err)
	binding := desktopDownloadChallengeBinding{Product: desktopReleaseProduct, Manifest: manifest}
	for index := range issued {
		challengeId, answer, err := manager.issueChallenge(identity, binding)
		require.NoError(t, err)
		issued[index] = challengeAnswer{challengeId: challengeId, answer: answer}
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/authorize", AuthorizeDesktopDownload)

	recorders := make([]*httptest.ResponseRecorder, len(issued))
	payloads := make([][]byte, len(issued))
	for index := range issued {
		payload, err := common.Marshal(desktopDownloadRequest{
			Product:     desktopReleaseProduct,
			ChallengeID: issued[len(issued)-1-index].challengeId,
			Code:        issued[len(issued)-1-index].answer,
		})
		require.NoError(t, err)
		payloads[index] = payload
	}
	var waitGroup sync.WaitGroup
	for index := range payloads {
		waitGroup.Add(1)
		go func(resultIndex int, payload []byte) {
			defer waitGroup.Done()
			request := httptest.NewRequest(http.MethodPost, "/authorize", bytes.NewReader(payload))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("User-Agent", identity.UserAgent)
			request.Header.Set(desktopClientProductHeader, desktopReleaseProduct)
			request.RemoteAddr = identity.IP + ":41000"
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)
			recorders[resultIndex] = recorder
		}(index, payloads[index])
	}
	waitGroup.Wait()

	for _, recorder := range recorders {
		require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
		require.Empty(t, recorder.Header().Values("Set-Cookie"))
		require.Contains(t, recorder.Body.String(), `"download_url":"/downloads/naimage-studio/windows?ticket=`)
	}
	var auditCount int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&auditCount).Error)
	require.Equal(t, int64(2), auditCount)
}

func TestAuthorizeDesktopDownloadRejectsProductSwitchAfterCaptcha(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixture(t, "1.0.5", "1.0.5", "win-x64-electron42-runtime1")
	writeDesktopReleaseFixtureForProduct(t, "1.0.5", "1.0.5", "win-x64-electron42-runtime1", desktopReleaseLegacyProduct)

	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})
	identity := desktopDownloadIdentity{
		UserID:    user.Id,
		IP:        "203.0.113.22",
		UserAgent: "naimage-product-binding-test",
	}
	manifest, err := loadDesktopInstallerManifestForProduct(desktopReleaseProduct)
	require.NoError(t, err)
	challengeID, answer, err := manager.issueChallenge(identity, desktopDownloadChallengeBinding{
		Product:  desktopReleaseProduct,
		Manifest: manifest,
	})
	require.NoError(t, err)
	payload, err := common.Marshal(desktopDownloadRequest{
		Product:     desktopReleaseLegacyProduct,
		ChallengeID: challengeID,
		Code:        answer,
	})
	require.NoError(t, err)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/authorize", AuthorizeDesktopDownload)
	request := httptest.NewRequest(http.MethodPost, "/authorize", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", identity.UserAgent)
	request.RemoteAddr = identity.IP + ":41000"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "download_captcha_invalid")
}

func TestAuthorizeDesktopDownloadWithoutProductUsesLegacyRoute(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixtureForProduct(t, "1.0.5", "1.0.5", "win-x64-electron42-runtime1", desktopReleaseLegacyProduct)
	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})
	identity := desktopDownloadIdentity{
		UserID:    user.Id,
		IP:        "203.0.113.23",
		UserAgent: "legacy-desktop-download-test",
	}
	manifest, err := loadDesktopInstallerManifestForProduct(desktopReleaseLegacyProduct)
	require.NoError(t, err)
	challengeID, answer, err := manager.issueChallenge(identity, desktopDownloadChallengeBinding{
		Product:  desktopReleaseLegacyProduct,
		Manifest: manifest,
	})
	require.NoError(t, err)
	payload, err := common.Marshal(desktopDownloadRequest{ChallengeID: challengeID, Code: answer})
	require.NoError(t, err)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/authorize", AuthorizeDesktopDownload)
	request := httptest.NewRequest(http.MethodPost, "/authorize", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", identity.UserAgent)
	request.RemoteAddr = identity.IP + ":41000"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), `"download_url":"/downloads/iiimage-studio/windows?ticket=`)
}

func TestDesktopDownloadTicketUsesAuthenticatedIdentityWithoutTicketCookieState(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")
	manifest, err := loadDesktopInstallerManifest()
	require.NoError(t, err)
	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})
	identity := desktopDownloadIdentity{
		UserID:    user.Id,
		IP:        "203.0.113.19",
		UserAgent: "naimage-ticket-test",
	}
	ticketId, err := manager.issueTicket(identity, manifest)
	require.NoError(t, err)

	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("desktop-download-test-secret"))))
	router.GET("/seed-session", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		session.Set("status", common.UserStatusEnabled)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	router.GET("/download", DownloadDesktopInstaller)

	seedRecorder := httptest.NewRecorder()
	seedRequest := httptest.NewRequest(http.MethodGet, "/seed-session", nil)
	router.ServeHTTP(seedRecorder, seedRequest)
	require.Equal(t, http.StatusNoContent, seedRecorder.Code)
	cookies := seedRecorder.Result().Cookies()
	require.NotEmpty(t, cookies)

	downloadRecorder := httptest.NewRecorder()
	downloadRequest := httptest.NewRequest(http.MethodGet, "/download?ticket="+url.QueryEscape(ticketId), nil)
	downloadRequest.Header.Set("User-Agent", identity.UserAgent)
	downloadRequest.RemoteAddr = identity.IP + ":43000"
	for _, sessionCookie := range cookies {
		downloadRequest.AddCookie(sessionCookie)
	}
	router.ServeHTTP(downloadRecorder, downloadRequest)
	require.Equal(t, http.StatusOK, downloadRecorder.Code, downloadRecorder.Body.String())
	require.Equal(t, []byte("installer-1.2.3"), downloadRecorder.Body.Bytes())
}

func TestDesktopDownloadReturnsServiceUnavailableWhenAccountStateCannotBeRead(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")
	manifest, err := loadDesktopInstallerManifest()
	require.NoError(t, err)
	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})
	identity := desktopDownloadIdentity{
		UserID:    user.Id,
		IP:        "203.0.113.21",
		UserAgent: "naimage-database-unavailable-test",
	}
	ticketID, err := manager.issueTicket(identity, manifest)
	require.NoError(t, err)

	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("desktop-database-unavailable-secret"))))
	router.GET("/seed-session", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		session.Set("status", common.UserStatusEnabled)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	router.GET("/download", DownloadDesktopInstaller)
	seedRecorder := httptest.NewRecorder()
	router.ServeHTTP(seedRecorder, httptest.NewRequest(http.MethodGet, "/seed-session", nil))
	require.Equal(t, http.StatusNoContent, seedRecorder.Code)
	cookies := seedRecorder.Result().Cookies()
	require.NotEmpty(t, cookies)

	sqlDB, err := model.DB.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())
	downloadRequest := httptest.NewRequest(http.MethodGet, "/download?ticket="+url.QueryEscape(ticketID), nil)
	downloadRequest.Header.Set("User-Agent", identity.UserAgent)
	downloadRequest.RemoteAddr = identity.IP + ":45000"
	for _, sessionCookie := range cookies {
		downloadRequest.AddCookie(sessionCookie)
	}
	downloadRecorder := httptest.NewRecorder()
	router.ServeHTTP(downloadRecorder, downloadRequest)
	require.Equal(t, http.StatusServiceUnavailable, downloadRecorder.Code, downloadRecorder.Body.String())
	assert.Contains(t, downloadRecorder.Body.String(), "desktop_client_account_check_failed")
}

func TestDesktopDownloadHandlerEnforcesRangeLeaseAndCompletionLifecycle(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")
	manifest, err := loadDesktopInstallerManifest()
	require.NoError(t, err)
	manager := newDesktopDownloadManager()
	previousManager := defaultDesktopDownloadManager
	defaultDesktopDownloadManager = manager
	t.Cleanup(func() {
		defaultDesktopDownloadManager = previousManager
	})
	identity := desktopDownloadIdentity{
		UserID:    user.Id,
		IP:        "203.0.113.20",
		UserAgent: "naimage-range-handler-test",
	}

	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("desktop-range-handler-secret"))))
	router.GET("/seed-session", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		session.Set("status", common.UserStatusEnabled)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	router.GET("/download", DownloadDesktopInstaller)
	seedRecorder := httptest.NewRecorder()
	router.ServeHTTP(seedRecorder, httptest.NewRequest(http.MethodGet, "/seed-session", nil))
	require.Equal(t, http.StatusNoContent, seedRecorder.Code)
	cookies := seedRecorder.Result().Cookies()
	require.NotEmpty(t, cookies)

	requestDownload := func(ticketID string, rangeHeader string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/download?ticket="+url.QueryEscape(ticketID), nil)
		request.Header.Set("User-Agent", identity.UserAgent)
		request.RemoteAddr = identity.IP + ":44000"
		if rangeHeader != "" {
			request.Header.Set("Range", rangeHeader)
		}
		for _, sessionCookie := range cookies {
			request.AddCookie(sessionCookie)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}

	t.Run("fresh ticket accepts first range and completion removes it", func(t *testing.T) {
		ticketID, issueErr := manager.issueTicket(identity, manifest)
		require.NoError(t, issueErr)
		response := requestDownload(ticketID, "bytes=5-")
		require.Equal(t, http.StatusPartialContent, response.Code, response.Body.String())
		assert.Equal(t, []byte("installer-1.2.3")[5:], response.Body.Bytes())
		assert.Equal(t, "bytes 5-14/15", response.Header().Get("Content-Range"))
		offset := int64(5)
		_, openErr := manager.openTicket(ticketID, identity, &offset)
		require.ErrorIs(t, openErr, errDesktopTicketInvalid)
	})

	t.Run("busy ticket maps to 425 and retry after", func(t *testing.T) {
		ticketID, issueErr := manager.issueTicket(identity, manifest)
		require.NoError(t, issueErr)
		_, openErr := manager.openTicket(ticketID, identity, nil)
		require.NoError(t, openErr)
		response := requestDownload(ticketID, "")
		require.Equal(t, http.StatusTooEarly, response.Code)
		assert.Equal(t, "2", response.Header().Get("Retry-After"))
		assert.Contains(t, response.Body.String(), "desktop_download_ticket_busy")
		manager.finishTicket(ticketID, identity, false)
	})

	t.Run("offset cannot move backwards but same offset can resume", func(t *testing.T) {
		ticketID, issueErr := manager.issueTicket(identity, manifest)
		require.NoError(t, issueErr)
		startOffset := int64(5)
		_, openErr := manager.openTicket(ticketID, identity, &startOffset)
		require.NoError(t, openErr)
		manager.finishTicket(ticketID, identity, false)
		backwards := requestDownload(ticketID, "bytes=4-")
		require.Equal(t, http.StatusRequestedRangeNotSatisfiable, backwards.Code)
		assert.Contains(t, backwards.Body.String(), "desktop_download_range_invalid")

		resumed := requestDownload(ticketID, "bytes=5-")
		require.Equal(t, http.StatusPartialContent, resumed.Code, resumed.Body.String())
		assert.Equal(t, []byte("installer-1.2.3")[5:], resumed.Body.Bytes())
		_, openErr = manager.openTicket(ticketID, identity, &startOffset)
		require.ErrorIs(t, openErr, errDesktopTicketInvalid)
	})

	t.Run("new captcha ticket may continue an existing client part", func(t *testing.T) {
		ticketID, issueErr := manager.issueTicket(identity, manifest)
		require.NoError(t, issueErr)
		response := requestDownload(ticketID, "bytes=7-")
		require.Equal(t, http.StatusPartialContent, response.Code, response.Body.String())
		assert.Equal(t, []byte("installer-1.2.3")[7:], response.Body.Bytes())
	})
}

func TestDesktopDownloadTicketAllowsOnlyRangeResume(t *testing.T) {
	manager := newDesktopDownloadManager()
	now := time.Unix(1_800_000_000, 0)
	manager.now = func() time.Time { return now }
	identity := desktopDownloadIdentity{UserID: 8, IP: "192.0.2.8", UserAgent: "browser-a"}
	manifest := desktopInstallerManifest{Path: "installer.exe", Filename: "installer.exe", Size: 12}
	ticketID, err := manager.issueTicket(identity, manifest)
	require.NoError(t, err)

	first, err := manager.openTicket(ticketID, identity, nil)
	require.NoError(t, err)
	require.Equal(t, manifest, first)
	_, err = manager.openTicket(ticketID, identity, nil)
	require.ErrorIs(t, err, errDesktopTicketBusy)
	manager.finishTicket(ticketID, identity, false)
	_, err = manager.openTicket(ticketID, identity, nil)
	require.ErrorIs(t, err, errDesktopTicketAlreadyUsed)
	resumeOffset := int64(5)
	resumed, err := manager.openTicket(ticketID, identity, &resumeOffset)
	require.NoError(t, err)
	require.Equal(t, manifest, resumed)
	manager.finishTicket(ticketID, identity, false)
	lowerOffset := int64(4)
	_, err = manager.openTicket(ticketID, identity, &lowerOffset)
	require.ErrorIs(t, err, errDesktopTicketResumeInvalid)
	resumed, err = manager.openTicket(ticketID, identity, &resumeOffset)
	require.NoError(t, err)
	require.Equal(t, manifest, resumed)
	manager.finishTicket(ticketID, identity, true)
	_, err = manager.openTicket(ticketID, identity, &resumeOffset)
	require.ErrorIs(t, err, errDesktopTicketInvalid)

	secondTicketID, err := manager.issueTicket(identity, manifest)
	require.NoError(t, err)
	crossTicketOffset := int64(7)
	resumed, err = manager.openTicket(secondTicketID, identity, &crossTicketOffset)
	require.NoError(t, err, "a fresh captcha ticket must resume an existing .part file")
	require.Equal(t, manifest, resumed)
	manager.finishTicket(secondTicketID, identity, true)
}

func TestDesktopDownloadTicketBoundsZeroProgressResumes(t *testing.T) {
	manager := newDesktopDownloadManager()
	manager.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	identity := desktopDownloadIdentity{UserID: 9, IP: "192.0.2.9", UserAgent: "browser-b"}
	ticketID, err := manager.issueTicket(identity, desktopInstallerManifest{Path: "installer.exe", Filename: "installer.exe", Size: 12})
	require.NoError(t, err)
	_, err = manager.openTicket(ticketID, identity, nil)
	require.NoError(t, err)
	manager.finishTicket(ticketID, identity, false)

	zero := int64(0)
	for index := 0; index < desktopDownloadMaxResumes; index++ {
		_, err = manager.openTicket(ticketID, identity, &zero)
		require.NoError(t, err)
		manager.finishTicket(ticketID, identity, false)
	}
	_, err = manager.openTicket(ticketID, identity, &zero)
	require.ErrorIs(t, err, errDesktopTicketResumeLimit)
}

func TestDesktopResumeOffsetAcceptsOnlyOpenEndedSingleRange(t *testing.T) {
	start, err := desktopResumeOffset("bytes=128-")
	require.NoError(t, err)
	require.NotNil(t, start)
	assert.Equal(t, int64(128), *start)
	start, err = desktopResumeOffset("")
	require.NoError(t, err)
	assert.Nil(t, start)
	for _, invalid := range []string{"bytes=0-1", "bytes=-128", "bytes=0-,128-", "items=0-", "bytes=+1-"} {
		_, err = desktopResumeOffset(invalid)
		assert.ErrorIs(t, err, errDesktopTicketResumeInvalid, invalid)
	}
}

func TestLoadDesktopInstallerManifestVerifiesExpectedHash(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "naimage-Setup-1.0.0-x64.exe")
	contents := []byte("test desktop installer")
	require.NoError(t, os.WriteFile(path, contents, 0o600))
	digest := sha256.Sum256(contents)
	expected := hex.EncodeToString(digest[:])
	t.Setenv("DESKTOP_INSTALLER_PATH", path)
	t.Setenv("DESKTOP_INSTALLER_FILENAME", "naimage.exe")
	t.Setenv("DESKTOP_INSTALLER_VERSION", "1.0.0")
	t.Setenv("DESKTOP_INSTALLER_SHA256", expected)

	manifest, err := loadDesktopInstallerManifest()
	require.NoError(t, err)
	require.Equal(t, expected, manifest.SHA256)
	require.Equal(t, int64(len(contents)), manifest.Size)
	require.Equal(t, "naimage.exe", manifest.Filename)

	t.Setenv("DESKTOP_INSTALLER_SHA256", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	_, err = loadDesktopInstallerManifest()
	require.True(t, errors.Is(err, errDesktopInstallerNotReady))
}

func TestRenderCaptchaPNGProducesRasterImage(t *testing.T) {
	encoded, err := renderCaptchaPNG("123456")
	require.NoError(t, err)
	require.Greater(t, len(encoded), 500)
	require.Equal(t, []byte{0x89, 0x50, 0x4e, 0x47}, encoded[:4])
}

func TestResolveDesktopUpdateChoosesRestartOnlyForCompatibleSameMajor(t *testing.T) {
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")

	restart, err := resolveDesktopUpdate(desktopUpdateRequest{
		Product:        desktopReleaseProduct,
		CurrentVersion: "1.2.2",
		Platform:       "win32",
		Architecture:   "x64",
		Compatibility:  "win-x64-electron42-runtime1",
	})
	require.NoError(t, err)
	require.True(t, restart.UpdateAvailable)
	require.Equal(t, desktopReleaseProduct, restart.Release.Product)
	require.Equal(t, "restart", restart.UpdateType)
	require.False(t, restart.RequiresCaptcha)
	require.Equal(t, "restart", restart.Artifact.Kind)

	incompatible, err := resolveDesktopUpdate(desktopUpdateRequest{
		Product:        desktopReleaseProduct,
		CurrentVersion: "1.2.2",
		Platform:       "windows",
		Architecture:   "x64",
		Compatibility:  "different-runtime",
	})
	require.NoError(t, err)
	require.Equal(t, "installer", incompatible.UpdateType)
	require.True(t, incompatible.RequiresCaptcha)

	majorUpgrade, err := resolveDesktopUpdate(desktopUpdateRequest{
		Product:        desktopReleaseProduct,
		CurrentVersion: "0.9.9",
		Platform:       "win32",
		Architecture:   "x64",
		Compatibility:  "win-x64-electron42-runtime1",
	})
	require.NoError(t, err)
	require.Equal(t, "installer", majorUpgrade.UpdateType)
	require.True(t, majorUpgrade.RequiresCaptcha)
}

func TestLoadDesktopReleaseManifestPreservesLegacySignedIdentity(t *testing.T) {
	legacyPath := writeDesktopReleaseFixtureForProduct(
		t,
		"1.0.4",
		"1.0.0",
		"win-x64-electron42-runtime1",
		desktopReleaseLegacyProduct,
	)

	release, err := loadDesktopReleaseManifestForProduct(desktopReleaseLegacyProduct)
	require.NoError(t, err)
	require.Equal(t, desktopReleaseLegacyProduct, release.Product)
	require.Equal(t, base64.StdEncoding.EncodeToString([]byte("test-signature")), release.Signature)
	require.Equal(t, "naimage-Setup-1.0.4-x64.exe", release.Installer.Filename)
	require.NotNil(t, release.Restart)
	require.Equal(t, "naimage-Restart-Update-1.0.4-x64.asar", release.Restart.Filename)

	t.Setenv("DESKTOP_RELEASE_MANIFEST_PATH", legacyPath)
	desktopReleaseCache.mu.Lock()
	desktopReleaseCache.cacheKey = ""
	desktopReleaseCache.mu.Unlock()
	_, err = loadDesktopReleaseManifest()
	require.ErrorIs(t, err, errDesktopInstallerNotReady, "a legacy signed identity must not be served as the canonical product")
}

func TestLegacyDesktopClientGetsLegacyManifestAndFullInstallerBridge(t *testing.T) {
	writeDesktopReleaseFixture(t, "1.0.5", "1.0.5", "win-x64-electron42-runtime1")
	writeDesktopReleaseFixtureForProduct(
		t,
		"1.0.5",
		"1.0.5",
		"win-x64-electron42-runtime1",
		desktopReleaseLegacyProduct,
	)

	legacy, err := resolveDesktopUpdate(desktopUpdateRequest{
		CurrentVersion: "1.0.4",
		Platform:       "win32",
		Architecture:   "x64",
		Compatibility:  "win-x64-electron42-runtime1",
	})
	require.NoError(t, err)
	require.True(t, legacy.UpdateAvailable)
	require.Equal(t, desktopReleaseLegacyProduct, legacy.Release.Product)
	require.Equal(t, "installer", legacy.UpdateType)
	require.True(t, legacy.RequiresCaptcha)
	require.Equal(t, "naimage-Setup-1.0.5-x64.exe", legacy.Artifact.Filename)
	require.Equal(t, desktopDownloadLegacyPath, desktopDownloadPathForProduct(""))

	canonical, err := resolveDesktopUpdate(desktopUpdateRequest{
		Product:        desktopReleaseProduct,
		CurrentVersion: "1.0.4",
		Platform:       "win32",
		Architecture:   "x64",
		Compatibility:  "win-x64-electron42-runtime1",
	})
	require.NoError(t, err)
	require.Equal(t, desktopReleaseProduct, canonical.Release.Product)
	require.Equal(t, desktopDownloadPath, desktopDownloadPathForProduct(desktopReleaseProduct))
	require.True(t, desktopInstallerManifestFingerprintMatches(legacy.Artifact, canonical.Artifact))
}

func TestDesktopReleaseCachesCanonicalAndLegacyManifestsIndependently(t *testing.T) {
	writeDesktopReleaseFixture(t, "1.0.5", "1.0.5", "win-x64-electron42-runtime1")
	writeDesktopReleaseFixtureForProduct(
		t,
		"1.0.5",
		"1.0.5",
		"win-x64-electron42-runtime1",
		desktopReleaseLegacyProduct,
	)

	canonical, err := loadDesktopReleaseManifestForProduct(desktopReleaseProduct)
	require.NoError(t, err)
	legacy, err := loadDesktopReleaseManifestForProduct(desktopReleaseLegacyProduct)
	require.NoError(t, err)
	require.Equal(t, desktopReleaseProduct, canonical.Product)
	require.Equal(t, desktopReleaseLegacyProduct, legacy.Product)

	canonicalCache := desktopReleaseCacheForProduct(desktopReleaseProduct)
	legacyCache := desktopReleaseCacheForProduct(desktopReleaseLegacyProduct)
	require.NotSame(t, canonicalCache, legacyCache)
	canonicalCache.mu.Lock()
	canonicalKey := canonicalCache.cacheKey
	canonicalCache.mu.Unlock()
	legacyCache.mu.Lock()
	legacyKey := legacyCache.cacheKey
	legacyCache.mu.Unlock()
	require.NotEmpty(t, canonicalKey)
	require.NotEmpty(t, legacyKey)
	require.NotEqual(t, canonicalKey, legacyKey)

	canonicalAgain, err := loadDesktopReleaseManifestForProduct(desktopReleaseProduct)
	require.NoError(t, err)
	require.Equal(t, desktopReleaseProduct, canonicalAgain.Product)
	canonicalCache.mu.Lock()
	require.Equal(t, canonicalKey, canonicalCache.cacheKey)
	canonicalCache.mu.Unlock()
	legacyCache.mu.Lock()
	require.Equal(t, legacyKey, legacyCache.cacheKey)
	legacyCache.mu.Unlock()
}

func TestResolveDesktopUpdateReturnsNoneForCurrentOrNewerVersion(t *testing.T) {
	writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")

	for _, version := range []string{"1.2.3", "1.3.0", "2.0.0"} {
		resolved, err := resolveDesktopUpdate(desktopUpdateRequest{
			Product:        desktopReleaseProduct,
			CurrentVersion: version,
			Platform:       "win32",
			Architecture:   "x64",
			Compatibility:  "win-x64-electron42-runtime1",
		})
		require.NoError(t, err)
		require.False(t, resolved.UpdateAvailable)
		require.Equal(t, "none", resolved.UpdateType)
	}
}

func TestLoadDesktopReleaseManifestRejectsChangedArtifact(t *testing.T) {
	manifestPath := writeDesktopReleaseFixture(t, "1.2.3", "1.0.0", "win-x64-electron42-runtime1")
	release, err := loadDesktopReleaseManifest()
	require.NoError(t, err)
	require.NotNil(t, release.Restart)
	require.NoError(t, os.WriteFile(release.Restart.Path, []byte("tampered"), 0o600))
	desktopReleaseCache.mu.Lock()
	desktopReleaseCache.cacheKey = ""
	desktopReleaseCache.mu.Unlock()

	_, err = loadDesktopReleaseManifest()
	require.ErrorIs(t, err, errDesktopInstallerNotReady)
	require.FileExists(t, manifestPath)
}
