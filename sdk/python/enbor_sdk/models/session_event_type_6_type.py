from enum import Enum

class SessionEventType6Type(str, Enum):
    MESSAGE_COMPLETED = "message.completed"

    def __str__(self) -> str:
        return str(self.value)
