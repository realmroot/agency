from enum import Enum

class AmaEventType8Type(str, Enum):
    PERMISSION_REQUESTED = "permission.requested"

    def __str__(self) -> str:
        return str(self.value)
