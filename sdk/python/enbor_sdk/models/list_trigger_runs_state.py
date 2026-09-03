from enum import Enum

class ListTriggerRunsState(str, Enum):
    CLAIMED = "claimed"
    DISPATCHED = "dispatched"
    DISPATCHING = "dispatching"
    FAILED = "failed"
    QUEUED = "queued"

    def __str__(self) -> str:
        return str(self.value)
