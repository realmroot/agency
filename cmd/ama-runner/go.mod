module github.com/saltbo/any-managed-agents/cmd/ama-runner

go 1.24.0

require github.com/realmroot/agency/sdk/go v0.0.0

require (
	github.com/coder/websocket v1.8.14
	github.com/go-viper/mapstructure/v2 v2.4.0
	github.com/google/uuid v1.6.0
	github.com/kardianos/service v1.3.0
	github.com/samber/lo v1.53.0
	github.com/spf13/cobra v1.10.2
	github.com/spf13/viper v1.21.0
	golang.org/x/sys v0.39.0
)

require (
	github.com/apapsch/go-jsonmerge/v2 v2.0.0 // indirect
	github.com/fsnotify/fsnotify v1.9.0 // indirect
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/oapi-codegen/runtime v1.4.1 // indirect
	github.com/pelletier/go-toml/v2 v2.2.4 // indirect
	github.com/sagikazarmark/locafero v0.11.0 // indirect
	github.com/sourcegraph/conc v0.3.1-0.20240121214520-5f936abd7ae8 // indirect
	github.com/spf13/afero v1.15.0 // indirect
	github.com/spf13/cast v1.10.0 // indirect
	github.com/spf13/pflag v1.0.10 // indirect
	github.com/subosito/gotenv v1.6.0 // indirect
	go.yaml.in/yaml/v3 v3.0.4 // indirect
	golang.org/x/text v0.32.0 // indirect
)

replace github.com/realmroot/agency/sdk/go => ../../sdk/go
