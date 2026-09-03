from enum import Enum

class ListWorkItemsState(str, Enum):
    AVAILABLE = "available"
    CANCELLED = "cancelled"
    FAILED = "failed"
    LEASED = "leased"
    SUCCEEDED = "succeeded"

    def __str__(self) -> str:
        return str(self.value)
