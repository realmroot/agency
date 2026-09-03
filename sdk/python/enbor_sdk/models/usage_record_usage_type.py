from enum import Enum

class UsageRecordUsageType(str, Enum):
    MODEL = "model"
    TOOL = "tool"

    def __str__(self) -> str:
        return str(self.value)
