package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/saltbo/any-managed-agents/cmd/ama-runner/internal/sys/securefile"
	"time"

	"github.com/spf13/viper"
)

type LocalValueKind string

const (
	LocalString   LocalValueKind = "string"
	LocalBool     LocalValueKind = "bool"
	LocalInt      LocalValueKind = "int"
	LocalDuration LocalValueKind = "duration"
)

var localConfigKeys = map[string]LocalValueKind{
	"apiServer":          LocalString,
	"projectId":          LocalString,
	"environmentId":      LocalString,
	"allowUnsafeProcess": LocalBool,
	"stateDir":           LocalString,
	"workDir":            LocalString,
	"maxConcurrent":      LocalInt,
}

func LocalConfigKeys() []string {
	keys := make([]string, 0, len(localConfigKeys))
	for key := range localConfigKeys {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func LoadLocalConfig(path string) (map[string]any, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("runner config path is required")
	}
	values := viper.New()
	values.SetConfigFile(path)
	if err := values.ReadInConfig(); err != nil {
		var notFound viper.ConfigFileNotFoundError
		if !errors.As(err, &notFound) && !os.IsNotExist(err) {
			return nil, err
		}
		return map[string]any{}, nil
	}
	config := map[string]any{}
	for _, key := range LocalConfigKeys() {
		if values.IsSet(key) {
			config[key] = values.Get(key)
		}
	}
	return config, nil
}

func loadWritableLocalConfig(path string) (map[string]any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var values map[string]any
	if err := json.Unmarshal(data, &values); err != nil {
		return nil, err
	}
	return filterLocalConfig(values), nil
}

func SaveLocalConfigValue(path string, key string, value string) error {
	parsed, err := parseLocalConfigValue(key, value)
	if err != nil {
		return err
	}
	values, err := loadWritableLocalConfig(path)
	if err != nil {
		return err
	}
	values[key] = parsed
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(values, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return securefile.Write(path, data)
}

func filterLocalConfig(values map[string]any) map[string]any {
	filtered := map[string]any{}
	for key, value := range values {
		if _, ok := localConfigKeys[key]; ok {
			filtered[key] = value
		}
	}
	return filtered
}

func parseLocalConfigValue(key string, value string) (any, error) {
	kind, ok := localConfigKeys[key]
	if !ok {
		return nil, fmt.Errorf("unsupported config key %q", key)
	}
	switch kind {
	case LocalString:
		return value, nil
	case LocalBool:
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return nil, fmt.Errorf("%s must be a boolean", key)
		}
		return parsed, nil
	case LocalInt:
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return nil, fmt.Errorf("%s must be an integer", key)
		}
		return parsed, nil
	case LocalDuration:
		if _, err := time.ParseDuration(value); err != nil {
			return nil, fmt.Errorf("%s must be a duration", key)
		}
		return value, nil
	default:
		return nil, fmt.Errorf("unsupported config key %q", key)
	}
}
