from enum import Enum

class RealmrootAgentIdentityType0Runtime(str, Enum):
    AMA = "ama"

    def __str__(self) -> str:
        return str(self.value)
