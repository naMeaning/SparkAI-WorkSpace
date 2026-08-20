package model

import (
	"bytes"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useBrandMigrationTestDatabase(t *testing.T, migrateSchema bool) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	if migrateSchema {
		require.NoError(t, db.AutoMigrate(&Option{}))
	}

	originalDB := DB
	DB = db
	t.Cleanup(func() {
		DB = originalDB
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func preserveBrandOptionGlobals(t *testing.T) {
	t.Helper()

	common.OptionMapRWMutex.Lock()
	originalOptionMap := make(map[string]string, len(common.OptionMap))
	for key, value := range common.OptionMap {
		originalOptionMap[key] = value
	}
	originalSystemName := common.SystemName
	originalLogo := common.Logo
	common.OptionMapRWMutex.Unlock()

	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalOptionMap
		common.SystemName = originalSystemName
		common.Logo = originalLogo
		common.OptionMapRWMutex.Unlock()
	})
}

func readBrandMigrationOptions(t *testing.T, db *gorm.DB) map[string]string {
	t.Helper()

	var options []Option
	require.NoError(t, db.Find(&options).Error)
	values := make(map[string]string, len(options))
	for _, option := range options {
		values[option.Key] = option.Value
	}
	return values
}

func readOptionMapBrand(t *testing.T) (string, string) {
	t.Helper()

	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap["SystemName"], common.OptionMap["Logo"]
}

func TestMigrateLegacyNaimageBrandDefaults(t *testing.T) {
	tests := []struct {
		name     string
		initial  map[string]string
		expected map[string]string
		runs     int
	}{
		{
			name: "exact legacy defaults migrate and remain idempotent",
			initial: map[string]string{
				"SystemName": "iiimage Studio",
				"Logo":       "/iiimage-logo.svg",
			},
			expected: map[string]string{
				"SystemName": "naimage",
				"Logo":       "/naimage-logo.svg",
			},
			runs: 2,
		},
		{
			name: "custom branding remains unchanged",
			initial: map[string]string{
				"SystemName": "Acme Images",
				"Logo":       "https://cdn.example/logo.svg",
			},
			expected: map[string]string{
				"SystemName": "Acme Images",
				"Logo":       "https://cdn.example/logo.svg",
			},
			runs: 1,
		},
		{
			name: "mixed state migrates only the legacy value",
			initial: map[string]string{
				"SystemName": "iiimage Studio",
				"Logo":       "https://cdn.example/custom.svg",
			},
			expected: map[string]string{
				"SystemName": "naimage",
				"Logo":       "https://cdn.example/custom.svg",
			},
			runs: 1,
		},
		{
			name: "case variants remain unchanged",
			initial: map[string]string{
				"SystemName": "iiimage studio",
				"Logo":       "/IIIMAGE-logo.svg",
			},
			expected: map[string]string{
				"SystemName": "iiimage studio",
				"Logo":       "/IIIMAGE-logo.svg",
			},
			runs: 1,
		},
		{
			name: "whitespace variants remain unchanged",
			initial: map[string]string{
				"SystemName": " iiimage Studio ",
				"Logo":       "/iiimage-logo.svg ",
			},
			expected: map[string]string{
				"SystemName": " iiimage Studio ",
				"Logo":       "/iiimage-logo.svg ",
			},
			runs: 1,
		},
		{
			name: "missing brand options are not created",
			initial: map[string]string{
				"Footer": "operator footer",
			},
			expected: map[string]string{
				"Footer": "operator footer",
			},
			runs: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := useBrandMigrationTestDatabase(t, true)
			for key, value := range test.initial {
				require.NoError(t, db.Create(&Option{Key: key, Value: value}).Error)
			}

			for run := 0; run < test.runs; run++ {
				require.NoError(t, migrateLegacyNaimageBrandDefaults())
				assert.Equal(t, test.expected, readBrandMigrationOptions(t, db))
			}
		})
	}
}

func TestInitOptionMapMigratesLegacyBrandAcrossDatabaseAndRuntimeState(t *testing.T) {
	db := useBrandMigrationTestDatabase(t, true)
	preserveBrandOptionGlobals(t)
	require.NoError(t, db.Create(&[]Option{
		{Key: "SystemName", Value: "iiimage Studio"},
		{Key: "Logo", Value: "/iiimage-logo.svg"},
	}).Error)
	common.SystemName = "naimage"
	common.Logo = "/naimage-logo.svg"

	InitOptionMap()

	assert.Equal(t, map[string]string{
		"SystemName": "naimage",
		"Logo":       "/naimage-logo.svg",
	}, readBrandMigrationOptions(t, db))
	optionMapSystemName, optionMapLogo := readOptionMapBrand(t)
	assert.Equal(t, "naimage", optionMapSystemName)
	assert.Equal(t, "/naimage-logo.svg", optionMapLogo)
	assert.Equal(t, "naimage", common.SystemName)
	assert.Equal(t, "/naimage-logo.svg", common.Logo)
}

func TestPeriodicOptionLoadDoesNotRepeatLegacyBrandMigration(t *testing.T) {
	db := useBrandMigrationTestDatabase(t, true)
	preserveBrandOptionGlobals(t)
	require.NoError(t, db.Create(&[]Option{
		{Key: "SystemName", Value: "iiimage Studio"},
		{Key: "Logo", Value: "/iiimage-logo.svg"},
	}).Error)
	common.OptionMapRWMutex.Lock()
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()

	loadOptionsFromDatabase()

	assert.Equal(t, map[string]string{
		"SystemName": "iiimage Studio",
		"Logo":       "/iiimage-logo.svg",
	}, readBrandMigrationOptions(t, db))
	optionMapSystemName, optionMapLogo := readOptionMapBrand(t)
	assert.Equal(t, "iiimage Studio", optionMapSystemName)
	assert.Equal(t, "/iiimage-logo.svg", optionMapLogo)
	assert.Equal(t, "iiimage Studio", common.SystemName)
	assert.Equal(t, "/iiimage-logo.svg", common.Logo)
}

func TestInitOptionMapLogsBrandMigrationFailureAndContinues(t *testing.T) {
	useBrandMigrationTestDatabase(t, false)
	preserveBrandOptionGlobals(t)
	common.SystemName = "naimage"
	common.Logo = "/naimage-logo.svg"

	var errorLog bytes.Buffer
	common.LogWriterMu.Lock()
	originalErrorWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &errorLog
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = originalErrorWriter
		common.LogWriterMu.Unlock()
	})

	InitOptionMap()

	optionMapSystemName, optionMapLogo := readOptionMapBrand(t)
	assert.Equal(t, "naimage", optionMapSystemName)
	assert.Equal(t, "/naimage-logo.svg", optionMapLogo)
	assert.Contains(t, errorLog.String(), "failed to migrate legacy naimage brand defaults")
}
