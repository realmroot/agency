from enum import Enum

class ProviderModelAvailability(str, Enum):
    AVAILABLE = "available"
    DISABLED = "disabled"
    UNAVAILABLE = "unavailable"

    def __str__(self) -> str:
        return str(self.value)
