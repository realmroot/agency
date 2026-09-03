package version

type Info struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"buildDate"`
}

func Default() Info {
	return Info{
		Name:      "enbor-runner",
		Version:   "dev",
		Commit:    "unknown",
		BuildDate: "unknown",
	}
}

func (info Info) Normalized() Info {
	defaults := Default()
	if info.Name == "" {
		info.Name = defaults.Name
	}
	if info.Version == "" {
		info.Version = defaults.Version
	}
	if info.Commit == "" {
		info.Commit = defaults.Commit
	}
	if info.BuildDate == "" {
		info.BuildDate = defaults.BuildDate
	}
	return info
}
