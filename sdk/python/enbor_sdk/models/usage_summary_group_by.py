from enum import Enum

class UsageSummaryGroupBy(str, Enum):
    AGENT = "agent"
    MODEL = "model"
    PROVIDER = "provider"

    def __str__(self) -> str:
        return str(self.value)
