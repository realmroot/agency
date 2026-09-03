from enum import Enum

class AmaEventType4Type(str, Enum):
    MESSAGE_STARTED = "message.started"

    def __str__(self) -> str:
        return str(self.value)
