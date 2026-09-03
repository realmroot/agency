from enum import Enum

class EnborEventType9Type(str, Enum):
    PERMISSION_RESOLVED = "permission.resolved"

    def __str__(self) -> str:
        return str(self.value)
