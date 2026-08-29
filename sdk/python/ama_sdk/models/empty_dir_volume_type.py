from enum import Enum

class EmptyDirVolumeType(str, Enum):
    EMPTY_DIR = "empty_dir"

    def __str__(self) -> str:
        return str(self.value)
