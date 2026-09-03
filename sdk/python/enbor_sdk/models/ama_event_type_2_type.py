from enum import Enum

class AmaEventType2Type(str, Enum):
    TURN_STARTED = "turn.started"

    def __str__(self) -> str:
        return str(self.value)
