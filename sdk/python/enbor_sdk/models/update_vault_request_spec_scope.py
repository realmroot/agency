from enum import Enum

class UpdateVaultRequestSpecScope(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"

    def __str__(self) -> str:
        return str(self.value)
