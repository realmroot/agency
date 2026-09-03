from enum import Enum

class RunnerChannelMessageType4Type(str, Enum):
    SANDBOX_REQUEST = "sandbox.request"

    def __str__(self) -> str:
        return str(self.value)
