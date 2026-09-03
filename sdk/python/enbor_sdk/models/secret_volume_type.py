from enum import Enum

class SecretVolumeType(str, Enum):
    SECRET = "secret"

    def __str__(self) -> str:
        return str(self.value)
