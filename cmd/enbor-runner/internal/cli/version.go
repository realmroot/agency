package cli

import (
	"encoding/json"
	"fmt"
	"io"

	"github.com/realmroot/enbor/cmd/enbor-runner/pkg/version"
)

func RunVersion(info version.Info, stdout io.Writer, jsonOutput bool) error {
	if jsonOutput {
		encoder := json.NewEncoder(stdout)
		return encoder.Encode(info)
	}
	_, err := fmt.Fprintf(stdout, "%s %s (%s, built %s)\n", info.Name, info.Version, info.Commit, info.BuildDate)
	return err
}
