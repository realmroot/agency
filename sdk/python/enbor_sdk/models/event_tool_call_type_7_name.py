from enum import Enum

class EventToolCallType7Name(str, Enum):
    FETCH = "fetch"

    def __str__(self) -> str:
        return str(self.value)
