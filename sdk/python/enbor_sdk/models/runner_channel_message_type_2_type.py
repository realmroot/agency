from enum import Enum

class RunnerChannelMessageType2Type(str, Enum):
    SESSION_COMMAND = "session.command"

    def __str__(self) -> str:
        return str(self.value)
