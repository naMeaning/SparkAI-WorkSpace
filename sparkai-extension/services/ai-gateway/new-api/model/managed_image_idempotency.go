package model

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ManagedImageIdempotencyProcessing = "processing"
	ManagedImageIdempotencySucceeded  = "succeeded"
	ManagedImageIdempotencyFailed     = "failed"
	ManagedImageIdempotencyUnknown    = "unknown"
)

var (
	ErrManagedImageIdempotencyClaimLost = errors.New("managed image idempotency claim was lost")
	ErrManagedImageIdempotencyCapacity  = errors.New("managed image idempotency capacity reached")
)

type ManagedImageIdempotencyUsage struct {
	RecordCount   int64 `gorm:"column:record_count"`
	ResponseBytes int64 `gorm:"column:response_bytes"`
}

// ManagedImageIdempotencyRecord stores only a hash of the client key and the
// request. The response is retained for a short bounded window so a desktop
// retry can receive the original result without generating or charging twice.
type ManagedImageIdempotencyRecord struct {
	ScopeHash    string `json:"-" gorm:"type:char(64);primaryKey"`
	UserId       int    `json:"-" gorm:"not null;index:idx_managed_image_idempotency_user"`
	RequestHash  string `json:"-" gorm:"type:char(64);not null"`
	State        string `json:"-" gorm:"type:varchar(16);not null;index:idx_managed_image_idempotency_state"`
	StatusCode   int    `json:"-" gorm:"not null"`
	ContentType  string `json:"-" gorm:"type:varchar(255)"`
	ResponseBody []byte `json:"-"`
	ResponseFile string `json:"-" gorm:"type:varchar(255);index:idx_managed_image_idempotency_response_file"`
	ResponseSize int64  `json:"-"`
	ResponseHash string `json:"-" gorm:"type:char(64)"`
	RequestId    string `json:"-" gorm:"type:varchar(64)"`
	CreatedAt    int64  `json:"-" gorm:"not null;index:idx_managed_image_idempotency_created"`
	UpdatedAt    int64  `json:"-" gorm:"not null"`
	ExpiresAt    int64  `json:"-" gorm:"not null;index:idx_managed_image_idempotency_expires"`
}

func (ManagedImageIdempotencyRecord) TableName() string {
	return "managed_image_idempotency"
}

// ClaimManagedImageIdempotency creates the durable processing marker. The
// unique scope hash makes the claim cross-process safe; in-process callers are
// additionally coalesced by the controller so they can wait for and replay the
// leader's response.
func ClaimManagedImageIdempotency(
	record ManagedImageIdempotencyRecord,
	now int64,
	maxRecords int64,
	maxUserRecords int64,
) (ManagedImageIdempotencyRecord, bool, error) {
	if DB == nil {
		return ManagedImageIdempotencyRecord{}, false, errors.New("database is not initialized")
	}
	if record.ScopeHash == "" || record.RequestHash == "" || record.UserId <= 0 {
		return ManagedImageIdempotencyRecord{}, false, errors.New("invalid managed image idempotency claim")
	}

	record.State = ManagedImageIdempotencyProcessing
	record.StatusCode = 0
	record.ContentType = ""
	record.ResponseBody = nil
	record.ResponseFile = ""
	record.ResponseSize = 0
	record.ResponseHash = ""
	record.CreatedAt = now
	record.UpdatedAt = now

	var existing ManagedImageIdempotencyRecord
	claimed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Only clear the colliding expired scope here. Global expiry cleanup is
		// throttled and batched by the controller to avoid a full-table DELETE in
		// every image request transaction.
		if err := tx.Where("scope_hash = ? AND expires_at <= ?", record.ScopeHash, now).
			Delete(&ManagedImageIdempotencyRecord{}).Error; err != nil {
			return err
		}
		findErr := tx.First(&existing, "scope_hash = ?", record.ScopeHash).Error
		if findErr == nil {
			return nil
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}
		if maxRecords > 0 {
			var recordCount int64
			if err := tx.Model(&ManagedImageIdempotencyRecord{}).
				Where("expires_at > ?", now).
				Count(&recordCount).Error; err != nil {
				return err
			}
			if recordCount >= maxRecords {
				return ErrManagedImageIdempotencyCapacity
			}
		}
		if maxUserRecords > 0 {
			var userRecordCount int64
			if err := tx.Model(&ManagedImageIdempotencyRecord{}).
				Where("expires_at > ? AND user_id = ?", now, record.UserId).
				Count(&userRecordCount).Error; err != nil {
				return err
			}
			if userRecordCount >= maxUserRecords {
				return ErrManagedImageIdempotencyCapacity
			}
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&record)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			claimed = true
			existing = record
			return nil
		}
		return tx.First(&existing, "scope_hash = ?", record.ScopeHash).Error
	})
	return existing, claimed, err
}

func CompleteManagedImageIdempotency(
	scopeHash string,
	userId int,
	requestHash string,
	state string,
	statusCode int,
	contentType string,
	responseBody []byte,
	responseFile string,
	responseSize int64,
	responseHash string,
	requestId string,
	updatedAt int64,
	expiresAt int64,
	maxStoredBytes int64,
	maxUserStoredBytes int64,
) error {
	if state != ManagedImageIdempotencySucceeded && state != ManagedImageIdempotencyFailed {
		return errors.New("invalid managed image idempotency completion state")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		storedBytes := int64(len(responseBody)) + max(responseSize, 0)
		if maxStoredBytes > 0 && storedBytes > 0 {
			var usage ManagedImageIdempotencyUsage
			if err := tx.Model(&ManagedImageIdempotencyRecord{}).
				Select("COALESCE(SUM(COALESCE(response_size, 0) + COALESCE(LENGTH(response_body), 0)), 0) AS response_bytes").
				Where("expires_at > ? AND scope_hash <> ?", updatedAt, scopeHash).
				Scan(&usage).Error; err != nil {
				return err
			}
			if usage.ResponseBytes+storedBytes > maxStoredBytes {
				return ErrManagedImageIdempotencyCapacity
			}
		}
		if maxUserStoredBytes > 0 && storedBytes > 0 {
			var userUsage ManagedImageIdempotencyUsage
			if err := tx.Model(&ManagedImageIdempotencyRecord{}).
				Select("COALESCE(SUM(COALESCE(response_size, 0) + COALESCE(LENGTH(response_body), 0)), 0) AS response_bytes").
				Where("expires_at > ? AND scope_hash <> ? AND user_id = ?", updatedAt, scopeHash, userId).
				Scan(&userUsage).Error; err != nil {
				return err
			}
			if userUsage.ResponseBytes+storedBytes > maxUserStoredBytes {
				return ErrManagedImageIdempotencyCapacity
			}
		}
		result := tx.Model(&ManagedImageIdempotencyRecord{}).
			Where("scope_hash = ? AND request_hash = ? AND state = ?", scopeHash, requestHash, ManagedImageIdempotencyProcessing).
			Updates(map[string]interface{}{
				"state":         state,
				"status_code":   statusCode,
				"content_type":  contentType,
				"response_body": responseBody,
				"response_file": responseFile,
				"response_size": max(responseSize, 0),
				"response_hash": responseHash,
				"request_id":    requestId,
				"updated_at":    updatedAt,
				"expires_at":    expiresAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrManagedImageIdempotencyClaimLost
		}
		return nil
	})
}

func ReleaseManagedImageIdempotency(scopeHash string, requestHash string) error {
	if DB == nil {
		return errors.New("database is not initialized")
	}
	return DB.Where(
		"scope_hash = ? AND request_hash = ? AND state = ?",
		scopeHash,
		requestHash,
		ManagedImageIdempotencyProcessing,
	).Delete(&ManagedImageIdempotencyRecord{}).Error
}

func CleanupExpiredManagedImageIdempotency(now int64, limit int) (int64, []string, error) {
	if DB == nil {
		return 0, nil, errors.New("database is not initialized")
	}
	if limit <= 0 {
		return 0, nil, nil
	}
	var expired []ManagedImageIdempotencyRecord
	if err := DB.Model(&ManagedImageIdempotencyRecord{}).
		Select("scope_hash", "response_file").
		Where("expires_at <= ?", now).
		Order("expires_at ASC").
		Limit(limit).
		Find(&expired).Error; err != nil {
		return 0, nil, err
	}
	if len(expired) == 0 {
		return 0, nil, nil
	}
	scopeHashes := make([]string, 0, len(expired))
	responseFiles := make([]string, 0, len(expired))
	for _, record := range expired {
		scopeHashes = append(scopeHashes, record.ScopeHash)
		if record.ResponseFile != "" {
			responseFiles = append(responseFiles, record.ResponseFile)
		}
	}
	result := DB.Where("scope_hash IN ? AND expires_at <= ?", scopeHashes, now).
		Delete(&ManagedImageIdempotencyRecord{})
	if result.Error != nil {
		return result.RowsAffected, nil, result.Error
	}
	return result.RowsAffected, responseFiles, nil
}

func GetManagedImageIdempotencyUsage(now int64) (ManagedImageIdempotencyUsage, error) {
	if DB == nil {
		return ManagedImageIdempotencyUsage{}, errors.New("database is not initialized")
	}
	var usage ManagedImageIdempotencyUsage
	err := DB.Model(&ManagedImageIdempotencyRecord{}).
		Select("COUNT(*) AS record_count, COALESCE(SUM(COALESCE(response_size, 0) + COALESCE(LENGTH(response_body), 0)), 0) AS response_bytes").
		Where("expires_at > ?", now).
		Scan(&usage).Error
	return usage, err
}

func GetActiveManagedImageIdempotencyResponseFiles(now int64) ([]string, error) {
	if DB == nil {
		return nil, errors.New("database is not initialized")
	}
	var responseFiles []string
	err := DB.Model(&ManagedImageIdempotencyRecord{}).
		Distinct("response_file").
		Where("response_file <> '' AND expires_at > ?", now).
		Pluck("response_file", &responseFiles).Error
	return responseFiles, err
}

func InvalidateManagedImageIdempotencyResponseFile(
	scopeHash string,
	requestHash string,
	responseFile string,
	updatedAt int64,
	expiresAt int64,
) (bool, error) {
	if DB == nil {
		return false, errors.New("database is not initialized")
	}
	result := DB.Model(&ManagedImageIdempotencyRecord{}).
		Where(
			"scope_hash = ? AND request_hash = ? AND state = ? AND response_file = ?",
			scopeHash,
			requestHash,
			ManagedImageIdempotencySucceeded,
			responseFile,
		).
		Updates(map[string]interface{}{
			"state":         ManagedImageIdempotencyUnknown,
			"response_body": nil,
			"response_file": "",
			"response_size": 0,
			"response_hash": "",
			"updated_at":    updatedAt,
			"expires_at":    expiresAt,
		})
	return result.RowsAffected == 1, result.Error
}

func MarkManagedImageIdempotencyUnknown(
	scopeHash string,
	requestHash string,
	requestId string,
	updatedAt int64,
	expiresAt int64,
) error {
	result := DB.Model(&ManagedImageIdempotencyRecord{}).
		Where("scope_hash = ? AND request_hash = ? AND state = ?", scopeHash, requestHash, ManagedImageIdempotencyProcessing).
		Updates(map[string]interface{}{
			"state":         ManagedImageIdempotencyUnknown,
			"response_body": nil,
			"response_file": "",
			"response_size": 0,
			"response_hash": "",
			"request_id":    requestId,
			"updated_at":    updatedAt,
			"expires_at":    expiresAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrManagedImageIdempotencyClaimLost
	}
	return nil
}
