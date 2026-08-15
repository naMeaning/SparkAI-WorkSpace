package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagedRelayTokenAuthCreatesAndUsesHiddenRelayToken(t *testing.T) {
	t.Setenv(naimageLicenseRequiredEnv, "true")
	user := setupUserManageRelayTokenTestDB(t)
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/managed-relay", ManagedRelayTokenAuth(), func(c *gin.Context) {
		assert.Equal(t, user.Id, c.GetInt("id"))
		assert.Equal(t, model.ManagedRelayTokenName, c.GetString("token_name"))
		assert.True(t, c.GetBool("managed_session_relay"))
		assert.NotEmpty(t, c.GetString("token_key"))
		assert.Empty(t, c.GetHeader("Authorization"))
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/managed-relay", nil)
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusNoContent, recorder.Code)

	var tokens []model.Token
	require.NoError(t, model.DB.Find(&tokens, "user_id = ?", user.Id).Error)
	require.Len(t, tokens, 1)
	assert.Equal(t, model.ManagedRelayTokenName, tokens[0].Name)
	assert.NotEmpty(t, tokens[0].Key)
	assert.NotContains(t, recorder.Body.String(), tokens[0].Key)
}

func TestManagedRelayTokenAuthRejectsDisabledCurrentUser(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/managed-relay", ManagedRelayTokenAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/managed-relay", nil)
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusUnauthorized, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "authentication_error")

	var tokenCount int64
	require.NoError(t, model.DB.Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&tokenCount).Error)
	require.Zero(t, tokenCount)
}

func TestManagedRelayTokenAuthReturnsServiceUnavailableWhenAccountStateCannotBeRead(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	sqlDB, err := model.DB.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Next()
	})
	router.POST("/managed-relay", ManagedRelayTokenAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/managed-relay", nil)
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), "service_unavailable")
}
