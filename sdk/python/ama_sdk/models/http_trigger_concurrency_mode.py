from enum import Enum

class HttpTriggerConcurrencyMode(str, Enum):
    PARALLEL = "parallel"
    SERIAL = "serial"

    def __str__(self) -> str:
        return str(self.value)
