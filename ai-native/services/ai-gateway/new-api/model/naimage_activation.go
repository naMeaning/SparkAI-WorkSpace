package model

import (
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	NaimageActivationEnabled  = 1
	NaimageActivationDisabled = 2
)

var (
	ErrNaimageActivationInvalid = errors.New("naimage activation code is invalid")
	ErrNaimageActivationExpired = errors.New("naimage activation code is expired")
	ErrNaimageActivationUsed    = errors.New("naimage activation code has reached its activation limit")
	ErrNaimageLicenseInvalid    = errors.New("naimage license is invalid")
)

// NaimageActivationCode stores only a digest and a short display hint. The
// plaintext code is returned once from the admin creation endpoint.
type NaimageActivationCode struct {
	Id              int    `json:"id"`
	Name            string `json:"name" gorm:"type:varchar(80);not null"`
	CodeHash        string `json:"-" gorm:"type:char(64);uniqueIndex;not null"`
	CodeHint        string `json:"code_hint" gorm:"type:varchar(24);not null"`
	Plan            string `json:"plan" gorm:"type:varchar(40);not null"`
	ValidDays       int    `json:"valid_days" gorm:"not null"`
	MaxActivations  int    `json:"max_activations" gorm:"not null"`
	ActivationCount int    `json:"activation_count" gorm:"not null"`
	Status          int    `json:"status" gorm:"not null;index"`
	ExpiredTime     int64  `json:"expired_time" gorm:"bigint;not null;index"`
	CreatedTime     int64  `json:"created_time" gorm:"bigint;not null"`
}

func (NaimageActivationCode) TableName() string {
	return "naimage_activation_codes"
}

type NaimageActivationGrant struct {
	Id               int    `json:"id"`
	CodeId           int    `json:"code_id" gorm:"not null;index"`
	UserId           int    `json:"user_id" gorm:"not null;index"`
	DeviceHash       string `json:"-" gorm:"type:char(64);not null;index:idx_naimage_activation_subject"`
	TokenHash        string `json:"-" gorm:"type:char(64);uniqueIndex;not null"`
	Plan             string `json:"plan" gorm:"type:varchar(40);not null"`
	Status           int    `json:"status" gorm:"not null;index"`
	ActivatedTime    int64  `json:"activated_time" gorm:"bigint;not null"`
	LastVerifiedTime int64  `json:"last_verified_time" gorm:"bigint;not null"`
	ExpiresAt        int64  `json:"expires_at" gorm:"bigint;not null;index"`
}

func (NaimageActivationGrant) TableName() string {
	return "naimage_activation_grants"
}

type NaimageActivationResult struct {
	Token     string `json:"token"`
	Plan      string `json:"plan"`
	ExpiresAt int64  `json:"expires_at"`
}

type NaimageActivationCodeCreate struct {
	Name           string
	Plan           string
	ValidDays      int
	MaxActivations int
	ExpiredTime    int64
}

func CreateNaimageActivationCodes(input NaimageActivationCodeCreate, count int) ([]string, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Plan = strings.TrimSpace(input.Plan)
	if input.Name == "" || input.Plan == "" || count < 1 || count > 100 || input.ValidDays < 0 || input.ValidDays > 3650 || input.MaxActivations < 1 || input.MaxActivations > 100 {
		return nil, ErrNaimageActivationInvalid
	}
	now := time.Now().Unix()
	if input.ExpiredTime > 0 && input.ExpiredTime <= now {
		return nil, ErrNaimageActivationExpired
	}

	plainCodes := make([]string, 0, count)
	err := DB.Transaction(func(tx *gorm.DB) error {
		for len(plainCodes) < count {
			randomPart, err := common.GenerateRandomCharsKey(16)
			if err != nil {
				return err
			}
			randomPart = strings.ToUpper(randomPart)
			plainCode := "NAI-" + strings.Join([]string{randomPart[0:4], randomPart[4:8], randomPart[8:12], randomPart[12:16]}, "-")
			codeHash := hashNaimageActivationSecret(plainCode)
			var existingCount int64
			if err := tx.Model(&NaimageActivationCode{}).Where("code_hash = ?", codeHash).Count(&existingCount).Error; err != nil {
				return err
			}
			if existingCount > 0 {
				continue
			}
			record := NaimageActivationCode{
				Name:           input.Name,
				CodeHash:       codeHash,
				CodeHint:       plainCode[0:8] + "…" + plainCode[len(plainCode)-4:],
				Plan:           input.Plan,
				ValidDays:      input.ValidDays,
				MaxActivations: input.MaxActivations,
				Status:         NaimageActivationEnabled,
				ExpiredTime:    input.ExpiredTime,
				CreatedTime:    now,
			}
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
			plainCodes = append(plainCodes, plainCode)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return plainCodes, nil
}

func ListNaimageActivationCodes(offset, limit int) ([]NaimageActivationCode, int64, error) {
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	var records []NaimageActivationCode
	var total int64
	query := DB.Model(&NaimageActivationCode{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id desc").Offset(offset).Limit(limit).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

func DisableNaimageActivationCode(id int) error {
	if id <= 0 {
		return ErrNaimageActivationInvalid
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&NaimageActivationCode{}).Where("id = ?", id).Update("status", NaimageActivationDisabled).Error; err != nil {
			return err
		}
		return tx.Model(&NaimageActivationGrant{}).Where("code_id = ?", id).Update("status", NaimageActivationDisabled).Error
	})
}

func normalizeNaimageActivationSecret(value string) string {
	return strings.ToUpper(strings.Join(strings.Fields(strings.TrimSpace(value)), ""))
}

func hashNaimageActivationSecret(value string) string {
	return hex.EncodeToString(common.Sha256Raw([]byte(normalizeNaimageActivationSecret(value))))
}

func hashNaimageDevice(value string) string {
	return hex.EncodeToString(common.Sha256Raw([]byte(strings.TrimSpace(value))))
}

func ActivateNaimage(code, deviceId string, userId int) (*NaimageActivationResult, error) {
	code = normalizeNaimageActivationSecret(code)
	deviceId = strings.TrimSpace(deviceId)
	if len(code) < 12 || len(code) > 128 || len(deviceId) < 16 || len(deviceId) > 128 || userId < 0 {
		return nil, ErrNaimageActivationInvalid
	}

	now := time.Now().Unix()
	deviceHash := hashNaimageDevice(deviceId)
	var result *NaimageActivationResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		var activationCode NaimageActivationCode
		if err := lockForUpdate(tx).Where("code_hash = ?", hashNaimageActivationSecret(code)).First(&activationCode).Error; err != nil {
			return ErrNaimageActivationInvalid
		}
		if activationCode.Status != NaimageActivationEnabled {
			return ErrNaimageActivationInvalid
		}
		if activationCode.ExpiredTime > 0 && activationCode.ExpiredTime <= now {
			return ErrNaimageActivationExpired
		}

		var existing NaimageActivationGrant
		existingErr := tx.Where(
			"code_id = ? AND user_id = ? AND device_hash = ? AND status = ?",
			activationCode.Id,
			userId,
			deviceHash,
			NaimageActivationEnabled,
		).Order("id desc").First(&existing).Error
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}

		plainToken, err := common.GenerateRandomCharsKey(48)
		if err != nil {
			return err
		}
		expiresAt := int64(0)
		if activationCode.ValidDays > 0 {
			expiresAt = now + int64(activationCode.ValidDays)*24*60*60
		}

		if existingErr == nil {
			if existing.ExpiresAt > 0 && existing.ExpiresAt <= now {
				return ErrNaimageActivationExpired
			}
			existing.TokenHash = hashNaimageActivationSecret(plainToken)
			existing.LastVerifiedTime = now
			if err := tx.Model(&existing).Select("token_hash", "last_verified_time").Updates(&existing).Error; err != nil {
				return err
			}
			result = &NaimageActivationResult{Token: plainToken, Plan: existing.Plan, ExpiresAt: existing.ExpiresAt}
			return nil
		}

		if activationCode.MaxActivations <= 0 || activationCode.ActivationCount >= activationCode.MaxActivations {
			return ErrNaimageActivationUsed
		}
		grant := NaimageActivationGrant{
			CodeId:           activationCode.Id,
			UserId:           userId,
			DeviceHash:       deviceHash,
			TokenHash:        hashNaimageActivationSecret(plainToken),
			Plan:             activationCode.Plan,
			Status:           NaimageActivationEnabled,
			ActivatedTime:    now,
			LastVerifiedTime: now,
			ExpiresAt:        expiresAt,
		}
		if err := tx.Create(&grant).Error; err != nil {
			return err
		}
		updated := tx.Model(&NaimageActivationCode{}).
			Where("id = ? AND activation_count < max_activations", activationCode.Id).
			UpdateColumn("activation_count", gorm.Expr("activation_count + ?", 1))
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrNaimageActivationUsed
		}
		result = &NaimageActivationResult{Token: plainToken, Plan: grant.Plan, ExpiresAt: grant.ExpiresAt}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func VerifyNaimageLicense(token, deviceId string, userId int) (*NaimageActivationGrant, error) {
	token = normalizeNaimageActivationSecret(token)
	deviceId = strings.TrimSpace(deviceId)
	if len(token) < 32 || len(deviceId) < 16 || len(deviceId) > 128 || userId < 0 {
		return nil, ErrNaimageLicenseInvalid
	}
	now := time.Now().Unix()
	var grant NaimageActivationGrant
	if err := DB.Where(
		"token_hash = ? AND device_hash = ? AND status = ?",
		hashNaimageActivationSecret(token),
		hashNaimageDevice(deviceId),
		NaimageActivationEnabled,
	).First(&grant).Error; err != nil {
		return nil, ErrNaimageLicenseInvalid
	}
	if grant.ExpiresAt > 0 && grant.ExpiresAt <= now {
		return nil, ErrNaimageActivationExpired
	}
	if now-grant.LastVerifiedTime >= 5*60 {
		if err := DB.Model(&grant).Update("last_verified_time", now).Error; err != nil {
			return nil, err
		}
		grant.LastVerifiedTime = now
	}
	return &grant, nil
}
