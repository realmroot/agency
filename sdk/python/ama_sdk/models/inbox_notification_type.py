from enum import Enum

class InboxNotificationType(str, Enum):
    MESSAGE_CREATED = "message.created"

    def __str__(self) -> str:
        return str(self.value)
