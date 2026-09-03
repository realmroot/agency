from enum import Enum

class EnborEventType0Type(str, Enum):
    RUNTIME_STARTED = "runtime.started"

    def __str__(self) -> str:
        return str(self.value)
