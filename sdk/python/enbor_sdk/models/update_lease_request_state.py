from enum import Enum

class UpdateLeaseRequestState(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"

    def __str__(self) -> str:
        return str(self.value)
