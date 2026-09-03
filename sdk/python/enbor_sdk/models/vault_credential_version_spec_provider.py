from enum import Enum

class VaultCredentialVersionSpecProvider(str, Enum):
    AMA = "ama"

    def __str__(self) -> str:
        return str(self.value)
