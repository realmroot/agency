from enum import Enum

class ResourcePhase(str, Enum):
    ACTIVE = "active"

    def __str__(self) -> str:
        return str(self.value)
