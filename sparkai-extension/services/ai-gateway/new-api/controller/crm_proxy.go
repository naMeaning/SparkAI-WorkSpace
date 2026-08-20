package controller

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const localCrmEmbedTrustSecret = "ai-native-crm-local-embed-secret"

var crmEmbedHeaders = []string{
	"X-Crm-Embed-User-Id",
	"X-Crm-Embed-Username-B64",
	"X-Crm-Embed-Display-Name-B64",
	"X-Crm-Embed-Email-B64",
	"X-Crm-Embed-Role",
	"X-Crm-Embed-Inviter-Id",
	"X-Crm-Embed-Timestamp",
	"X-Crm-Embed-Nonce",
	"X-Crm-Embed-Signature",
}

func crmApiBaseURL() string {
	value := strings.TrimSpace(os.Getenv("CRM_API_BASE_URL"))
	if value == "" {
		value = strings.TrimSpace(os.Getenv("CRM_API_URL"))
	}
	if value == "" {
		value = "http://127.0.0.1:17861"
	}
	return strings.TrimRight(value, "/")
}

func crmEmbedTrustSecret() string {
	if value := strings.TrimSpace(os.Getenv("CRM_EMBED_TRUST_SECRET")); value != "" {
		return value
	}
	if strings.EqualFold(os.Getenv("NODE_ENV"), "production") || strings.EqualFold(os.Getenv("GIN_MODE"), "release") {
		return ""
	}
	return localCrmEmbedTrustSecret
}

func randomCrmNonce() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return hex.EncodeToString(bytes[:])
}

func base64URLText(value string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func singleJoiningSlash(left string, right string) string {
	leftSlash := strings.HasSuffix(left, "/")
	rightSlash := strings.HasPrefix(right, "/")
	switch {
	case leftSlash && rightSlash:
		return left + right[1:]
	case !leftSlash && !rightSlash:
		return left + "/" + right
	default:
		return left + right
	}
}

func crmEmbedSignature(secret string, parts ...string) string {
	payload := strings.Join(parts, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func writeCrmProxyError(c *gin.Context, status int, code string, message string) {
	c.AbortWithStatusJSON(status, gin.H{
		"ok":         false,
		"error_code": code,
		"err_msg":    message,
	})
}

func attachCrmEmbedHeaders(req *http.Request, c *gin.Context, upstreamPath string, secret string) {
	userID := c.GetInt("id")
	role := c.GetInt("role")
	username := c.GetString("username")
	displayName := ""
	email := ""
	inviterID := 0
	if user, err := model.GetUserById(userID, false); err == nil && user != nil {
		if user.Username != "" {
			username = user.Username
		}
		displayName = user.DisplayName
		email = user.Email
		inviterID = user.InviterId
	}

	userIDText := strconv.Itoa(userID)
	roleText := strconv.Itoa(role)
	inviterIDText := strconv.Itoa(inviterID)
	usernameB64 := base64URLText(username)
	displayNameB64 := base64URLText(displayName)
	emailB64 := base64URLText(email)
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonce := randomCrmNonce()

	req.Header.Set("X-Crm-Embed-User-Id", userIDText)
	req.Header.Set("X-Crm-Embed-Username-B64", usernameB64)
	req.Header.Set("X-Crm-Embed-Display-Name-B64", displayNameB64)
	req.Header.Set("X-Crm-Embed-Email-B64", emailB64)
	req.Header.Set("X-Crm-Embed-Role", roleText)
	req.Header.Set("X-Crm-Embed-Inviter-Id", inviterIDText)
	req.Header.Set("X-Crm-Embed-Timestamp", timestamp)
	req.Header.Set("X-Crm-Embed-Nonce", nonce)
	req.Header.Set("X-Crm-Embed-Signature", crmEmbedSignature(
		secret,
		req.Method,
		upstreamPath,
		timestamp,
		nonce,
		userIDText,
		usernameB64,
		displayNameB64,
		emailB64,
		roleText,
		inviterIDText,
	))
}

// CrmProxy exposes the CRM service as a same-origin, new-api-authenticated API.
// The browser never receives service-side relay tokens or new-api access tokens.
func CrmProxy(c *gin.Context) {
	secret := crmEmbedTrustSecret()
	if secret == "" {
		writeCrmProxyError(c, http.StatusServiceUnavailable, "crm_embedded_auth_not_configured", "CRM 嵌入登录未配置，请联系管理员。")
		return
	}

	target, err := url.Parse(crmApiBaseURL())
	if err != nil || target.Scheme == "" || target.Host == "" {
		writeCrmProxyError(c, http.StatusServiceUnavailable, "crm_proxy_not_configured", "CRM 服务地址未配置，请联系管理员。")
		return
	}

	path := c.Param("path")
	if path == "" {
		path = "/session/self"
	}
	upstreamPath := singleJoiningSlash("/crm", path)

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = singleJoiningSlash(target.Path, upstreamPath)
		req.URL.RawPath = ""
		req.URL.RawQuery = c.Request.URL.RawQuery
		req.Host = target.Host

		req.Header.Del("Cookie")
		req.Header.Del("Authorization")
		for _, header := range crmEmbedHeaders {
			req.Header.Del(header)
		}
		req.Header.Set("X-Forwarded-Host", c.Request.Host)
		attachCrmEmbedHeaders(req, c, upstreamPath, secret)
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Set-Cookie")
		return nil
	}
	proxy.ErrorHandler = func(_ http.ResponseWriter, _ *http.Request, _ error) {
		writeCrmProxyError(c, http.StatusBadGateway, "crm_proxy_unavailable", "CRM 系统暂时不可用，请稍后重试。")
	}
	proxy.ServeHTTP(c.Writer, c.Request)
}
