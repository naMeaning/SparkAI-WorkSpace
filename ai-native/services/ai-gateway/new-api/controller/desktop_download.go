package controller

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"math/big"
	"mime"
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
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	desktopDownloadChallengeTTL = 5 * time.Minute
	desktopDownloadTicketTTL    = 15 * time.Minute
	desktopDownloadMaxResumes   = 5
)

var (
	errDesktopChallengeInvalid    = errors.New("desktop download captcha is invalid")
	errDesktopChallengeExpired    = errors.New("desktop download captcha has expired")
	errDesktopChallengeRateLimit  = errors.New("desktop download captcha rate limit exceeded")
	errDesktopTicketInvalid       = errors.New("desktop download ticket is invalid")
	errDesktopTicketExpired       = errors.New("desktop download ticket has expired")
	errDesktopTicketAlreadyUsed   = errors.New("desktop download ticket was already used")
	errDesktopTicketBusy          = errors.New("desktop download ticket is already in use")
	errDesktopTicketResumeInvalid = errors.New("desktop download resume range is invalid")
	errDesktopTicketResumeLimit   = errors.New("desktop download resume limit exceeded")
	errDesktopInstallerNotReady   = errors.New("desktop installer is not ready")
	desktopInstallerManifestCache desktopInstallerCache
)

var desktopCaptchaDigitPatterns = [10][7]string{
	{"01110", "10001", "10011", "10101", "11001", "10001", "01110"},
	{"00100", "01100", "00100", "00100", "00100", "00100", "01110"},
	{"01110", "10001", "00001", "00010", "00100", "01000", "11111"},
	{"11110", "00001", "00001", "01110", "00001", "00001", "11110"},
	{"00010", "00110", "01010", "10010", "11111", "00010", "00010"},
	{"11111", "10000", "10000", "11110", "00001", "00001", "11110"},
	{"01110", "10000", "10000", "11110", "10001", "10001", "01110"},
	{"11111", "00001", "00010", "00100", "01000", "01000", "01000"},
	{"01110", "10001", "10001", "01110", "10001", "10001", "01110"},
	{"01110", "10001", "10001", "01111", "00001", "00001", "01110"},
}

type desktopDownloadIdentity struct {
	UserID    int
	IP        string
	UserAgent string
}

type desktopDownloadChallenge struct {
	AnswerHash [32]byte
	Identity   desktopDownloadIdentity
	Product    string
	Manifest   desktopInstallerManifest
	ExpiresAt  time.Time
}

type desktopDownloadChallengeBinding struct {
	Product  string
	Manifest desktopInstallerManifest
}

type desktopDownloadTicket struct {
	Identity    desktopDownloadIdentity
	Manifest    desktopInstallerManifest
	Expires     time.Time
	Started     bool
	InUse       bool
	LastOffset  int64
	ResumeCount int
}

type desktopDownloadCountingWriter struct {
	gin.ResponseWriter
	bytesWritten int64
	writeErr     error
}

func (writer *desktopDownloadCountingWriter) Write(value []byte) (int, error) {
	written, err := writer.ResponseWriter.Write(value)
	writer.bytesWritten += int64(written)
	if err != nil && writer.writeErr == nil {
		writer.writeErr = err
	} else if written != len(value) && writer.writeErr == nil {
		writer.writeErr = io.ErrShortWrite
	}
	return written, err
}

func (writer *desktopDownloadCountingWriter) WriteString(value string) (int, error) {
	return writer.Write([]byte(value))
}

type desktopDownloadManager struct {
	mu             sync.Mutex
	challenges     map[string]desktopDownloadChallenge
	tickets        map[string]desktopDownloadTicket
	challengeIssue map[string][]time.Time
	now            func() time.Time
}

type desktopInstallerManifest struct {
	Path       string `json:"-"`
	Kind       string `json:"kind,omitempty"`
	Filename   string `json:"filename"`
	Version    string `json:"version"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
	ModifiedAt int64  `json:"-"`
}

type desktopInstallerCache struct {
	mu       sync.Mutex
	cacheKey string
	manifest desktopInstallerManifest
	err      error
}

type desktopDownloadRequest struct {
	Product     string `json:"product"`
	ChallengeID string `json:"challenge_id"`
	Code        string `json:"code"`
}

var defaultDesktopDownloadManager = newDesktopDownloadManager()

func newDesktopDownloadManager() *desktopDownloadManager {
	return &desktopDownloadManager{
		challenges:     map[string]desktopDownloadChallenge{},
		tickets:        map[string]desktopDownloadTicket{},
		challengeIssue: map[string][]time.Time{},
		now:            time.Now,
	}
}

func desktopPositiveEnv(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func desktopDownloadLimits() model.DesktopDownloadLimits {
	return model.DesktopDownloadLimits{
		IPHourly:   desktopPositiveEnv("DESKTOP_DOWNLOAD_IP_HOURLY_LIMIT", 8),
		IPDaily:    desktopPositiveEnv("DESKTOP_DOWNLOAD_IP_DAILY_LIMIT", 30),
		UserHourly: desktopPositiveEnv("DESKTOP_DOWNLOAD_USER_HOURLY_LIMIT", 5),
		UserDaily:  desktopPositiveEnv("DESKTOP_DOWNLOAD_USER_DAILY_LIMIT", 20),
	}
}

func secureRandomInt(max int) (int, error) {
	if max <= 0 {
		return 0, errors.New("random upper bound must be positive")
	}
	value, err := rand.Int(rand.Reader, big.NewInt(int64(max)))
	if err != nil {
		return 0, err
	}
	return int(value.Int64()), nil
}

func randomToken(byteLength int) (string, error) {
	value := make([]byte, byteLength)
	if _, err := io.ReadFull(rand.Reader, value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func randomCaptchaCode() (string, error) {
	value := make([]byte, 6)
	for index := range value {
		digit, err := secureRandomInt(10)
		if err != nil {
			return "", err
		}
		value[index] = byte('0' + digit)
	}
	return string(value), nil
}

func challengeAnswerHash(challengeID string, answer string) [32]byte {
	return sha256.Sum256([]byte(challengeID + ":" + strings.TrimSpace(answer)))
}

func userAgentHash(value string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(digest[:])
}

func identitiesMatch(left desktopDownloadIdentity, right desktopDownloadIdentity) bool {
	return left.UserID == right.UserID &&
		left.IP == right.IP &&
		subtle.ConstantTimeCompare([]byte(userAgentHash(left.UserAgent)), []byte(userAgentHash(right.UserAgent))) == 1
}

func (manager *desktopDownloadManager) cleanupLocked(now time.Time) {
	for id, challenge := range manager.challenges {
		if !challenge.ExpiresAt.After(now) {
			delete(manager.challenges, id)
		}
	}
	for id, ticket := range manager.tickets {
		if !ticket.Expires.After(now) {
			delete(manager.tickets, id)
		}
	}
	for key, attempts := range manager.challengeIssue {
		kept := attempts[:0]
		for _, attempt := range attempts {
			if attempt.After(now.Add(-10 * time.Minute)) {
				kept = append(kept, attempt)
			}
		}
		if len(kept) == 0 {
			delete(manager.challengeIssue, key)
		} else {
			manager.challengeIssue[key] = kept
		}
	}
}

func (manager *desktopDownloadManager) allowChallenge(identity desktopDownloadIdentity) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now()
	manager.cleanupLocked(now)
	keys := []struct {
		key   string
		limit int
	}{
		{key: "ip:" + identity.IP, limit: desktopPositiveEnv("DESKTOP_CAPTCHA_IP_10M_LIMIT", 20)},
		{key: fmt.Sprintf("user:%d", identity.UserID), limit: desktopPositiveEnv("DESKTOP_CAPTCHA_USER_10M_LIMIT", 15)},
	}
	for _, item := range keys {
		if len(manager.challengeIssue[item.key]) >= item.limit {
			return errDesktopChallengeRateLimit
		}
	}
	for _, item := range keys {
		manager.challengeIssue[item.key] = append(manager.challengeIssue[item.key], now)
	}
	return nil
}

func (manager *desktopDownloadManager) issueChallenge(identity desktopDownloadIdentity, bindings ...desktopDownloadChallengeBinding) (string, string, error) {
	challengeID, err := randomToken(24)
	if err != nil {
		return "", "", err
	}
	answer, err := randomCaptchaCode()
	if err != nil {
		return "", "", err
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now()
	manager.cleanupLocked(now)
	if len(manager.challenges) >= 10_000 {
		return "", "", errors.New("too many active desktop download challenges")
	}
	binding := desktopDownloadChallengeBinding{Product: desktopReleaseLegacyProduct}
	if len(bindings) > 0 {
		binding = bindings[0]
	}
	manager.challenges[challengeID] = desktopDownloadChallenge{
		AnswerHash: challengeAnswerHash(challengeID, answer),
		Identity:   identity,
		Product:    binding.Product,
		Manifest:   binding.Manifest,
		ExpiresAt:  now.Add(desktopDownloadChallengeTTL),
	}
	return challengeID, answer, nil
}

func (manager *desktopDownloadManager) revokeChallenge(challengeID string) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	delete(manager.challenges, challengeID)
}

func desktopInstallerManifestFingerprintMatches(left desktopInstallerManifest, right desktopInstallerManifest) bool {
	return left.Filename == right.Filename &&
		left.Version == right.Version &&
		left.SHA256 == right.SHA256 &&
		left.Size == right.Size
}

func (manager *desktopDownloadManager) verifyChallenge(challengeID string, answer string, identity desktopDownloadIdentity, bindings ...desktopDownloadChallengeBinding) error {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now()
	challenge, exists := manager.challenges[challengeID]
	delete(manager.challenges, challengeID)
	if !exists {
		return errDesktopChallengeInvalid
	}
	if !challenge.ExpiresAt.After(now) {
		return errDesktopChallengeExpired
	}
	if !identitiesMatch(challenge.Identity, identity) {
		return errDesktopChallengeInvalid
	}
	if len(bindings) > 0 {
		binding := bindings[0]
		if !strings.EqualFold(strings.TrimSpace(challenge.Product), strings.TrimSpace(binding.Product)) ||
			!desktopInstallerManifestFingerprintMatches(challenge.Manifest, binding.Manifest) {
			return errDesktopChallengeInvalid
		}
	}
	actual := challengeAnswerHash(challengeID, answer)
	if subtle.ConstantTimeCompare(challenge.AnswerHash[:], actual[:]) != 1 {
		return errDesktopChallengeInvalid
	}
	return nil
}

func (manager *desktopDownloadManager) issueTicket(identity desktopDownloadIdentity, manifest desktopInstallerManifest) (string, error) {
	ticketID, err := randomToken(32)
	if err != nil {
		return "", err
	}
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now()
	manager.cleanupLocked(now)
	if len(manager.tickets) >= 10_000 {
		return "", errors.New("too many active desktop download tickets")
	}
	manager.tickets[ticketID] = desktopDownloadTicket{
		Identity: identity,
		Manifest: manifest,
		Expires:  now.Add(desktopDownloadTicketTTL),
	}
	return ticketID, nil
}

func (manager *desktopDownloadManager) openTicket(ticketID string, identity desktopDownloadIdentity, resumeOffset *int64) (desktopInstallerManifest, error) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	now := manager.now()
	ticket, exists := manager.tickets[ticketID]
	if !exists {
		return desktopInstallerManifest{}, errDesktopTicketInvalid
	}
	if !ticket.Expires.After(now) {
		delete(manager.tickets, ticketID)
		return desktopInstallerManifest{}, errDesktopTicketExpired
	}
	if !identitiesMatch(ticket.Identity, identity) {
		return desktopInstallerManifest{}, errDesktopTicketInvalid
	}
	if ticket.InUse {
		return desktopInstallerManifest{}, errDesktopTicketBusy
	}
	if !ticket.Started {
		startOffset := int64(0)
		if resumeOffset != nil {
			startOffset = *resumeOffset
			if startOffset < 0 || startOffset >= ticket.Manifest.Size {
				return desktopInstallerManifest{}, errDesktopTicketResumeInvalid
			}
		}
		ticket.Started = true
		ticket.InUse = true
		ticket.LastOffset = startOffset
		manager.tickets[ticketID] = ticket
		return ticket.Manifest, nil
	}
	if resumeOffset == nil {
		return desktopInstallerManifest{}, errDesktopTicketAlreadyUsed
	}
	if ticket.ResumeCount >= desktopDownloadMaxResumes {
		return desktopInstallerManifest{}, errDesktopTicketResumeLimit
	}
	if *resumeOffset < ticket.LastOffset || *resumeOffset < 0 || *resumeOffset >= ticket.Manifest.Size {
		return desktopInstallerManifest{}, errDesktopTicketResumeInvalid
	}
	ticket.InUse = true
	ticket.ResumeCount++
	ticket.LastOffset = *resumeOffset
	manager.tickets[ticketID] = ticket
	return ticket.Manifest, nil
}

func (manager *desktopDownloadManager) finishTicket(ticketID string, identity desktopDownloadIdentity, complete bool) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	ticket, exists := manager.tickets[ticketID]
	if !exists || !ticket.InUse || !identitiesMatch(ticket.Identity, identity) {
		return
	}
	if complete {
		delete(manager.tickets, ticketID)
		return
	}
	ticket.InUse = false
	manager.tickets[ticketID] = ticket
}

func desktopResumeOffset(rangeHeader string) (*int64, error) {
	value := strings.TrimSpace(rangeHeader)
	if value == "" {
		return nil, nil
	}
	if len(value) < len("bytes=0-") || !strings.EqualFold(value[:6], "bytes=") {
		return nil, errDesktopTicketResumeInvalid
	}
	rangeValue := strings.TrimSpace(value[6:])
	if strings.Contains(rangeValue, ",") || strings.Count(rangeValue, "-") != 1 || !strings.HasSuffix(rangeValue, "-") {
		return nil, errDesktopTicketResumeInvalid
	}
	startText := strings.TrimSpace(strings.TrimSuffix(rangeValue, "-"))
	if startText == "" {
		return nil, errDesktopTicketResumeInvalid
	}
	for _, character := range startText {
		if character < '0' || character > '9' {
			return nil, errDesktopTicketResumeInvalid
		}
	}
	start, err := strconv.ParseInt(startText, 10, 64)
	if err != nil || start < 0 {
		return nil, errDesktopTicketResumeInvalid
	}
	return &start, nil
}

func loadLegacyDesktopInstallerManifest() (desktopInstallerManifest, error) {
	configuredPath := strings.TrimSpace(os.Getenv("DESKTOP_INSTALLER_PATH"))
	if configuredPath == "" {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	absolutePath, err := filepath.Abs(configuredPath)
	if err != nil {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	info, err := os.Stat(absolutePath)
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	filename := filepath.Base(strings.TrimSpace(os.Getenv("DESKTOP_INSTALLER_FILENAME")))
	if filename == "." || filename == "" {
		filename = filepath.Base(absolutePath)
	}
	if !strings.EqualFold(filepath.Ext(filename), ".exe") {
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	expectedHash := strings.ToLower(strings.TrimSpace(os.Getenv("DESKTOP_INSTALLER_SHA256")))
	cacheKey := strings.Join([]string{
		absolutePath,
		strconv.FormatInt(info.Size(), 10),
		strconv.FormatInt(info.ModTime().UnixNano(), 10),
		expectedHash,
	}, "|")

	desktopInstallerManifestCache.mu.Lock()
	defer desktopInstallerManifestCache.mu.Unlock()
	if desktopInstallerManifestCache.cacheKey == cacheKey {
		return desktopInstallerManifestCache.manifest, desktopInstallerManifestCache.err
	}

	file, err := os.Open(absolutePath)
	if err != nil {
		desktopInstallerManifestCache.cacheKey = cacheKey
		desktopInstallerManifestCache.manifest = desktopInstallerManifest{}
		desktopInstallerManifestCache.err = errDesktopInstallerNotReady
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	hasher := sha256.New()
	_, copyErr := io.Copy(hasher, file)
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		desktopInstallerManifestCache.cacheKey = cacheKey
		desktopInstallerManifestCache.manifest = desktopInstallerManifest{}
		desktopInstallerManifestCache.err = errDesktopInstallerNotReady
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if expectedHash != "" && (len(expectedHash) != 64 || subtle.ConstantTimeCompare([]byte(expectedHash), []byte(actualHash)) != 1) {
		desktopInstallerManifestCache.cacheKey = cacheKey
		desktopInstallerManifestCache.manifest = desktopInstallerManifest{}
		desktopInstallerManifestCache.err = errDesktopInstallerNotReady
		return desktopInstallerManifest{}, errDesktopInstallerNotReady
	}
	manifest := desktopInstallerManifest{
		Path:       absolutePath,
		Kind:       "installer",
		Filename:   filename,
		Version:    strings.TrimSpace(os.Getenv("DESKTOP_INSTALLER_VERSION")),
		SHA256:     actualHash,
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UnixNano(),
	}
	if manifest.Version == "" {
		manifest.Version = "1.0.0"
	}
	desktopInstallerManifestCache.cacheKey = cacheKey
	desktopInstallerManifestCache.manifest = manifest
	desktopInstallerManifestCache.err = nil
	return manifest, nil
}

func loadDesktopInstallerManifestForProduct(product string) (desktopInstallerManifest, error) {
	if desktopReleaseManifestPathForProduct(product) != "" {
		release, err := loadDesktopReleaseManifestForProduct(product)
		if err != nil {
			return desktopInstallerManifest{}, errDesktopInstallerNotReady
		}
		return release.Installer, nil
	}
	return loadLegacyDesktopInstallerManifest()
}

func loadDesktopInstallerManifest() (desktopInstallerManifest, error) {
	return loadDesktopInstallerManifestForProduct(desktopReleaseProduct)
}

func drawCaptchaLine(img *image.RGBA, x0 int, y0 int, x1 int, y1 int, value color.RGBA) {
	dx := x1 - x0
	if dx < 0 {
		dx = -dx
	}
	sx := 1
	if x0 > x1 {
		sx = -1
	}
	dy := y1 - y0
	if dy > 0 {
		dy = -dy
	}
	sy := 1
	if y0 > y1 {
		sy = -1
	}
	err := dx + dy
	for {
		if image.Pt(x0, y0).In(img.Bounds()) {
			img.SetRGBA(x0, y0, value)
		}
		if x0 == x1 && y0 == y1 {
			break
		}
		twice := 2 * err
		if twice >= dy {
			err += dy
			x0 += sx
		}
		if twice <= dx {
			err += dx
			y0 += sy
		}
	}
}

func renderCaptchaPNG(answer string) ([]byte, error) {
	img := image.NewRGBA(image.Rect(0, 0, 190, 64))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.RGBA{R: 246, G: 248, B: 252, A: 255}}, image.Point{}, draw.Src)
	for index := 0; index < 6; index++ {
		x0, _ := secureRandomInt(img.Bounds().Dx())
		y0, _ := secureRandomInt(img.Bounds().Dy())
		x1, _ := secureRandomInt(img.Bounds().Dx())
		y1, _ := secureRandomInt(img.Bounds().Dy())
		shade, _ := secureRandomInt(25)
		drawCaptchaLine(img, x0, y0, x1, y1, color.RGBA{R: uint8(195 + shade), G: uint8(200 + shade), B: uint8(215 + shade), A: 255})
	}
	for index := 0; index < 110; index++ {
		x, _ := secureRandomInt(img.Bounds().Dx())
		y, _ := secureRandomInt(img.Bounds().Dy())
		shade, _ := secureRandomInt(30)
		img.SetRGBA(x, y, color.RGBA{R: uint8(180 + shade), G: uint8(185 + shade), B: uint8(205 + shade), A: 255})
	}
	for index, character := range answer {
		digit := int(character - '0')
		if digit < 0 || digit > 9 {
			return nil, errors.New("captcha contains a non-digit character")
		}
		yJitter, _ := secureRandomInt(4)
		xJitter, _ := secureRandomInt(2)
		red, _ := secureRandomInt(18)
		green, _ := secureRandomInt(18)
		blue, _ := secureRandomInt(28)
		ink := color.RGBA{R: uint8(20 + red), G: uint8(28 + green), B: uint8(55 + blue), A: 255}
		originX := 11 + index*29 + xJitter
		originY := 11 + yJitter
		for rowIndex, row := range desktopCaptchaDigitPatterns[digit] {
			for columnIndex, pixel := range row {
				if pixel != '1' {
					continue
				}
				rectangle := image.Rect(
					originX+columnIndex*4,
					originY+rowIndex*6,
					originX+columnIndex*4+4,
					originY+rowIndex*6+6,
				)
				draw.Draw(img, rectangle, &image.Uniform{C: ink}, image.Point{}, draw.Src)
			}
		}
	}
	buffer := &bytes.Buffer{}
	if err := png.Encode(buffer, img); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func desktopIdentity(c *gin.Context, userID int) desktopDownloadIdentity {
	return desktopDownloadIdentity{
		UserID:    userID,
		IP:        strings.TrimSpace(c.ClientIP()),
		UserAgent: c.GetHeader("User-Agent"),
	}
}

func desktopDownloadFailure(c *gin.Context, status int, code string, message string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"success": false, "message": message, "code": code})
}

func requireCurrentDesktopUser(c *gin.Context) bool {
	userID := c.GetInt("id")
	user, err := model.GetUserById(userID, false)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_client_account_check_failed", "账号状态暂时无法确认，请稍后重试。")
		return false
	}
	if err != nil || user == nil || user.Status != common.UserStatusEnabled {
		desktopDownloadFailure(c, http.StatusUnauthorized, "desktop_client_account_unavailable", "当前账号不可用，请重新登录。")
		return false
	}
	return true
}

// CreateDesktopDownloadCaptcha creates a short-lived, identity-bound image
// captcha. Challenge state stays server-side so concurrent captcha responses
// cannot overwrite one another through a rotating cookie session.
func CreateDesktopDownloadCaptcha(c *gin.Context) {
	if !requireCurrentDesktopUser(c) {
		return
	}
	product := desktopClientProduct(c, "")
	if !desktopClientProductSupported(product) {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_product_invalid", "客户端产品标识无效，请更新客户端后重试。")
		return
	}
	userID := c.GetInt("id")
	identity := desktopIdentity(c, userID)
	if identity.IP == "" {
		desktopDownloadFailure(c, http.StatusBadRequest, "download_client_ip_missing", "无法识别当前网络地址，请稍后重试。")
		return
	}
	if err := defaultDesktopDownloadManager.allowChallenge(identity); err != nil {
		desktopDownloadFailure(c, http.StatusTooManyRequests, "download_captcha_rate_limited", "验证码请求过于频繁，请稍后再试。")
		return
	}
	product = desktopReleaseProductForClient(product)
	manifest, err := loadDesktopInstallerManifestForProduct(product)
	if err != nil {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_installer_not_ready", "客户端安装包暂不可用，请稍后再试。")
		return
	}
	binding := desktopDownloadChallengeBinding{Product: product, Manifest: manifest}
	challengeID, answer, err := defaultDesktopDownloadManager.issueChallenge(identity, binding)
	if err != nil {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "download_captcha_unavailable", "暂时无法生成验证码，请稍后再试。")
		return
	}
	imageBytes, err := renderCaptchaPNG(answer)
	if err != nil {
		defaultDesktopDownloadManager.revokeChallenge(challengeID)
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "download_captcha_unavailable", "暂时无法生成验证码，请稍后再试。")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"challenge_id":   challengeID,
			"image_data_url": "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes),
			"expires_in":     int(desktopDownloadChallengeTTL / time.Second),
			"installer":      manifest,
		},
	})
}

// AuthorizeDesktopDownload consumes one captcha, persists the per-user/IP
// quota reservation, and issues a short-lived identity-bound ticket. The
// authenticated session proves the user but does not carry challenge state.
func AuthorizeDesktopDownload(c *gin.Context) {
	if !requireCurrentDesktopUser(c) {
		return
	}
	var request desktopDownloadRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		desktopDownloadFailure(c, http.StatusBadRequest, "download_captcha_invalid", "请输入有效的验证码。")
		return
	}
	request.ChallengeID = strings.TrimSpace(request.ChallengeID)
	request.Code = strings.TrimSpace(request.Code)
	request.Product = desktopClientProduct(c, request.Product)
	if !desktopClientProductSupported(request.Product) {
		desktopDownloadFailure(c, http.StatusBadRequest, "desktop_product_invalid", "客户端产品标识无效，请更新客户端后重试。")
		return
	}
	if request.ChallengeID == "" || len(request.Code) != 6 {
		desktopDownloadFailure(c, http.StatusBadRequest, "download_captcha_invalid", "请输入 6 位验证码。")
		return
	}
	identity := desktopIdentity(c, c.GetInt("id"))
	request.Product = desktopReleaseProductForClient(request.Product)
	manifest, err := loadDesktopInstallerManifestForProduct(request.Product)
	if err != nil {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_installer_not_ready", "客户端安装包暂不可用，请稍后再试。")
		return
	}
	binding := desktopDownloadChallengeBinding{Product: request.Product, Manifest: manifest}
	verifyErr := defaultDesktopDownloadManager.verifyChallenge(request.ChallengeID, request.Code, identity, binding)
	if verifyErr != nil {
		message := "验证码错误，请刷新后重试。"
		if errors.Is(verifyErr, errDesktopChallengeExpired) {
			message = "验证码已过期，请刷新后重试。"
		}
		desktopDownloadFailure(c, http.StatusBadRequest, "download_captcha_invalid", message)
		return
	}
	reserveErr := model.ReserveDesktopDownload(identity.UserID, identity.IP, time.Now(), desktopDownloadLimits(), map[string]interface{}{
		"filename": manifest.Filename,
		"version":  manifest.Version,
		"sha256":   manifest.SHA256,
		"size":     manifest.Size,
	})
	if errors.Is(reserveErr, model.ErrDesktopDownloadRateLimited) {
		c.Header("Retry-After", "3600")
		desktopDownloadFailure(c, http.StatusTooManyRequests, "desktop_download_rate_limited", "当前账号或网络的下载次数已达上限，请稍后再试。")
		return
	}
	if reserveErr != nil {
		desktopDownloadFailure(c, http.StatusInternalServerError, "desktop_download_audit_failed", "下载授权失败，请稍后再试。")
		return
	}
	ticketID, err := defaultDesktopDownloadManager.issueTicket(identity, manifest)
	if err != nil {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_download_ticket_unavailable", "下载授权失败，请稍后再试。")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"download_url": desktopDownloadPathForProduct(request.Product) + "?ticket=" + url.QueryEscape(ticketID),
			"expires_in":   int(desktopDownloadTicketTTL / time.Second),
			"installer":    manifest,
		},
	})
}

// DownloadDesktopInstaller streams the installer without exposing its server
// path. A signed login session and its matching short-lived ticket are both
// required. Range requests are allowed only as resume requests for a ticket
// that has already started.
func DownloadDesktopInstaller(c *gin.Context) {
	session := sessions.Default(c)
	userID, ok := session.Get("id").(int)
	status, statusOK := session.Get("status").(int)
	if !ok || userID <= 0 || !statusOK || status != common.UserStatusEnabled {
		desktopDownloadFailure(c, http.StatusUnauthorized, "desktop_download_login_required", "请登录后下载客户端。")
		return
	}
	ticketID := strings.TrimSpace(c.Query("ticket"))
	if ticketID == "" {
		desktopDownloadFailure(c, http.StatusForbidden, "desktop_download_ticket_invalid", "下载链接已失效，请重新验证。")
		return
	}
	identity := desktopIdentity(c, userID)
	resumeOffset, rangeErr := desktopResumeOffset(c.GetHeader("Range"))
	if rangeErr != nil {
		desktopDownloadFailure(c, http.StatusRequestedRangeNotSatisfiable, "desktop_download_range_invalid", "续传位置无效，请重新输入验证码获取下载链接。")
		return
	}
	manifest, err := defaultDesktopDownloadManager.openTicket(ticketID, identity, resumeOffset)
	if err != nil {
		if errors.Is(err, errDesktopTicketBusy) {
			c.Header("Retry-After", "2")
			desktopDownloadFailure(c, http.StatusTooEarly, "desktop_download_ticket_busy", "同一下载仍在进行中，请稍后继续。")
			return
		}
		if errors.Is(err, errDesktopTicketResumeInvalid) || errors.Is(err, errDesktopTicketResumeLimit) {
			desktopDownloadFailure(c, http.StatusRequestedRangeNotSatisfiable, "desktop_download_range_invalid", "续传位置或次数无效，请重新输入验证码获取下载链接。")
			return
		}
		message := "下载链接已失效，请重新验证。"
		if errors.Is(err, errDesktopTicketAlreadyUsed) {
			message = "本次下载已开始，如需重新下载请再次输入验证码。"
		}
		desktopDownloadFailure(c, http.StatusForbidden, "desktop_download_ticket_invalid", message)
		return
	}
	startOffset := int64(0)
	if resumeOffset != nil {
		startOffset = *resumeOffset
	}
	leaseFinished := false
	defer func() {
		if !leaseFinished {
			defaultDesktopDownloadManager.finishTicket(ticketID, identity, false)
		}
	}()
	user, err := model.GetUserById(userID, false)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_client_account_check_failed", "账号状态暂时无法确认，请稍后重试。")
		return
	}
	if err != nil || user == nil || user.Status != common.UserStatusEnabled {
		desktopDownloadFailure(c, http.StatusUnauthorized, "desktop_download_login_required", "当前账号不可用，请重新登录。")
		return
	}
	file, err := os.Open(manifest.Path)
	if err != nil {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_installer_not_ready", "客户端安装包暂不可用，请稍后再试。")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() != manifest.Size || info.ModTime().UnixNano() != manifest.ModifiedAt {
		desktopDownloadFailure(c, http.StatusServiceUnavailable, "desktop_installer_changed", "客户端安装包正在更新，请重新获取验证码。")
		return
	}
	disposition := mime.FormatMediaType("attachment", map[string]string{"filename": manifest.Filename})
	if disposition == "" {
		disposition = "attachment"
	}
	c.Header("Cache-Control", "private, no-store, max-age=0")
	c.Header("Content-Disposition", disposition)
	contentType := "application/octet-stream"
	if strings.EqualFold(filepath.Ext(manifest.Filename), ".exe") {
		contentType = "application/vnd.microsoft.portable-executable"
	}
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Checksum-SHA256", manifest.SHA256)
	c.Header("Accept-Ranges", "bytes")
	countingWriter := &desktopDownloadCountingWriter{ResponseWriter: c.Writer}
	c.Writer = countingWriter
	http.ServeContent(c.Writer, c.Request, manifest.Filename, info.ModTime(), file)
	complete := countingWriter.writeErr == nil && startOffset+countingWriter.bytesWritten >= manifest.Size
	defaultDesktopDownloadManager.finishTicket(ticketID, identity, complete)
	leaseFinished = true
}
