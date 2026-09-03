from enum import Enum

class UpdateVaultCredentialRequestState(str, Enum):
    REVOKED = "revoked"

    def __str__(self) -> str:
        return str(self.value)
