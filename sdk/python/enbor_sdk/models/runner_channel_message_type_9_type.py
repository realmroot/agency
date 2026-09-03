from enum import Enum

class RunnerChannelMessageType9Type(str, Enum):
    RUNNER_EVENT_ACCEPTED = "runner.event.accepted"

    def __str__(self) -> str:
        return str(self.value)
