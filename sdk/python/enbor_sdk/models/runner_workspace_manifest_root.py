from enum import Enum

class RunnerWorkspaceManifestRoot(str, Enum):
    VALUE_0 = "/workspace"

    def __str__(self) -> str:
        return str(self.value)
