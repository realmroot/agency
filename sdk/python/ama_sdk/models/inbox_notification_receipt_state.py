from enum import Enum

class InboxNotificationReceiptState(str, Enum):
    ACCEPTED = "accepted"

    def __str__(self) -> str:
        return str(self.value)
