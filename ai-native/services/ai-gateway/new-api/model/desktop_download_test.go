package model

import (
	"errors"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func setupDesktopDownloadTestDB(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Exec("DELETE FROM logs").Error)
	require.NoError(t, DB.Exec("DELETE FROM users").Error)
	require.NoError(t, DB.Create(&User{
		Id:       9,
		Username: "download-user",
		AffCode:  "download-user-aff",
		Status:   common.UserStatusEnabled,
		Role:     common.RoleCommonUser,
	}).Error)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM logs")
		DB.Exec("DELETE FROM users")
	})
}

func TestReserveDesktopDownloadPersistsAndLimitsByUserAndIP(t *testing.T) {
	setupDesktopDownloadTestDB(t)
	now := time.Unix(1_800_000_000, 0)
	limits := DesktopDownloadLimits{IPHourly: 2, IPDaily: 4, UserHourly: 2, UserDaily: 4}

	for index := 0; index < 2; index++ {
		err := ReserveDesktopDownload(9, "203.0.113.10", now.Add(time.Duration(index)*time.Minute), limits, map[string]interface{}{
			"filename": "iiimage-Studio-Setup.exe",
		})
		require.NoError(t, err)
	}

	err := ReserveDesktopDownload(9, "203.0.113.10", now.Add(2*time.Minute), limits, nil)
	require.ErrorIs(t, err, ErrDesktopDownloadRateLimited)

	var count int64
	require.NoError(t, LOG_DB.Model(&Log{}).Where("content = ?", desktopDownloadAuditContent).Count(&count).Error)
	require.Equal(t, int64(2), count)
}

func TestReserveDesktopDownloadLimitsSharedIPAcrossUsers(t *testing.T) {
	setupDesktopDownloadTestDB(t)
	require.NoError(t, DB.Create(&User{
		Id:       10,
		Username: "second-user",
		AffCode:  "second-user-aff",
		Status:   common.UserStatusEnabled,
		Role:     common.RoleCommonUser,
	}).Error)

	now := time.Unix(1_800_000_000, 0)
	limits := DesktopDownloadLimits{IPHourly: 1, IPDaily: 10, UserHourly: 10, UserDaily: 10}
	require.NoError(t, ReserveDesktopDownload(9, "198.51.100.7", now, limits, nil))
	err := ReserveDesktopDownload(10, "198.51.100.7", now.Add(time.Minute), limits, nil)
	require.True(t, errors.Is(err, ErrDesktopDownloadRateLimited))
}

func TestReserveDesktopDownloadRollingWindowExpires(t *testing.T) {
	setupDesktopDownloadTestDB(t)
	now := time.Unix(1_800_000_000, 0)
	limits := DesktopDownloadLimits{IPHourly: 1, IPDaily: 10, UserHourly: 1, UserDaily: 10}
	require.NoError(t, ReserveDesktopDownload(9, "192.0.2.20", now, limits, nil))
	require.NoError(t, ReserveDesktopDownload(9, "192.0.2.20", now.Add(time.Hour+time.Second), limits, nil))
}
