from enum import Enum

class GitRepositoryVolumeType(str, Enum):
    GIT_REPOSITORY = "git_repository"

    def __str__(self) -> str:
        return str(self.value)
