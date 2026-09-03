from enum import Enum

class EventToolCallType6Name(str, Enum):
    LS = "ls"

    def __str__(self) -> str:
        return str(self.value)
