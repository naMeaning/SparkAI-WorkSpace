package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const desktopDownloadAuditContent = "Desktop client download authorized"

var (
	ErrDesktopDownloadRateLimited = errors.New("desktop client download rate limit exceeded")
	desktopDownloadReservationMu  sync.Mutex
)

// DesktopDownloadLimits controls rolling download windows. Limits are checked
// for both the authenticated account and the resolved client IP.
type DesktopDownloadLimits struct {
	IPHourly   int
	IPDaily    int
	UserHourly int
	UserDaily  int
}

type desktopDownloadWindow struct {
	column string
	value  interface{}
	since  int64
	limit  int
}

// ReserveDesktopDownload atomically checks the persistent audit log and writes
// one authorization record. The process mutex closes the count-then-insert race
// for the single production application instance, while the database record
// keeps limits effective across restarts.
func ReserveDesktopDownload(
	userID int,
	clientIP string,
	now time.Time,
	limits DesktopDownloadLimits,
	details map[string]interface{},
) error {
	if LOG_DB == nil {
		return errors.New("log database is not initialized")
	}
	if userID <= 0 {
		return errors.New("desktop download requires an authenticated user")
	}
	clientIP = strings.TrimSpace(clientIP)
	if clientIP == "" {
		return errors.New("desktop download requires a resolved client IP")
	}

	desktopDownloadReservationMu.Lock()
	defer desktopDownloadReservationMu.Unlock()

	nowUnix := now.Unix()
	windows := []desktopDownloadWindow{
		{column: "ip", value: clientIP, since: nowUnix - int64(time.Hour/time.Second), limit: limits.IPHourly},
		{column: "ip", value: clientIP, since: nowUnix - int64(24*time.Hour/time.Second), limit: limits.IPDaily},
		{column: "user_id", value: userID, since: nowUnix - int64(time.Hour/time.Second), limit: limits.UserHourly},
		{column: "user_id", value: userID, since: nowUnix - int64(24*time.Hour/time.Second), limit: limits.UserDaily},
	}

	username, _ := GetUsernameById(userID, false)
	return LOG_DB.Transaction(func(tx *gorm.DB) error {
		for _, window := range windows {
			if window.limit <= 0 {
				continue
			}
			var count int64
			err := tx.Model(&Log{}).
				Where("type = ? AND content = ? AND created_at >= ?", LogTypeSystem, desktopDownloadAuditContent, window.since).
				Where(fmt.Sprintf("%s = ?", window.column), window.value).
				Count(&count).Error
			if err != nil {
				return err
			}
			if count >= int64(window.limit) {
				return ErrDesktopDownloadRateLimited
			}
		}

		params := map[string]interface{}{}
		for key, value := range details {
			params[key] = value
		}
		other := map[string]interface{}{
			"op": buildOpField("desktop_client_download", params),
		}
		return tx.Create(&Log{
			UserId:    userID,
			Username:  username,
			CreatedAt: nowUnix,
			Type:      LogTypeSystem,
			Content:   desktopDownloadAuditContent,
			Ip:        clientIP,
			Other:     common.MapToJsonStr(other),
		}).Error
	})
}
