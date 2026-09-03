from enum import Enum

class ListLeasesState(str, Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    EXPIRED = "expired"
    FAILED = "failed"

    def __str__(self) -> str:
        return str(self.value)
