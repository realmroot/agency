//go:build linux

package managed

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSyncServiceStartAtLoginUsesSystemctlEnableAndDisable(t *testing.T) {
	for _, test := range []struct {
		name    string
		enabled bool
		action  string
	}{
		{name: "enable", enabled: true, action: "enable"},
		{name: "disable", enabled: false, action: "disable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := installSystemctlFixture(t, "disabled", "")
			if err := syncServiceStartAtLogin("enbor-runner-test", test.enabled); err != nil {
				t.Fatal(err)
			}
			if calls := fixture.calls(t); calls != "--user "+test.action+" enbor-runner-test.service" {
				t.Fatalf("unexpected systemctl call %q", calls)
			}
			if state := fixture.state(t); state != map[bool]string{true: "enabled", false: "disabled"}[test.enabled] {
				t.Fatalf("unexpected service state %q", state)
			}
		})
	}
}

func TestSyncServiceStartAtLoginReturnsSystemctlFailure(t *testing.T) {
	installSystemctlFixture(t, "disabled", "action-error")
	err := syncServiceStartAtLogin("enbor-runner-test", true)
	if err == nil || !strings.Contains(err.Error(), "systemctl --user enable enbor-runner-test.service") || !strings.Contains(err.Error(), "forced action failure") {
		t.Fatalf("unexpected systemctl failure %v", err)
	}
}

func TestSystemdServiceStartAtLoginStates(t *testing.T) {
	for _, test := range []struct {
		name      string
		state     string
		mode      string
		expected  bool
		errDetail string
	}{
		{name: "enabled", state: "enabled", expected: true},
		{name: "disabled exit one", state: "disabled", expected: false},
		{name: "unexpected state", state: "disabled", mode: "unexpected", errDetail: `unexpected state "masked"`},
		{name: "query error", state: "disabled", mode: "query-error", errDetail: "forced query failure"},
	} {
		t.Run(test.name, func(t *testing.T) {
			installSystemctlFixture(t, test.state, test.mode)
			actual, err := systemdServiceStartAtLogin("enbor-runner-test")
			if test.errDetail != "" {
				if err == nil || !strings.Contains(err.Error(), test.errDetail) {
					t.Fatalf("expected %q failure, got %v", test.errDetail, err)
				}
				return
			}
			if err != nil || actual != test.expected {
				t.Fatalf("unexpected state: actual=%t err=%v", actual, err)
			}
		})
	}
}

func TestUpdateServiceStartAtLoginAppliesAndRollsBackNativeState(t *testing.T) {
	for _, test := range []struct {
		name     string
		previous string
		desired  bool
		calls    string
	}{
		{name: "enable then restore disabled", previous: "disabled", desired: true, calls: "--user is-enabled enbor-runner-test.service\n--user enable enbor-runner-test.service\n--user disable enbor-runner-test.service"},
		{name: "disable then restore enabled", previous: "enabled", desired: false, calls: "--user is-enabled enbor-runner-test.service\n--user disable enbor-runner-test.service\n--user enable enbor-runner-test.service"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := installSystemctlFixture(t, test.previous, "")
			rollback, err := updateServiceStartAtLogin("enbor-runner-test", test.desired)
			if err != nil {
				t.Fatal(err)
			}
			if rollback == nil {
				t.Fatal("native update did not return a rollback")
			}
			expectedDesired := map[bool]string{true: "enabled", false: "disabled"}[test.desired]
			if state := fixture.state(t); state != expectedDesired {
				t.Fatalf("desired state was not applied: %q", state)
			}
			if err := rollback(); err != nil {
				t.Fatal(err)
			}
			if state := fixture.state(t); state != test.previous {
				t.Fatalf("rollback did not restore %q: %q", test.previous, state)
			}
			if calls := fixture.calls(t); calls != test.calls {
				t.Fatalf("unexpected systemctl calls:\n%s", calls)
			}
		})
	}
}

func TestUpdateServiceStartAtLoginReturnsApplyFailure(t *testing.T) {
	installSystemctlFixture(t, "disabled", "action-error")
	rollback, err := updateServiceStartAtLogin("enbor-runner-test", true)
	if rollback != nil || err == nil || !strings.Contains(err.Error(), "forced action failure") {
		t.Fatalf("apply failure returned rollback=%t err=%v", rollback != nil, err)
	}
}

func TestUpdateServiceStartAtLoginReturnsInspectionFailure(t *testing.T) {
	installSystemctlFixture(t, "disabled", "query-error")
	rollback, err := updateServiceStartAtLogin("enbor-runner-test", true)
	if rollback != nil || err == nil || !strings.Contains(err.Error(), "forced query failure") {
		t.Fatalf("inspection failure returned rollback=%t err=%v", rollback != nil, err)
	}
}

func TestLinuxStartServiceNowIsNoOp(t *testing.T) {
	if err := startServiceNow("enbor-runner-test", false); err != nil {
		t.Fatal(err)
	}
}

type systemctlFixture struct {
	statePath string
	callsPath string
}

func installSystemctlFixture(t *testing.T, initialState string, mode string) systemctlFixture {
	t.Helper()
	fixtureDir := t.TempDir()
	statePath := filepath.Join(fixtureDir, "state")
	callsPath := filepath.Join(fixtureDir, "calls")
	if err := os.WriteFile(statePath, []byte(initialState+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$ENBOR_TEST_SYSTEMCTL_CALLS"
action="$2"
if [ "$action" = "is-enabled" ]; then
  if [ "$ENBOR_TEST_SYSTEMCTL_MODE" = "unexpected" ]; then
    printf '%s\n' 'masked'
    exit 0
  fi
  if [ "$ENBOR_TEST_SYSTEMCTL_MODE" = "query-error" ]; then
    printf '%s\n' 'forced query failure' >&2
    exit 7
  fi
  IFS= read -r state < "$ENBOR_TEST_SYSTEMCTL_STATE"
  printf '%s\n' "$state"
  if [ "$state" = "disabled" ]; then exit 1; fi
  exit 0
fi
if [ "$ENBOR_TEST_SYSTEMCTL_MODE" = "action-error" ]; then
  printf '%s\n' 'forced action failure' >&2
  exit 8
fi
if [ "$action" = "enable" ]; then
  printf '%s\n' 'enabled' > "$ENBOR_TEST_SYSTEMCTL_STATE"
else
  printf '%s\n' 'disabled' > "$ENBOR_TEST_SYSTEMCTL_STATE"
fi
`
	if err := os.WriteFile(filepath.Join(fixtureDir, "systemctl"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fixtureDir)
	t.Setenv("ENBOR_TEST_SYSTEMCTL_STATE", statePath)
	t.Setenv("ENBOR_TEST_SYSTEMCTL_CALLS", callsPath)
	t.Setenv("ENBOR_TEST_SYSTEMCTL_MODE", mode)
	return systemctlFixture{statePath: statePath, callsPath: callsPath}
}

func (fixture systemctlFixture) state(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(fixture.statePath)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(data))
}

func (fixture systemctlFixture) calls(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(fixture.callsPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(data))
}
