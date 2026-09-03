from enum import Enum

class ListRunnersState(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    DRAINING = "draining"
    OFFLINE = "offline"

    def __str__(self) -> str:
        return str(self.value)
