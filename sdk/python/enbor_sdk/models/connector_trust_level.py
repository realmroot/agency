from enum import Enum

class ConnectorTrustLevel(str, Enum):
    VERIFIED = "verified"

    def __str__(self) -> str:
        return str(self.value)
