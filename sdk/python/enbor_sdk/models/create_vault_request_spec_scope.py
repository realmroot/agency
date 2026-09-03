from enum import Enum

class CreateVaultRequestSpecScope(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"

    def __str__(self) -> str:
        return str(self.value)
