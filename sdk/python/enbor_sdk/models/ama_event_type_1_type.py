from enum import Enum

class AmaEventType1Type(str, Enum):
    RUNTIME_COMPLETED = "runtime.completed"

    def __str__(self) -> str:
        return str(self.value)
