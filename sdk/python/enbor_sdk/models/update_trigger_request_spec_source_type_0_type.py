from enum import Enum

class UpdateTriggerRequestSpecSourceType0Type(str, Enum):
    SCHEDULE = "schedule"

    def __str__(self) -> str:
        return str(self.value)
