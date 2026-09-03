from enum import Enum

class EnvironmentNetworkingType(str, Enum):
    CLOSED = "closed"
    LIMITED = "limited"
    OPEN = "open"

    def __str__(self) -> str:
        return str(self.value)
