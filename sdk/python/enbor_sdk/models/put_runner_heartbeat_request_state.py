from enum import Enum

class PutRunnerHeartbeatRequestState(str, Enum):
    ACTIVE = "active"
    DRAINING = "draining"
    OFFLINE = "offline"

    def __str__(self) -> str:
        return str(self.value)
