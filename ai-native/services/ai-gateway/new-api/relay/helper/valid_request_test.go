package helper

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	relayconstant "github.com/QuantumNous/new-api/relay/constant"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGetAndValidateTextRequestRejectsHugeMaxCompletionTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_completion_tokens":1073741824}`

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")

	_, err := GetAndValidateTextRequest(c, relayconstant.RelayModeChatCompletions)
	require.Error(t, err)
	require.Contains(t, err.Error(), "max_completion_tokens is invalid")
}
