package daemon

import (
	"net/http"

	ama "github.com/realmroot/enbor/sdk/go/enbor"
)

func IsClaimRaceError(err error) bool {
	status, ok := ama.StatusCode(err)
	return ok && (status == http.StatusConflict || status == http.StatusNotFound)
}

func IsRunnerGoneError(err error) bool {
	status, ok := ama.StatusCode(err)
	return ok && status == http.StatusNotFound
}

func workItemSessionID(workItem *ama.WorkItem) string {
	if workItem == nil || workItem.SessionId == nil {
		return ""
	}
	return *workItem.SessionId
}
