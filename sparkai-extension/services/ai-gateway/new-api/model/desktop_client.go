package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const desktopClientEventAuditContent = "Desktop client event"

// RecordDesktopClientEvent stores only the normalized, privacy-minimized
// metadata accepted by the desktop client event controller. Prompts, image
// paths, project names, raw errors, device identifiers, and arbitrary payloads
// are deliberately outside this contract.
func RecordDesktopClientEvent(userID int, requestID string, details map[string]interface{}) error {
	if LOG_DB == nil {
		return errors.New("log database is not initialized")
	}
	if userID <= 0 {
		return errors.New("desktop client event requires an authenticated user")
	}
	username, _ := GetUsernameById(userID, false)
	content := desktopClientEventAuditContent
	event, eventOK := details["event"].(string)
	component, componentOK := details["component"].(string)
	appVersion, versionOK := details["app_version"].(string)
	if eventOK && componentOK && versionOK {
		content = fmt.Sprintf("Desktop client %s · %s · v%s", event, component, appVersion)
		if errorCode, ok := details["error_code"].(string); ok && errorCode != "" {
			content += " · " + errorCode
		}
		if count, ok := details["count"].(int); ok && count > 1 {
			content += fmt.Sprintf(" ×%d", count)
		}
	}
	return LOG_DB.Create(&Log{
		UserId:    userID,
		Username:  username,
		CreatedAt: time.Now().Unix(),
		Type:      LogTypeSystem,
		Content:   content,
		RequestId: strings.TrimSpace(requestID),
		Other: common.MapToJsonStr(map[string]interface{}{
			"op": buildOpField("desktop_client.event", details),
		}),
	}).Error
}
