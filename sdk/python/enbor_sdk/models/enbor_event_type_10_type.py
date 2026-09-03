from enum import Enum

class EnborEventType10Type(str, Enum):
    PERMISSION_DENIED = "permission.denied"

    def __str__(self) -> str:
        return str(self.value)
