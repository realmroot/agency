from enum import Enum

class SessionConditionStatus(str, Enum):
    FALSE = "False"
    TRUE = "True"
    UNKNOWN = "Unknown"

    def __str__(self) -> str:
        return str(self.value)
