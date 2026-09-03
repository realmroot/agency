//go:build windows

package securefile

import (
	"fmt"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

func restrict(path string, _ *os.File) error {
	user, _, dacl, err := privateDACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION,
		user,
		nil,
		dacl,
		nil,
	)
}

func checkPrivate(path string) error {
	user, system, _, err := privateDACL()
	if err != nil {
		return err
	}
	sd, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		return err
	}
	owner, _, err := sd.Owner()
	if err != nil {
		return err
	}
	if !owner.Equals(user) {
		return fmt.Errorf("private file owner does not match the current user")
	}
	control, _, err := sd.Control()
	if err != nil {
		return err
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		return fmt.Errorf("private file DACL inherits permissions")
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	if dacl.AceCount != 2 {
		return fmt.Errorf("private file DACL has %d entries, want 2", dacl.AceCount)
	}
	seenUser := false
	seenSystem := false
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			return err
		}
		if ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return fmt.Errorf("private file DACL contains a non-allow entry")
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		switch {
		case sid.Equals(user):
			seenUser = true
		case sid.Equals(system):
			seenSystem = true
		default:
			return fmt.Errorf("private file DACL grants access to an unexpected principal")
		}
	}
	if !seenUser || !seenSystem {
		return fmt.Errorf("private file DACL is missing required principals")
	}
	return nil
}

func privateDACL() (*windows.SID, *windows.SID, *windows.ACL, error) {
	userInfo, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, nil, nil, err
	}
	user := userInfo.User.Sid
	system, err := windows.CreateWellKnownSid(windows.WinLocalSystemSid)
	if err != nil {
		return nil, nil, nil, err
	}
	sd, err := windows.SecurityDescriptorFromString(fmt.Sprintf(
		"O:%sD:P(A;;GA;;;%s)(A;;GA;;;SY)",
		user.String(),
		user.String(),
	))
	if err != nil {
		return nil, nil, nil, err
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		return nil, nil, nil, err
	}
	return user, system, dacl, nil
}
