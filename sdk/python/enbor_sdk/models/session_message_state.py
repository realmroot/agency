from enum import Enum

class SessionMessageState(str, Enum):
    ACCEPTED = "accepted"
    DELIVERED = "delivered"
    FAILED = "failed"

    def __str__(self) -> str:
        return str(self.value)
