package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	naimageLicenseRequiredEnv = "NAIMAGE_LICENSE_REQUIRED"
	naimageLicenseGraceHours  = 72
)

type naimageActivationRequest struct {
	Code     string `json:"code"`
	DeviceId string `json:"device_id"`
}

type naimageLicenseVerifyRequest struct {
	Token    string `json:"token"`
	DeviceId string `json:"device_id"`
}

type naimageActivationCodeCreateRequest struct {
	Name           string `json:"name"`
	Count          int    `json:"count"`
	Plan           string `json:"plan"`
	ValidDays      int    `json:"valid_days"`
	MaxActivations int    `json:"max_activations"`
	ExpiredTime    int64  `json:"expired_time"`
}

func NaimageLicenseRequired() bool {
	return common.GetEnvOrDefaultBool(naimageLicenseRequiredEnv, false)
}

func GetNaimageLicenseConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"required":                 NaimageLicenseRequired(),
			"verification_ttl_seconds": 24 * 60 * 60,
			"offline_grace_seconds":    naimageLicenseGraceHours * 60 * 60,
			"supports_account_mode":    true,
			"supports_custom_api_mode": true,
		},
	})
}

func naimageActivationError(c *gin.Context, err error) {
	status := http.StatusBadRequest
	message := "激活码无效、已过期或已达到可激活设备数量。"
	if errors.Is(err, model.ErrNaimageActivationExpired) {
		message = "激活码或授权已过期。"
	}
	if !errors.Is(err, model.ErrNaimageActivationInvalid) &&
		!errors.Is(err, model.ErrNaimageActivationExpired) &&
		!errors.Is(err, model.ErrNaimageActivationUsed) &&
		!errors.Is(err, model.ErrNaimageLicenseInvalid) {
		common.SysError("naimage activation failed: " + err.Error())
		status = http.StatusServiceUnavailable
		message = "授权服务暂时不可用，请稍后重试。"
	}
	c.JSON(status, gin.H{"success": false, "message": message})
}

func activateNaimage(c *gin.Context, userId int) {
	var request naimageActivationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "激活请求格式无效。"})
		return
	}
	result, err := model.ActivateNaimage(request.Code, request.DeviceId, userId)
	if err != nil {
		naimageActivationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"token":      result.Token,
			"plan":       result.Plan,
			"expires_at": result.ExpiresAt,
		},
	})
}

func ActivateNaimageDevice(c *gin.Context) {
	activateNaimage(c, 0)
}

func ActivateNaimageAccount(c *gin.Context) {
	activateNaimage(c, c.GetInt("id"))
}

func verifyNaimage(c *gin.Context, userId int) {
	var request naimageLicenseVerifyRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "授权校验请求格式无效。"})
		return
	}
	grant, err := model.VerifyNaimageLicense(request.Token, request.DeviceId, userId)
	if err != nil {
		naimageActivationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"active":      true,
			"plan":        grant.Plan,
			"expires_at":  grant.ExpiresAt,
			"verified_at": grant.LastVerifiedTime,
		},
	})
}

func VerifyNaimageDevice(c *gin.Context) {
	verifyNaimage(c, 0)
}

func VerifyNaimageAccount(c *gin.Context) {
	verifyNaimage(c, c.GetInt("id"))
}

func CreateNaimageActivationCodes(c *gin.Context) {
	var request naimageActivationCodeCreateRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "激活码参数无效。"})
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Plan = strings.TrimSpace(request.Plan)
	if request.Count == 0 {
		request.Count = 1
	}
	if request.Plan == "" {
		request.Plan = "standard"
	}
	if request.MaxActivations == 0 {
		request.MaxActivations = 1
	}
	codes, err := model.CreateNaimageActivationCodes(model.NaimageActivationCodeCreate{
		Name:           request.Name,
		Plan:           request.Plan,
		ValidDays:      request.ValidDays,
		MaxActivations: request.MaxActivations,
		ExpiredTime:    request.ExpiredTime,
	}, request.Count)
	if err != nil {
		naimageActivationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"codes": codes,
			"count": len(codes),
		},
	})
}

func ListNaimageActivationCodes(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	records, total, err := model.ListNaimageActivationCodes((page-1)*size, size)
	if err != nil {
		naimageActivationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items": records,
			"total": total,
			"page":  page,
			"size":  size,
		},
	})
}

func DisableNaimageActivationCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "激活码 ID 无效。"})
		return
	}
	if err := model.DisableNaimageActivationCode(id); err != nil {
		naimageActivationError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func RequireNaimageLicense(c *gin.Context, userId int) bool {
	if !NaimageLicenseRequired() {
		return true
	}
	deviceId := c.GetHeader("X-Naimage-Device-Id")
	token := c.GetHeader("X-Naimage-License")
	if _, err := model.VerifyNaimageLicense(token, deviceId, userId); err != nil {
		c.AbortWithStatusJSON(http.StatusPaymentRequired, gin.H{
			"error": gin.H{
				"message": "naimage 尚未激活或授权已过期，请输入有效激活码。",
				"type":    "license_required",
				"code":    "naimage_license_required",
			},
		})
		return false
	}
	return true
}
