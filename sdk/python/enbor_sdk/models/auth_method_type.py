from enum import Enum

class AuthMethodType(str, Enum):
    OIDC = "oidc"

    def __str__(self) -> str:
        return str(self.value)
