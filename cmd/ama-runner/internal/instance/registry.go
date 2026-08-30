package instance

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	runnerconfig "github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/config"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/lockfile"
	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/securefile"
)

const schemaVersion = 2

const registryLockFileName = "registry.lock"

var ErrNotFound = errors.New("runner instance not found")

type Record struct {
	Version        int                 `json:"version"`
	ID             string              `json:"id"`
	Config         runnerconfig.Config `json:"config"`
	CredentialPath string              `json:"credentialPath"`
	AccountID      string              `json:"accountId"`
	CreatedAt      time.Time           `json:"createdAt"`
	UpdatedAt      time.Time           `json:"updatedAt"`
}

type Registry struct {
	Dir string
}

func DefaultRegistry() Registry {
	return Registry{Dir: runnerconfig.DefaultInstanceConfigDir()}
}

func NewRecord(config runnerconfig.Config) (Record, error) {
	id, err := runnerconfig.InstanceID(config.APIServer, config.EnvironmentID)
	if err != nil {
		return Record{}, err
	}
	if err := validateManagedConfig(config); err != nil {
		return Record{}, err
	}
	if strings.TrimSpace(config.CredentialAccountID) == "" {
		return Record{}, fmt.Errorf("runner account id is required")
	}
	now := time.Now().UTC()
	credentialPath := config.CredentialPath
	accountID := config.CredentialAccountID
	config.ConfigPath = ""
	config.CredentialPath = ""
	config.CredentialAccountID = ""
	return Record{
		Version:        schemaVersion,
		ID:             id,
		Config:         config,
		CredentialPath: credentialPath,
		AccountID:      accountID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}, nil
}

func (r Registry) Create(record Record) error {
	return r.withLock(func() error {
		if _, err := r.get(record.ID); err == nil {
			return fmt.Errorf("runner instance %s already exists", record.ID)
		} else if !errors.Is(err, ErrNotFound) {
			return err
		}
		return r.write(record)
	})
}

func (r Registry) Put(record Record) error {
	return r.withLock(func() error {
		current, err := r.get(record.ID)
		if err != nil {
			return err
		}
		record.Version = schemaVersion
		record.CreatedAt = current.CreatedAt
		record.UpdatedAt = time.Now().UTC()
		return r.write(record)
	})
}

func (r Registry) Get(id string) (Record, error) {
	if _, err := r.path(id); err != nil {
		return Record{}, err
	}
	if _, err := os.Stat(r.Dir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Record{}, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return Record{}, err
	}
	var record Record
	err := r.withLock(func() error {
		var err error
		record, err = r.get(id)
		return err
	})
	return record, err
}

func (r Registry) get(id string) (Record, error) {
	path, err := r.path(id)
	if err != nil {
		return Record{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Record{}, fmt.Errorf("%w: %s", ErrNotFound, id)
		}
		return Record{}, err
	}
	var record Record
	if err := json.Unmarshal(data, &record); err != nil {
		return Record{}, fmt.Errorf("read runner instance %s: %w", id, err)
	}
	if err := validateRecord(record); err != nil {
		return Record{}, fmt.Errorf("read runner instance %s: %w", id, err)
	}
	return record, nil
}

func (r Registry) List() ([]Record, error) {
	if _, err := os.Stat(r.Dir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Record{}, nil
		}
		return nil, err
	}
	records := []Record{}
	err := r.withLock(func() error {
		entries, err := os.ReadDir(r.Dir)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		records = make([]Record, 0, len(entries))
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".json")
			record, err := r.get(id)
			if err != nil {
				return err
			}
			records = append(records, record)
		}
		sort.Slice(records, func(left, right int) bool { return records[left].ID < records[right].ID })
		return nil
	})
	return records, err
}

func (r Registry) Remove(id string) error {
	return r.withLock(func() error {
		path, err := r.path(id)
		if err != nil {
			return err
		}
		if err := os.Remove(path); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("%w: %s", ErrNotFound, id)
			}
			return err
		}
		return nil
	})
}

func (record Record) RuntimeConfig() runnerconfig.Config {
	config := record.Config
	config.ConfigPath = ""
	config.CredentialPath = record.CredentialPath
	config.CredentialAccountID = record.AccountID
	return config
}

func (r Registry) write(record Record) error {
	if err := validateRecord(record); err != nil {
		return err
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return securefile.Write(filepath.Join(r.Dir, record.ID+".json"), append(data, '\n'))
}

func (r Registry) path(id string) (string, error) {
	id = strings.TrimSpace(id)
	if id == "" || filepath.Base(id) != id || !strings.HasPrefix(id, "runner_") {
		return "", fmt.Errorf("invalid runner instance id %q", id)
	}
	if strings.TrimSpace(r.Dir) == "" {
		return "", fmt.Errorf("runner instance registry directory is required")
	}
	return filepath.Join(r.Dir, id+".json"), nil
}

func (r Registry) withLock(action func() error) error {
	if strings.TrimSpace(r.Dir) == "" {
		return fmt.Errorf("runner instance registry directory is required")
	}
	return lockfile.With(filepath.Join(r.Dir, registryLockFileName), action)
}

func validateRecord(record Record) error {
	if record.Version != schemaVersion {
		return fmt.Errorf("unsupported runner instance version %d", record.Version)
	}
	expectedID, err := runnerconfig.InstanceID(record.Config.APIServer, record.Config.EnvironmentID)
	if err != nil {
		return err
	}
	if record.ID != expectedID {
		return fmt.Errorf("runner instance id does not match API server and environment")
	}
	if err := validateManagedConfig(record.Config); err != nil {
		return err
	}
	if strings.TrimSpace(record.CredentialPath) == "" {
		return fmt.Errorf("runner credential path is required")
	}
	if strings.TrimSpace(record.AccountID) == "" {
		return fmt.Errorf("runner account id is required")
	}
	return nil
}

func validateManagedConfig(config runnerconfig.Config) error {
	if err := config.Validate(); err != nil {
		return err
	}
	expectedStateDir, err := runnerconfig.DefaultStateDirForInstance(config.APIServer, config.EnvironmentID)
	if err != nil {
		return err
	}
	if config.StateDir != expectedStateDir || config.WorkDir != runnerconfig.DefaultWorkDirForStateDir(expectedStateDir) {
		return fmt.Errorf("managed runner storage must use the default API server and environment paths")
	}
	return nil
}
