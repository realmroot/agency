from enum import Enum

class TriggerSourceType1Type(str, Enum):
    HTTP = "http"

    def __str__(self) -> str:
        return str(self.value)
