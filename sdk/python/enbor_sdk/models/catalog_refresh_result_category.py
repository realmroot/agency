from enum import Enum

class CatalogRefreshResultCategory(str, Enum):
    AUTH = "auth"
    INVALID_REQUEST = "invalid_request"
    MODEL_UNAVAILABLE = "model_unavailable"
    NETWORK = "network"
    QUOTA = "quota"
    RATE_LIMIT = "rate_limit"
    UNKNOWN = "unknown"

    def __str__(self) -> str:
        return str(self.value)
