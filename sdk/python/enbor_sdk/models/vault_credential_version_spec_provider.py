from enum import Enum

class VaultCredentialVersionSpecProvider(str, Enum):
    ENBOR = "ama"

    def __str__(self) -> str:
        return str(self.value)
