from enum import Enum

class RunnerVolumeType(str, Enum):
    EMPTY_DIR = "empty_dir"
    GIT_REPOSITORY = "git_repository"
    MEMORY = "memory"
    SECRET = "secret"

    def __str__(self) -> str:
        return str(self.value)
