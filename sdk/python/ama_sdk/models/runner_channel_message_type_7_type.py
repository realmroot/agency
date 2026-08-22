from enum import Enum

class RunnerChannelMessageType7Type(str, Enum):
    SESSION_BACKFILL_RESPONSE = "session.backfill_response"

    def __str__(self) -> str:
        return str(self.value)
