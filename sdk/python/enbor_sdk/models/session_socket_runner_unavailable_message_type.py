from enum import Enum

class SessionSocketRunnerUnavailableMessageType(str, Enum):
    RUNNER_UNAVAILABLE = "runner_unavailable"

    def __str__(self) -> str:
        return str(self.value)
