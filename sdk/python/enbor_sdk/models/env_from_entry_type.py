from enum import Enum

class EnvFromEntryType(str, Enum):
    SECRET = "secret"

    def __str__(self) -> str:
        return str(self.value)
