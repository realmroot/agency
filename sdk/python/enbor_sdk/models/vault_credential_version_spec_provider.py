from enum import Enum

class VaultCredentialVersionSpecProvider(str, Enum):
    ENBOR = "enbor"

    def __str__(self) -> str:
        return str(self.value)
