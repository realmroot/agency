from enum import Enum

class EventToolCallType4Name(str, Enum):
    GREP = "grep"

    def __str__(self) -> str:
        return str(self.value)
