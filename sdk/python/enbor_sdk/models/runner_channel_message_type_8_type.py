from enum import Enum

class RunnerChannelMessageType8Type(str, Enum):
    RUNNER_EVENT = "runner.event"

    def __str__(self) -> str:
        return str(self.value)
