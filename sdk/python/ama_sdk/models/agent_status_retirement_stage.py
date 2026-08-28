from enum import Enum

class AgentStatusRetirementStage(str, Enum):
    IDENTITY_RETIRED = "identity_retired"
    RETIRED = "retired"
    STOPPING = "stopping"

    def __str__(self) -> str:
        return str(self.value)
