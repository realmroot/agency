from enum import Enum

class RunnerChannelMessageType6Type(str, Enum):
    SESSION_BACKFILL_REQUEST = "session.backfill_request"

    def __str__(self) -> str:
        return str(self.value)
