from enum import Enum

class ConnectorCategory(str, Enum):
    DEVELOPMENT = "development"
    PLANNING = "planning"

    def __str__(self) -> str:
        return str(self.value)
