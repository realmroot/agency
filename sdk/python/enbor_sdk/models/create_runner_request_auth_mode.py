from enum import Enum

class CreateRunnerRequestAuthMode(str, Enum):
    REALMROOT = "realmroot"

    def __str__(self) -> str:
        return str(self.value)
