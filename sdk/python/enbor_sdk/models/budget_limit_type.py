from enum import Enum

class BudgetLimitType(str, Enum):
    COST_MICROS = "cost_micros"
    SESSIONS = "sessions"
    TOKENS = "tokens"

    def __str__(self) -> str:
        return str(self.value)
