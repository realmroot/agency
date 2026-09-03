from enum import Enum

class CreateSessionMessageRequestType(str, Enum):
    PROMPT = "prompt"

    def __str__(self) -> str:
        return str(self.value)
