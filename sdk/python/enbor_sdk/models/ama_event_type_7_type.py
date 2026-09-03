from enum import Enum

class AmaEventType7Type(str, Enum):
    USAGE_RECORDED = "usage.recorded"

    def __str__(self) -> str:
        return str(self.value)
