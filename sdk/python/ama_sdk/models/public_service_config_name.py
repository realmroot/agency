from enum import Enum

class PublicServiceConfigName(str, Enum):
    ANY_MANAGED_AGENTS = "Any Managed Agents"

    def __str__(self) -> str:
        return str(self.value)
