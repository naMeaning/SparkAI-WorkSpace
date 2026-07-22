package controller

import (
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
)

type relayTokenManageResponse struct {
	Key     string `json:"key"`
	TokenID int    `json:"token_id"`
	Name    string `json:"name"`
}

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

func callEnsureRelayToken(t *testing.T, targetUserId int) relayTokenManageResponse {
	t.Helper()

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/user/manage", map[string]any{
		"id":     targetUserId,
		"action": "ensure_relay_token",
	}, 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Set("use_access_token", true)

	ManageUser(ctx)

	response := decodeAPIResponse(t, recorder)
	if !response.Success {
		t.Fatalf("expected ensure_relay_token to succeed, got message: %s", response.Message)
	}

	var tokenResponse relayTokenManageResponse
	if err := common.Unmarshal(response.Data, &tokenResponse); err != nil {
		t.Fatalf("failed to decode relay token response: %v", err)
	}
	if tokenResponse.Key == "" {
		t.Fatalf("expected relay token response to include full token key")
	}
	return tokenResponse
}

func TestManageUserEnsureRelayTokenRequiresServiceAccessToken(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/user/manage", map[string]any{
		"id":     user.Id,
		"action": "ensure_relay_token",
	}, 1)
	ctx.Set("role", common.RoleRootUser)

	ManageUser(ctx)

	response := decodeAPIResponse(t, recorder)
	if response.Success {
		t.Fatalf("expected ensure_relay_token to reject session-based admin calls")
	}
	if recorder.Body.String() == "" {
		t.Fatalf("expected error response body")
	}
}

func TestManageUserEnsureRelayTokenCreatesAndReusesServerSideToken(t *testing.T) {
	user := setupUserManageRelayTokenTestDB(t)

	first := callEnsureRelayToken(t, user.Id)

	var token model.Token
	if err := model.DB.First(&token, "id = ?", first.TokenID).Error; err != nil {
		t.Fatalf("failed to load created relay token: %v", err)
	}
	if token.UserId != user.Id {
		t.Fatalf("expected token user_id %d, got %d", user.Id, token.UserId)
	}
	if token.Name != "crm-relay" {
		t.Fatalf("expected token name crm-relay, got %q", token.Name)
	}
	if token.GetFullKey() != first.Key {
		t.Fatalf("expected full key %q, got %q", token.GetFullKey(), first.Key)
	}
	if token.Status != common.TokenStatusEnabled {
		t.Fatalf("expected enabled token status, got %d", token.Status)
	}
	if token.ExpiredTime != -1 {
		t.Fatalf("expected non-expiring token, got expired_time=%d", token.ExpiredTime)
	}
	if !token.UnlimitedQuota {
		t.Fatalf("expected relay token to use unlimited token quota")
	}

	second := callEnsureRelayToken(t, user.Id)
	if second.Key != first.Key || second.TokenID != first.TokenID {
		t.Fatalf("expected second ensure to reuse token %#v, got %#v", first, second)
	}

	var tokenCount int64
	if err := model.DB.Model(&model.Token{}).Where("user_id = ? AND name = ?", user.Id, "crm-relay").Count(&tokenCount).Error; err != nil {
		t.Fatalf("failed to count relay tokens: %v", err)
	}
	if tokenCount != 1 {
		t.Fatalf("expected one crm-relay token, got %d", tokenCount)
	}
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
	if token.Name != crmRelayTokenName {
		t.Fatalf("expected token name %q, got %q", crmRelayTokenName, token.Name)
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
