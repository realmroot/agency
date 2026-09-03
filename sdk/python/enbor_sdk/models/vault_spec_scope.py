from enum import Enum

class VaultSpecScope(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"

    def __str__(self) -> str:
        return str(self.value)
