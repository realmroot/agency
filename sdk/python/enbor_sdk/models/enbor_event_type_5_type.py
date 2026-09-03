from enum import Enum

class EnborEventType5Type(str, Enum):
    MESSAGE_UPDATED = "message.updated"

    def __str__(self) -> str:
        return str(self.value)
