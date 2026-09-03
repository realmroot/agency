from enum import Enum

class SessionSocketBackfillRequestMessageType(str, Enum):
    BACKFILL = "backfill"

    def __str__(self) -> str:
        return str(self.value)
