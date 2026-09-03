from enum import Enum

class AuditRecordOutcome(str, Enum):
    DENIED = "denied"
    FAILURE = "failure"
    SUCCESS = "success"

    def __str__(self) -> str:
        return str(self.value)
