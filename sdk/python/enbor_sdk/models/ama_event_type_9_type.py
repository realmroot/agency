from enum import Enum

class AmaEventType9Type(str, Enum):
    PERMISSION_RESOLVED = "permission.resolved"

    def __str__(self) -> str:
        return str(self.value)
