from enum import Enum

class RunnerChannelMessageType5Type(str, Enum):
    SANDBOX_RESPONSE = "sandbox.response"

    def __str__(self) -> str:
        return str(self.value)
