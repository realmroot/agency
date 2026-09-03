from enum import Enum

class ProviderModelCatalogState(str, Enum):
    ERROR = "error"
    READY = "ready"

    def __str__(self) -> str:
        return str(self.value)
