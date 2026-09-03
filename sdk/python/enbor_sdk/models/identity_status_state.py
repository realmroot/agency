from enum import Enum

class IdentityStatusState(str, Enum):
    ACTIVE = "active"
    ERROR = "error"
    PROVISIONING = "provisioning"

    def __str__(self) -> str:
        return str(self.value)
