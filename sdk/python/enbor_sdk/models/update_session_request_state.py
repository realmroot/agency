from enum import Enum

class UpdateSessionRequestState(str, Enum):
    CLOSED = "closed"
    IDLE = "idle"

    def __str__(self) -> str:
        return str(self.value)
