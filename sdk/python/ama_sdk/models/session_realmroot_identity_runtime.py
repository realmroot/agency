from enum import Enum

class SessionRealmrootIdentityRuntime(str, Enum):
    AMA = "ama"

    def __str__(self) -> str:
        return str(self.value)
