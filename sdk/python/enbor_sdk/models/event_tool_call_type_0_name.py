from enum import Enum

class EventToolCallType0Name(str, Enum):
    BASH = "bash"

    def __str__(self) -> str:
        return str(self.value)
