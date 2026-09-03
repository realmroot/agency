from enum import Enum

class SessionSocketBackfillMessageType(str, Enum):
    BACKFILL = "backfill"

    def __str__(self) -> str:
        return str(self.value)
