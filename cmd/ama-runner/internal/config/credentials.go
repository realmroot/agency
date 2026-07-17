package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/securefile"
)

type CredentialProfile struct {
	AccountID    string `json:"accountId" mapstructure:"accountId"`
	APIServer    string `json:"apiServer" mapstructure:"apiServer"`
	Email        string `json:"email,omitempty" mapstructure:"email"`
	Name         string `json:"name,omitempty" mapstructure:"name"`
	AccessToken  string `json:"accessToken" mapstructure:"accessToken"`
	RefreshToken string `json:"refreshToken,omitempty" mapstructure:"refreshToken"`
	TokenType    string `json:"tokenType" mapstructure:"tokenType"`
	ExpiresAt    string `json:"expiresAt,omitempty" mapstructure:"expiresAt"`
	Scope        string `json:"scope,omitempty" mapstructure:"scope"`
}

type CredentialStore struct {
	Active   string              `json:"active,omitempty" mapstructure:"active"`
	Profiles []CredentialProfile `json:"profiles,omitempty" mapstructure:"profiles"`
}

func SaveCredentialProfile(path string, profile CredentialProfile) error {
	return withCredentialStoreLock(path, func() error {
		return saveCredentialProfileUnlocked(path, profile)
	})
}

func saveCredentialProfileUnlocked(path string, profile CredentialProfile) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("runner credential path is required")
	}
	if strings.TrimSpace(profile.AccessToken) == "" {
		return fmt.Errorf("runner access token is required")
	}
	if strings.TrimSpace(profile.AccountID) == "" {
		return fmt.Errorf("runner account id is required")
	}
	values, err := loadRawCredentialFile(path)
	if err != nil {
		return err
	}
	profile.APIServer = strings.TrimRight(profile.APIServer, "/")
	profile.AccountID = strings.TrimSpace(profile.AccountID)
	profile.Email = strings.TrimSpace(profile.Email)
	profile.Name = strings.TrimSpace(profile.Name)
	store := values
	store.Active = profileKey(profile.APIServer, profile.AccountID)
	store.Profiles = upsertCredentialProfile(store.Profiles, profile)
	return saveRawCredentialFile(path, store)
}

func LogoutCredentialProfile(path string, apiServer string) error {
	return withCredentialStoreLock(path, func() error {
		store, err := loadRawCredentialFile(path)
		if err != nil {
			return err
		}
		if strings.TrimSpace(apiServer) == "" {
			active, ok := findCredentialProfileByKey(store.Profiles, store.Active)
			if !ok {
				return nil
			}
			apiServer = active.APIServer
		}
		apiServer = strings.TrimRight(apiServer, "/")
		if apiServer == "" {
			return nil
		}
		store.Profiles = deleteCredentialProfilesForAPIServer(store.Profiles, apiServer)
		if active, ok := findCredentialProfileByKey(store.Profiles, store.Active); !ok || active.APIServer == apiServer {
			store.Active = ""
			if len(store.Profiles) > 0 {
				store.Active = profileKey(store.Profiles[0].APIServer, store.Profiles[0].AccountID)
			}
		}
		return saveRawCredentialFile(path, store)
	})
}

func SwitchCredentialProfile(path string, apiServer string, account string) (CredentialProfile, error) {
	var switched CredentialProfile
	err := withCredentialStoreLock(path, func() error {
		profile, err := switchCredentialProfileUnlocked(path, apiServer, account)
		if err != nil {
			return err
		}
		switched = profile
		return nil
	})
	return switched, err
}

func switchCredentialProfileUnlocked(path string, apiServer string, account string) (CredentialProfile, error) {
	store, err := loadRawCredentialFile(path)
	if err != nil {
		return CredentialProfile{}, err
	}
	apiServer = strings.TrimRight(apiServer, "/")
	profile, err := selectCredentialProfile(store, apiServer, account)
	if err != nil {
		return CredentialProfile{}, err
	}
	store.Active = profileKey(profile.APIServer, profile.AccountID)
	if err := saveRawCredentialFile(path, store); err != nil {
		return CredentialProfile{}, err
	}
	return profile, nil
}

func LoadCredentialStore(path string) (CredentialStore, error) {
	if strings.TrimSpace(path) == "" {
		return CredentialStore{}, nil
	}
	var store CredentialStore
	err := withCredentialStoreLock(path, func() error {
		loaded, err := loadCredentialStoreUnlocked(path)
		if err != nil {
			return err
		}
		store = loaded
		return nil
	})
	return store, err
}

func loadCredentialStoreUnlocked(path string) (CredentialStore, error) {
	store, err := loadRawCredentialFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CredentialStore{}, nil
		}
		return CredentialStore{}, err
	}
	if strings.TrimSpace(store.Active) == "" && len(store.Profiles) == 0 {
		return CredentialStore{}, nil
	}
	return store, nil
}

func LoadActiveCredentialProfile(path string) (*CredentialProfile, error) {
	if strings.TrimSpace(path) == "" {
		return nil, nil
	}
	var profile *CredentialProfile
	err := withCredentialStoreLock(path, func() error {
		loaded, err := loadActiveCredentialProfileUnlocked(path)
		if err != nil {
			return err
		}
		profile = loaded
		return nil
	})
	return profile, err
}

func loadActiveCredentialProfileUnlocked(path string) (*CredentialProfile, error) {
	store, err := loadCredentialStoreUnlocked(path)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(store.Active) == "" {
		return nil, nil
	}
	return credentialProfileByKey(store, store.Active)
}

func LoadCredentialProfile(path string, apiServer string) (*CredentialProfile, error) {
	if strings.TrimSpace(apiServer) == "" {
		return LoadActiveCredentialProfile(path)
	}
	var profile *CredentialProfile
	err := withCredentialStoreLock(path, func() error {
		loaded, err := loadCredentialProfileUnlocked(path, apiServer)
		if err != nil {
			return err
		}
		profile = loaded
		return nil
	})
	return profile, err
}

func loadCredentialProfileUnlocked(path string, apiServer string) (*CredentialProfile, error) {
	if strings.TrimSpace(apiServer) == "" {
		return loadActiveCredentialProfileUnlocked(path)
	}
	store, err := loadCredentialStoreUnlocked(path)
	if err != nil {
		return nil, err
	}
	if active, ok := findCredentialProfileByKey(store.Profiles, store.Active); ok && strings.TrimRight(active.APIServer, "/") == strings.TrimRight(apiServer, "/") {
		return credentialProfileByKey(store, store.Active)
	}
	profiles := profilesForAPIServer(store.Profiles, apiServer)
	if len(profiles) == 0 {
		return nil, nil
	}
	if len(profiles) > 1 {
		return nil, fmt.Errorf("multiple saved accounts for %s; run ama-runner auth switch <account> --api-server %s", strings.TrimRight(apiServer, "/"), strings.TrimRight(apiServer, "/"))
	}
	return validateCredentialProfile(profiles[0])
}

func UpdateCredentialProfile(
	path string,
	apiServer string,
	update func(CredentialProfile) (CredentialProfile, bool, error),
) (CredentialProfile, error) {
	var updated CredentialProfile
	if update == nil {
		return CredentialProfile{}, fmt.Errorf("credential profile update function is required")
	}
	err := withCredentialStoreLock(path, func() error {
		profile, err := loadCredentialProfileUnlocked(path, apiServer)
		if err != nil {
			return err
		}
		if profile == nil {
			if strings.TrimSpace(apiServer) == "" {
				return fmt.Errorf("no saved auth profiles")
			}
			return fmt.Errorf("no saved auth profile for %s", strings.TrimRight(apiServer, "/"))
		}
		next, shouldSave, err := update(*profile)
		if err != nil {
			return err
		}
		if shouldSave {
			if err := saveCredentialProfileUnlocked(path, next); err != nil {
				return err
			}
		}
		updated = next
		return nil
	})
	return updated, err
}

func credentialProfileByKey(store CredentialStore, key string) (*CredentialProfile, error) {
	profile, ok := findCredentialProfileByKey(store.Profiles, key)
	if !ok {
		return nil, nil
	}
	return validateCredentialProfile(profile)
}

func validateCredentialProfile(profile CredentialProfile) (*CredentialProfile, error) {
	if profile.ExpiresAt != "" {
		expiresAt, err := time.Parse(time.RFC3339, profile.ExpiresAt)
		if err != nil {
			return nil, err
		}
		if !expiresAt.After(time.Now()) && strings.TrimSpace(profile.RefreshToken) == "" {
			return nil, fmt.Errorf("saved AMA runner token is expired; run ama-runner auth login again")
		}
	}
	return &profile, nil
}

func upsertCredentialProfile(profiles []CredentialProfile, profile CredentialProfile) []CredentialProfile {
	key := profileKey(profile.APIServer, profile.AccountID)
	for index, current := range profiles {
		if profileKey(current.APIServer, current.AccountID) == key {
			profiles[index] = profile
			return profiles
		}
	}
	return append(profiles, profile)
}

func deleteCredentialProfilesForAPIServer(profiles []CredentialProfile, apiServer string) []CredentialProfile {
	next := profiles[:0]
	for _, profile := range profiles {
		if strings.TrimRight(profile.APIServer, "/") != apiServer {
			next = append(next, profile)
		}
	}
	return next
}

func findCredentialProfileByKey(profiles []CredentialProfile, key string) (CredentialProfile, bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		return CredentialProfile{}, false
	}
	for _, profile := range profiles {
		if profileKey(profile.APIServer, profile.AccountID) == key {
			return profile, true
		}
	}
	return CredentialProfile{}, false
}

func profilesForAPIServer(profiles []CredentialProfile, apiServer string) []CredentialProfile {
	apiServer = strings.TrimRight(apiServer, "/")
	matches := []CredentialProfile{}
	for _, profile := range profiles {
		if strings.TrimRight(profile.APIServer, "/") == apiServer {
			matches = append(matches, profile)
		}
	}
	return matches
}

func selectCredentialProfile(store CredentialStore, apiServer string, account string) (CredentialProfile, error) {
	account = strings.TrimSpace(account)
	if apiServer == "" {
		if active, ok := findCredentialProfileByKey(store.Profiles, store.Active); ok {
			apiServer = active.APIServer
		}
	}
	candidates := store.Profiles
	if apiServer != "" {
		candidates = profilesForAPIServer(candidates, apiServer)
	}
	if len(candidates) == 0 {
		if apiServer != "" {
			return CredentialProfile{}, fmt.Errorf("no saved auth profile for %s", apiServer)
		}
		return CredentialProfile{}, fmt.Errorf("no saved auth profiles")
	}
	if account != "" {
		for _, profile := range candidates {
			if accountMatches(profile, account) {
				return profile, nil
			}
		}
		return CredentialProfile{}, fmt.Errorf("no saved auth account %q", account)
	}
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	return CredentialProfile{}, fmt.Errorf("multiple saved accounts for %s; specify an account", strings.TrimRight(candidates[0].APIServer, "/"))
}

func accountMatches(profile CredentialProfile, value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && (profile.AccountID == value || profile.Email == value || profile.Name == value)
}

func profileKey(apiServer string, accountID string) string {
	return strings.TrimRight(apiServer, "/") + "#" + strings.TrimSpace(accountID)
}

func loadRawCredentialFile(path string) (CredentialStore, error) {
	if strings.TrimSpace(path) == "" {
		return CredentialStore{}, fmt.Errorf("runner credential path is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return CredentialStore{}, nil
		}
		return CredentialStore{}, err
	}
	var store CredentialStore
	if err := json.Unmarshal(data, &store); err != nil {
		return CredentialStore{}, err
	}
	return store, nil
}

func saveRawCredentialFile(path string, store CredentialStore) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("runner credential path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(store, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return securefile.Write(path, data)
}
