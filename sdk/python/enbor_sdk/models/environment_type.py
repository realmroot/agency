from enum import Enum

class EnvironmentType(str, Enum):
    CLOUD = "cloud"
    SELF_HOSTED = "self_hosted"

    def __str__(self) -> str:
        return str(self.value)
