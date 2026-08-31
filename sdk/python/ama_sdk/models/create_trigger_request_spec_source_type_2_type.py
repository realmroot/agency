from enum import Enum

class CreateTriggerRequestSpecSourceType2Type(str, Enum):
    INBOX = "inbox"

    def __str__(self) -> str:
        return str(self.value)
