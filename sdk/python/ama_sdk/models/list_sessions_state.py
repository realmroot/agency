from enum import Enum

class ListSessionsState(str, Enum):
    CLOSED = "closed"
    ERROR = "error"
    IDLE = "idle"
    PENDING = "pending"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
