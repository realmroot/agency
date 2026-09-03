from enum import Enum

class ListVaultCredentialVersionsState(str, Enum):
    ACTIVE = "active"
    REVOKED = "revoked"
    SUPERSEDED = "superseded"

    def __str__(self) -> str:
        return str(self.value)
