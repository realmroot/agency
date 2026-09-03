from enum import Enum

class RunnerChannelMessageType0Type(str, Enum):
    RUNNER_CHANNEL_ACCEPTED = "runner.channel.accepted"

    def __str__(self) -> str:
        return str(self.value)
