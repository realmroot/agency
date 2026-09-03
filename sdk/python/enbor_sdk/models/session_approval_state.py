from enum import Enum

class SessionApprovalState(str, Enum):
    APPROVED = "approved"
    DENIED = "denied"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
