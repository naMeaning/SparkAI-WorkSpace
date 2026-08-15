package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupNaimageActivationControllerTest(t *testing.T) {
	t.Helper()
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.NaimageActivationCode{}, &model.NaimageActivationGrant{}))
	require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&model.NaimageActivationGrant{}).Error)
	require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&model.NaimageActivationCode{}).Error)
}

func TestNaimageLicenseConfigSeparatesAccountAndCustomAccess(t *testing.T) {
	t.Setenv(naimageLicenseRequiredEnv, "true")
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/naimage/license", nil)

	GetNaimageLicenseConfig(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Required                 bool   `json:"required"`
			AccountLoginRequired     bool   `json:"account_login_required"`
			AccountLicenseRequired   bool   `json:"account_license_required"`
			CustomAPILicenseRequired bool   `json:"custom_api_license_required"`
			CustomAPIRequiredPlan    string `json:"custom_api_required_plan"`
			DefaultMaxActivations    int    `json:"default_max_activations"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.False(t, response.Data.Required, "legacy clients must not interpret account login as requiring a device license")
	assert.True(t, response.Data.AccountLoginRequired)
	assert.False(t, response.Data.AccountLicenseRequired)
	assert.True(t, response.Data.CustomAPILicenseRequired)
	assert.Equal(t, model.NaimageLicensePlanPro, response.Data.CustomAPIRequiredPlan)
	assert.Equal(t, 3, response.Data.DefaultMaxActivations)
}

func TestCreateNaimageActivationCodesDefaultsToProAndThreeDevices(t *testing.T) {
	setupNaimageActivationControllerTest(t)
	gin.SetMode(gin.TestMode)
	body := bytes.NewBufferString(`{"name":"desktop-pro","count":1,"valid_days":0}`)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/naimage/license/admin/codes", body)
	ctx.Request.Header.Set("Content-Type", "application/json")

	CreateNaimageActivationCodes(ctx)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var stored model.NaimageActivationCode
	require.NoError(t, model.DB.First(&stored).Error)
	assert.Equal(t, model.NaimageLicensePlanPro, stored.Plan)
	assert.Equal(t, 3, stored.MaxActivations)
	assert.Zero(t, stored.ValidDays)
}
