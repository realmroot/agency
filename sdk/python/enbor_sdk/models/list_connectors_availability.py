from enum import Enum

class ListConnectorsAvailability(str, Enum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"

    def __str__(self) -> str:
        return str(self.value)
