from enum import Enum

class ConnectorToolApprovalMode(str, Enum):
    ALWAYS_REQUIRED = "always_required"
    NONE = "none"
    PER_CALL = "per_call"
    PROJECT_POLICY = "project_policy"

    def __str__(self) -> str:
        return str(self.value)
