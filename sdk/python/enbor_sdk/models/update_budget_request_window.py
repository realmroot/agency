from enum import Enum

class UpdateBudgetRequestWindow(str, Enum):
    DAY = "day"
    MONTH = "month"

    def __str__(self) -> str:
        return str(self.value)
