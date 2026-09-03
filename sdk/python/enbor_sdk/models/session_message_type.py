from enum import Enum

class SessionMessageType(str, Enum):
    PROMPT = "prompt"

    def __str__(self) -> str:
        return str(self.value)
