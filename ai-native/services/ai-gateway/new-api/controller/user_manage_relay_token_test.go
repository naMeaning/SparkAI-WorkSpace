package controller

import (
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupUserManageRelayTokenTestDB(t *testing.T) *model.User {
	t.Helper()

	db := openTokenControllerTestDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}); err != nil {
		t.Fatalf("failed to migrate user manage relay token tables: %v", err)
	}

	root := model.User{
		Id:          1,
		Username:    "root",
		Password:    "root-password",
		DisplayName: "root",
		Role:        common.RoleRootUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AffCode:     "ROOTAFF",
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatalf("failed to create root user: %v", err)
	}

	user := model.User{
		Id:          2,
		Username:    "crm-user",
		Password:    "user-password",
		DisplayName: "crm-user",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		AffCode:     "USERAFF",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("failed to create target user: %v", err)
	}
	return &user
}

func TestManageUserRejectsRemovedEnsureRelayTokenActionWithoutLeakingKey(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	token := seedToken(t, model.DB, user.Id, model.ManagedRelayTokenName, "managed-relay-secret-key")
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/user/manage", map[string]any{
		"id":     user.Id,
		"action": "ensure_relay_token",
	}, 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Set("use_access_token", true)

	ManageUser(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.False(t, response.Success)
	assert.NotEmpty(t, recorder.Body.String())
	assert.NotContains(t, recorder.Body.String(), token.Key)
	assert.NotContains(t, recorder.Body.String(), `"key"`)
}

func TestEnsureRelayTokenForUserCreatesCanonicalTokenAndReusesIt(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)

	first, created, err := ensureRelayTokenForUser(*user)
	require.NoError(t, err)
	require.True(t, created)
	assert.Equal(t, user.Id, first.UserId)
	assert.Equal(t, model.ManagedRelayTokenName, first.Name)
	assert.NotEmpty(t, first.Key)
	assert.Equal(t, common.TokenStatusEnabled, first.Status)
	assert.EqualValues(t, -1, first.ExpiredTime)
	assert.True(t, first.UnlimitedQuota)

	second, created, err := ensureRelayTokenForUser(*user)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, first.Id, second.Id)
	assert.Equal(t, first.Key, second.Key)

	var tokenCount int64
	require.NoError(t, model.DB.Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&tokenCount).Error)
	assert.EqualValues(t, 1, tokenCount)
}

func TestEnsureRelayTokenForUserRepairsCanonicalAndMigratesLegacyTokensInPlace(t *testing.T) {
	for _, previousName := range []string{model.ManagedRelayTokenName, "studio-relay", "crm-relay"} {
		t.Run(previousName, func(t *testing.T) {
			user := setupUserManageRelayTokenTestDB(t)
			existing := seedToken(t, model.DB, user.Id, previousName, previousName+"-secret-key")
			require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", existing.Id).Updates(map[string]any{
				"status":          common.TokenStatusDisabled,
				"expired_time":    1,
				"unlimited_quota": false,
			}).Error)

			token, created, err := ensureRelayTokenForUser(*user)
			require.NoError(t, err)
			assert.False(t, created)
			assert.Equal(t, existing.Id, token.Id)
			assert.Equal(t, existing.Key, token.Key)
			assert.Equal(t, model.ManagedRelayTokenName, token.Name)
			assert.Equal(t, common.TokenStatusEnabled, token.Status)
			assert.EqualValues(t, -1, token.ExpiredTime)
			assert.True(t, token.UnlimitedQuota)

			var stored model.Token
			require.NoError(t, model.DB.First(&stored, "id = ?", existing.Id).Error)
			assert.Equal(t, existing.Key, stored.Key)
			assert.Equal(t, model.ManagedRelayTokenName, stored.Name)
			assert.Equal(t, common.TokenStatusEnabled, stored.Status)
			assert.EqualValues(t, -1, stored.ExpiredTime)
			assert.True(t, stored.UnlimitedQuota)

			var tokenCount int64
			require.NoError(t, model.DB.Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&tokenCount).Error)
			assert.EqualValues(t, 1, tokenCount)
		})
	}
}

func TestEnsureRelayTokenForUserPrefersCanonicalTokenOverLegacyToken(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	legacy := seedToken(t, model.DB, user.Id, "studio-relay", "legacy-secret-key")
	canonical := seedToken(t, model.DB, user.Id, model.ManagedRelayTokenName, "canonical-secret-key")
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", canonical.Id).Updates(map[string]any{
		"status":          common.TokenStatusDisabled,
		"expired_time":    1,
		"unlimited_quota": false,
	}).Error)

	token, created, err := ensureRelayTokenForUser(*user)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, canonical.Id, token.Id)
	assert.Equal(t, canonical.Key, token.Key)
	assert.Equal(t, common.TokenStatusEnabled, token.Status)
	assert.EqualValues(t, -1, token.ExpiredTime)
	assert.True(t, token.UnlimitedQuota)

	var storedLegacy model.Token
	require.NoError(t, model.DB.First(&storedLegacy, "id = ?", legacy.Id).Error)
	assert.Equal(t, "studio-relay", storedLegacy.Name)

	var tokenCount int64
	require.NoError(t, model.DB.Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&tokenCount).Error)
	assert.EqualValues(t, 2, tokenCount)
}

func TestRegisterCreatesHiddenRelayTokenWithoutLeakingKey(t *testing.T) {
	db := openTokenControllerTestDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}); err != nil {
		t.Fatalf("failed to migrate registration relay token tables: %v", err)
	}

	oldRegisterEnabled := common.RegisterEnabled
	oldPasswordRegisterEnabled := common.PasswordRegisterEnabled
	oldEmailVerificationEnabled := common.EmailVerificationEnabled
	oldGenerateDefaultToken := constant.GenerateDefaultToken
	oldDefaultUseAutoGroup := setting.DefaultUseAutoGroup
	t.Cleanup(func() {
		common.RegisterEnabled = oldRegisterEnabled
		common.PasswordRegisterEnabled = oldPasswordRegisterEnabled
		common.EmailVerificationEnabled = oldEmailVerificationEnabled
		constant.GenerateDefaultToken = oldGenerateDefaultToken
		setting.DefaultUseAutoGroup = oldDefaultUseAutoGroup
	})
	common.RegisterEnabled = true
	common.PasswordRegisterEnabled = true
	common.EmailVerificationEnabled = false
	constant.GenerateDefaultToken = false
	setting.DefaultUseAutoGroup = false

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/user/register", map[string]any{
		"username": "nativeuser",
		"password": "password123",
	}, 0)
	Register(ctx)

	response := decodeAPIResponse(t, recorder)
	if !response.Success {
		t.Fatalf("expected registration to succeed, got message: %s", response.Message)
	}

	var user model.User
	if err := model.DB.First(&user, "username = ?", "nativeuser").Error; err != nil {
		t.Fatalf("failed to load registered user: %v", err)
	}

	var tokens []model.Token
	if err := model.DB.Find(&tokens, "user_id = ?", user.Id).Error; err != nil {
		t.Fatalf("failed to load registered user tokens: %v", err)
	}
	if len(tokens) != 1 {
		t.Fatalf("expected one hidden relay token, got %d", len(tokens))
	}
	token := tokens[0]
	if token.Name != model.ManagedRelayTokenName {
		t.Fatalf("expected token name %q, got %q", model.ManagedRelayTokenName, token.Name)
	}
	if token.Status != common.TokenStatusEnabled {
		t.Fatalf("expected enabled token status, got %d", token.Status)
	}
	if token.ExpiredTime != -1 {
		t.Fatalf("expected non-expiring token, got expired_time=%d", token.ExpiredTime)
	}
	if !token.UnlimitedQuota {
		t.Fatalf("expected hidden relay token to be unlimited")
	}
	if token.Key == "" {
		t.Fatalf("expected hidden relay token key to be stored")
	}
	if strings.Contains(recorder.Body.String(), token.Key) {
		t.Fatalf("registration response leaked hidden relay token key: %s", recorder.Body.String())
	}
}
