from enum import Enum

class EnvironmentScope(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"

    def __str__(self) -> str:
        return str(self.value)
