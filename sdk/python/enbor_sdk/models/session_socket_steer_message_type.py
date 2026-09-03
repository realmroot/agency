from enum import Enum

class SessionSocketSteerMessageType(str, Enum):
    STEER = "steer"

    def __str__(self) -> str:
        return str(self.value)
