from enum import Enum

class TriggerScheduleType(str, Enum):
    INTERVAL = "interval"

    def __str__(self) -> str:
        return str(self.value)
