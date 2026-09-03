from enum import Enum

class UpdateRunnerRequestState(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"
    DRAINING = "draining"

    def __str__(self) -> str:
        return str(self.value)
