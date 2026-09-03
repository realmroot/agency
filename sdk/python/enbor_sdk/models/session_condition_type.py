from enum import Enum

class SessionConditionType(str, Enum):
    COMPLETED = "Completed"
    RUNNING = "Running"
    RUNTIMEREADY = "RuntimeReady"
    SCHEDULED = "Scheduled"

    def __str__(self) -> str:
        return str(self.value)
