from enum import Enum

class EnvironmentHostingMode(str, Enum):
    CLOUD = "cloud"
    SELF_HOSTED = "self_hosted"

    def __str__(self) -> str:
        return str(self.value)
