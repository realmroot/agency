from enum import Enum

class RunnerRuntimeState(str, Enum):
    LIMITED = "limited"
    MISSING = "missing"
    READY = "ready"
    UNAUTHENTICATED = "unauthenticated"
    UNAUTHORIZED = "unauthorized"
    UNHEALTHY = "unhealthy"

    def __str__(self) -> str:
        return str(self.value)
