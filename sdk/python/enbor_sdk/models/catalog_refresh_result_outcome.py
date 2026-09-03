from enum import Enum

class CatalogRefreshResultOutcome(str, Enum):
    FAILED = "failed"
    SUCCEEDED = "succeeded"

    def __str__(self) -> str:
        return str(self.value)
