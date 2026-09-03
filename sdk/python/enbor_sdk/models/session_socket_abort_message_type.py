from enum import Enum

class SessionSocketAbortMessageType(str, Enum):
    ABORT = "abort"

    def __str__(self) -> str:
        return str(self.value)
