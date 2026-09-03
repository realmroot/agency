from enum import Enum

class SessionMessageDelivery(str, Enum):
    LIVE = "live"
    QUEUED = "queued"

    def __str__(self) -> str:
        return str(self.value)
