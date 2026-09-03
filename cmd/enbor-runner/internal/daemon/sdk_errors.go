package daemon

import (
	"net/http"

	enbor "github.com/realmroot/enbor/sdk/go/enbor"
)

func IsClaimRaceError(err error) bool {
	status, ok := enbor.StatusCode(err)
	return ok && (status == http.StatusConflict || status == http.StatusNotFound)
}

func IsRunnerGoneError(err error) bool {
	status, ok := enbor.StatusCode(err)
	return ok && status == http.StatusNotFound
}

func workItemSessionID(workItem *enbor.WorkItem) string {
	if workItem == nil || workItem.SessionId == nil {
		return ""
	}
	return *workItem.SessionId
}
