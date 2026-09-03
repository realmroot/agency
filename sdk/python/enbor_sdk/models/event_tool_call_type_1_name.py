from enum import Enum

class EventToolCallType1Name(str, Enum):
    READ = "read"

    def __str__(self) -> str:
        return str(self.value)
