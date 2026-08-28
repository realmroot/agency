from enum import Enum

class AgentStatusPhase(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    RETIRED = "retired"
    RETIRING = "retiring"

    def __str__(self) -> str:
        return str(self.value)
