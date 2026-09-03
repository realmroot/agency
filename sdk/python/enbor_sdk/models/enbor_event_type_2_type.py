from enum import Enum

class EnborEventType2Type(str, Enum):
    TURN_STARTED = "turn.started"

    def __str__(self) -> str:
        return str(self.value)
