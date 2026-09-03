from enum import Enum

class EventToolCallType5Name(str, Enum):
    FIND = "find"

    def __str__(self) -> str:
        return str(self.value)
