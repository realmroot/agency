//go:build darwin

package managed

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// [spec: runners/local-instances]
func TestUpdateLaunchAgentPlistEditsLoginStartupKeys(t *testing.T) {
	realPlutil, err := exec.LookPath("plutil")
	if err != nil {
		t.Fatal(err)
	}
	plistPath := filepath.Join(t.TempDir(), "ama-runner-test.plist")
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>ama-runner-test</string>
<key>RunAtLoad</key><false/>
<key>KeepAlive</key><false/>
</dict></plist>`
	if err := os.WriteFile(plistPath, []byte(plist), 0o600); err != nil {
		t.Fatal(err)
	}

	for _, enabled := range []bool{true, false} {
		rollback, err := updateLaunchAgentPlist(plistPath, enabled)
		if err != nil {
			t.Fatal(err)
		}
		if rollback == nil {
			t.Fatal("plist update did not return a rollback")
		}
		for _, key := range []string{"RunAtLoad", "KeepAlive"} {
			output, err := exec.Command(realPlutil, "-extract", key, "raw", "-o", "-", plistPath).CombinedOutput()
			if err != nil {
				t.Fatalf("read %s: %v: %s", key, err, output)
			}
			if strings.TrimSpace(string(output)) != strconv.FormatBool(enabled) {
				t.Fatalf("unexpected %s value: %s", key, output)
			}
		}
	}
}

func TestUpdateServiceStartAtLoginRejectsMissingLaunchAgent(t *testing.T) {
	randomSuffix := make([]byte, 12)
	if _, err := rand.Read(randomSuffix); err != nil {
		t.Fatal(err)
	}
	serviceName := "ama-runner-test-missing-" + hex.EncodeToString(randomSuffix)
	homeDir, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	plistPath := filepath.Join(homeDir, "Library", "LaunchAgents", serviceName+".plist")
	if _, err := os.Stat(plistPath); !os.IsNotExist(err) {
		t.Fatalf("test service path unexpectedly exists: %s: %v", plistPath, err)
	}

	_, err = updateServiceStartAtLogin(serviceName, true)
	if err == nil || !strings.Contains(err.Error(), "RunAtLoad") {
		t.Fatalf("missing LaunchAgent must fail at RunAtLoad, got %v", err)
	}
	if _, err := os.Stat(plistPath); !os.IsNotExist(err) {
		t.Fatalf("failed update created or changed the missing LaunchAgent: %s: %v", plistPath, err)
	}
}

func TestDarwinLoginStartupNoOps(t *testing.T) {
	if err := syncServiceStartAtLogin("ama-runner-test", true); err != nil {
		t.Fatal(err)
	}
	if err := startServiceNow("ama-runner-test", true); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateLaunchAgentPlistRollbackRestoresDriftedNativePolicy(t *testing.T) {
	realPlutil, err := exec.LookPath("plutil")
	if err != nil {
		t.Fatal(err)
	}
	plistPath := writeLaunchAgentPlist(t, true, false)

	rollback, err := updateLaunchAgentPlist(plistPath, false)
	if err != nil {
		t.Fatal(err)
	}
	if mustReadPlistBool(t, realPlutil, plistPath, "RunAtLoad") || mustReadPlistBool(t, realPlutil, plistPath, "KeepAlive") {
		t.Fatal("desired policy was not applied")
	}
	if err := rollback(); err != nil {
		t.Fatal(err)
	}
	if !mustReadPlistBool(t, realPlutil, plistPath, "RunAtLoad") || mustReadPlistBool(t, realPlutil, plistPath, "KeepAlive") {
		t.Fatal("rollback did not restore the drifted native baseline")
	}
}

func TestUpdateLaunchAgentPlistRestoresNativePolicyWhenKeepAliveUpdateFails(t *testing.T) {
	realPlutil, err := exec.LookPath("plutil")
	if err != nil {
		t.Fatal(err)
	}
	plistPath := writeLaunchAgentPlist(t, true, false)
	t.Setenv("PATH", installFailingPlutil(t, realPlutil, false))

	rollback, err := updateLaunchAgentPlist(plistPath, false)
	if rollback != nil || err == nil || !strings.Contains(err.Error(), "forced KeepAlive failure") {
		t.Fatalf("expected KeepAlive update failure without rollback, hasRollback=%t err=%v", rollback != nil, err)
	}
	if !mustReadPlistBool(t, realPlutil, plistPath, "RunAtLoad") || mustReadPlistBool(t, realPlutil, plistPath, "KeepAlive") {
		t.Fatal("failed second update did not restore the real native baseline")
	}
}

func TestUpdateLaunchAgentPlistReportsInternalRollbackFailure(t *testing.T) {
	realPlutil, err := exec.LookPath("plutil")
	if err != nil {
		t.Fatal(err)
	}
	plistPath := writeLaunchAgentPlist(t, true, false)
	t.Setenv("PATH", installFailingPlutil(t, realPlutil, true))

	rollback, err := updateLaunchAgentPlist(plistPath, false)
	if rollback != nil || err == nil || !strings.Contains(err.Error(), "forced KeepAlive failure") || !strings.Contains(err.Error(), "rollback login startup failed") || !strings.Contains(err.Error(), "forced rollback failure") {
		t.Fatalf("expected original and rollback failures, got %v", err)
	}
}

func installFailingPlutil(t *testing.T, realPlutil string, failRollback bool) string {
	t.Helper()
	binDir := t.TempDir()
	keepAliveFailureMarker := filepath.Join(binDir, "keep-alive-failed")
	script := `#!/bin/sh
if [ "$1" = "-replace" ] && [ "$2" = "KeepAlive" ] && [ ! -e ` + shellQuote(keepAliveFailureMarker) + ` ]; then
  : > ` + shellQuote(keepAliveFailureMarker) + `
  echo "forced KeepAlive failure" >&2
  exit 42
fi
`
	if failRollback {
		script += `if [ "$1" = "-replace" ] && [ "$2" = "RunAtLoad" ] && [ -e ` + shellQuote(keepAliveFailureMarker) + ` ]; then
  echo "forced rollback failure" >&2
  exit 43
fi
`
	}
	script += "exec " + shellQuote(realPlutil) + " \"$@\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "plutil"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return binDir
}

func writeLaunchAgentPlist(t *testing.T, runAtLoad bool, keepAlive bool) string {
	t.Helper()
	plistPath := filepath.Join(t.TempDir(), "ama-runner-test.plist")
	plist := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>ama-runner-test</string>
<key>RunAtLoad</key><` + plistBoolElement(runAtLoad) + `/>
<key>KeepAlive</key><` + plistBoolElement(keepAlive) + `/>
</dict></plist>`
	if err := os.WriteFile(plistPath, []byte(plist), 0o600); err != nil {
		t.Fatal(err)
	}
	return plistPath
}

func mustReadPlistBool(t *testing.T, realPlutil string, plistPath string, key string) bool {
	t.Helper()
	output, err := exec.Command(realPlutil, "-extract", key, "raw", "-o", "-", plistPath).CombinedOutput()
	if err != nil {
		t.Fatalf("read %s: %v: %s", key, err, output)
	}
	value, err := strconv.ParseBool(strings.TrimSpace(string(output)))
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func plistBoolElement(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
