from enum import Enum

class SessionEventType11Type(str, Enum):
    RUNTIME_ERROR = "runtime.error"

    def __str__(self) -> str:
        return str(self.value)
