package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupNaimageActivationTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&NaimageActivationCode{}, &NaimageActivationGrant{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&NaimageActivationGrant{}).Error)
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&NaimageActivationCode{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&NaimageActivationGrant{}).Error)
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&NaimageActivationCode{}).Error)
	})
}

func TestNaimageActivationCodeIsHashedAndDeviceBound(t *testing.T) {
	setupNaimageActivationTest(t)
	codes, err := CreateNaimageActivationCodes(NaimageActivationCodeCreate{
		Name:           "desktop-standard",
		Plan:           "standard",
		ValidDays:      30,
		MaxActivations: 1,
	}, 1)
	require.NoError(t, err)
	require.Len(t, codes, 1)

	var stored NaimageActivationCode
	require.NoError(t, DB.First(&stored).Error)
	assert.NotContains(t, stored.CodeHash, codes[0])
	assert.Len(t, stored.CodeHash, 64)

	deviceId := "device-1234567890abcdef"
	activated, err := ActivateNaimage(codes[0], deviceId, 17)
	require.NoError(t, err)
	assert.Equal(t, "standard", activated.Plan)
	assert.Greater(t, activated.ExpiresAt, time.Now().Unix())

	grant, err := VerifyNaimageLicense(activated.Token, deviceId, 17)
	require.NoError(t, err)
	assert.Equal(t, "standard", grant.Plan)

	_, err = VerifyNaimageLicense(activated.Token, "device-fedcba0987654321", 17)
	assert.ErrorIs(t, err, ErrNaimageLicenseInvalid)

	// A device license follows the installation when the user switches between
	// account and custom API modes; the user id is audit metadata, not a second
	// device binding.
	_, err = VerifyNaimageLicense(activated.Token, deviceId, 0)
	require.NoError(t, err)
}

func TestNaimageActivationLimitAndSameDeviceRetry(t *testing.T) {
	setupNaimageActivationTest(t)
	codes, err := CreateNaimageActivationCodes(NaimageActivationCodeCreate{
		Name:           "single-device",
		Plan:           "standard",
		MaxActivations: 1,
	}, 1)
	require.NoError(t, err)

	first, err := ActivateNaimage(codes[0], "device-1234567890abcdef", 0)
	require.NoError(t, err)
	second, err := ActivateNaimage(codes[0], "device-1234567890abcdef", 0)
	require.NoError(t, err)
	assert.NotEqual(t, first.Token, second.Token, "same-device retry rotates the bearer token without consuming another activation")

	_, err = VerifyNaimageLicense(first.Token, "device-1234567890abcdef", 0)
	assert.ErrorIs(t, err, ErrNaimageLicenseInvalid)
	_, err = VerifyNaimageLicense(second.Token, "device-1234567890abcdef", 0)
	require.NoError(t, err)

	_, err = ActivateNaimage(codes[0], "device-fedcba0987654321", 0)
	assert.ErrorIs(t, err, ErrNaimageActivationUsed)
}

func TestNaimageProLicenseAllowsThreeDevicesAndRevocation(t *testing.T) {
	setupNaimageActivationTest(t)
	codes, err := CreateNaimageActivationCodes(NaimageActivationCodeCreate{
		Name:           "desktop-pro",
		Plan:           "Pro",
		MaxActivations: 3,
	}, 1)
	require.NoError(t, err)

	devices := []string{
		"device-pro-000000000001",
		"device-pro-000000000002",
		"device-pro-000000000003",
	}
	grants := make([]*NaimageActivationResult, 0, len(devices))
	for _, deviceID := range devices {
		grant, activateErr := ActivateNaimageForPlan(codes[0], deviceID, 0, NaimageLicensePlanPro)
		require.NoError(t, activateErr)
		assert.Equal(t, NaimageLicensePlanPro, grant.Plan)
		assert.Zero(t, grant.ExpiresAt, "valid_days=0 must produce a permanent license")
		grants = append(grants, grant)
	}

	_, err = ActivateNaimageForPlan(codes[0], "device-pro-000000000004", 0, NaimageLicensePlanPro)
	assert.ErrorIs(t, err, ErrNaimageActivationUsed)

	var stored NaimageActivationCode
	require.NoError(t, DB.First(&stored).Error)
	require.NoError(t, DisableNaimageActivationCode(stored.Id))
	_, err = VerifyNaimageLicenseForPlan(grants[0].Token, devices[0], 0, NaimageLicensePlanPro)
	assert.ErrorIs(t, err, ErrNaimageLicenseInvalid)
}

func TestNaimageCustomAPIRejectsNonProCodeWithoutConsumingActivation(t *testing.T) {
	setupNaimageActivationTest(t)
	codes, err := CreateNaimageActivationCodes(NaimageActivationCodeCreate{
		Name:           "desktop-standard",
		Plan:           "standard",
		MaxActivations: 3,
	}, 1)
	require.NoError(t, err)

	_, err = ActivateNaimageForPlan(codes[0], "device-standard-000001", 0, NaimageLicensePlanPro)
	assert.ErrorIs(t, err, ErrNaimageLicensePlanInvalid)

	var stored NaimageActivationCode
	require.NoError(t, DB.First(&stored).Error)
	assert.Zero(t, stored.ActivationCount)
}
