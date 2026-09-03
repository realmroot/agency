from enum import Enum

class ListSessionEventsType(str, Enum):
    MESSAGE_COMPLETED = "message.completed"
    MESSAGE_STARTED = "message.started"
    MESSAGE_UPDATED = "message.updated"
    PERMISSION_DENIED = "permission.denied"
    PERMISSION_REQUESTED = "permission.requested"
    PERMISSION_RESOLVED = "permission.resolved"
    RUNTIME_COMPLETED = "runtime.completed"
    RUNTIME_ERROR = "runtime.error"
    RUNTIME_STARTED = "runtime.started"
    TURN_COMPLETED = "turn.completed"
    TURN_STARTED = "turn.started"
    USAGE_RECORDED = "usage.recorded"

    def __str__(self) -> str:
        return str(self.value)
