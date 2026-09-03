from enum import Enum

class RunnerChannelMessageType1Type(str, Enum):
    WORK_ASSIGNED = "work.assigned"

    def __str__(self) -> str:
        return str(self.value)
