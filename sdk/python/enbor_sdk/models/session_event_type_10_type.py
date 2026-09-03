from enum import Enum

class SessionEventType10Type(str, Enum):
    PERMISSION_DENIED = "permission.denied"

    def __str__(self) -> str:
        return str(self.value)
