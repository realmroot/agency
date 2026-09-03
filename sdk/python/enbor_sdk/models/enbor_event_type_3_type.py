from enum import Enum

class EnborEventType3Type(str, Enum):
    TURN_COMPLETED = "turn.completed"

    def __str__(self) -> str:
        return str(self.value)
