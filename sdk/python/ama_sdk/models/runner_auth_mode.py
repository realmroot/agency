from enum import Enum

class RunnerAuthMode(str, Enum):
    REALMROOT = "realmroot"

    def __str__(self) -> str:
        return str(self.value)
