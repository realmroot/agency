from enum import Enum

class PublicServiceConfigName(str, Enum):
    ENBOR = "Enbor"

    def __str__(self) -> str:
        return str(self.value)
