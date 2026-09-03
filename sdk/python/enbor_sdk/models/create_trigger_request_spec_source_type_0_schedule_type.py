from enum import Enum

class CreateTriggerRequestSpecSourceType0ScheduleType(str, Enum):
    INTERVAL = "interval"

    def __str__(self) -> str:
        return str(self.value)
