from enum import Enum

class SessionEventType4Type(str, Enum):
    MESSAGE_STARTED = "message.started"

    def __str__(self) -> str:
        return str(self.value)
