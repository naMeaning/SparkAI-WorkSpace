package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ManagedRelayTokenAuth converts an authenticated dashboard session into the
// user's hidden naimage-relay token context. The token remains server-side:
// desktop clients send only their normal session cookie and New-Api-User header.
func ManagedRelayTokenAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetInt("id")
		user, err := model.GetUserById(userID, false)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "账号状态暂时无法确认，请稍后重试。",
					"type":    "service_unavailable",
				},
			})
			return
		}
		if err != nil || user == nil || user.Id == 0 || user.Status != common.UserStatusEnabled {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": gin.H{
					"message": "登录账号不存在或已停用，请重新登录。",
					"type":    "authentication_error",
				},
			})
			return
		}
		if !RequireNaimageLicense(c, userID) {
			return
		}

		token, _, err := ensureRelayTokenForUser(*user)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "Agent 服务凭证暂时不可用，请稍后重试。",
					"type":    "service_unavailable",
				},
			})
			return
		}

		userCache, err := model.GetUserCache(userID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "用户额度状态暂时不可用，请稍后重试。",
					"type":    "service_unavailable",
				},
			})
			return
		}

		userCache.WriteContext(c)
		usingGroup := userCache.Group
		if token.Group != "" {
			usingGroup = token.Group
		}
		common.SetContextKey(c, constant.ContextKeyUsingGroup, usingGroup)
		if err := middleware.SetupContextForToken(c, token); err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": gin.H{
					"message": "Agent 服务凭证初始化失败，请稍后重试。",
					"type":    "service_unavailable",
				},
			})
			return
		}
		c.Set("managed_session_relay", true)
		c.Next()
	}
}
