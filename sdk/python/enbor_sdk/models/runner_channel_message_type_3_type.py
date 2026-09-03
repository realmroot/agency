from enum import Enum

class RunnerChannelMessageType3Type(str, Enum):
    SESSION_COMMAND_RESULT = "session.command.result"

    def __str__(self) -> str:
        return str(self.value)
