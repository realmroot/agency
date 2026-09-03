from enum import Enum

class AmaEventType3Type(str, Enum):
    TURN_COMPLETED = "turn.completed"

    def __str__(self) -> str:
        return str(self.value)
