from enum import Enum

class EventToolCallType2Name(str, Enum):
    WRITE = "write"

    def __str__(self) -> str:
        return str(self.value)
