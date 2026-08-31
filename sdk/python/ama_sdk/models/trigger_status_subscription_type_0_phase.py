from enum import Enum

class TriggerStatusSubscriptionType0Phase(str, Enum):
    ACTIVE = "active"
    ERROR = "error"
    INACTIVE = "inactive"
    PENDING = "pending"

    def __str__(self) -> str:
        return str(self.value)
