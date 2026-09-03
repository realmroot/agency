from enum import Enum

class SessionEventType7Type(str, Enum):
    USAGE_RECORDED = "usage.recorded"

    def __str__(self) -> str:
        return str(self.value)
