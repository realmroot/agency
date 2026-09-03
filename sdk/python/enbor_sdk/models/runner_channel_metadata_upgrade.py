from enum import Enum

class RunnerChannelMetadataUpgrade(str, Enum):
    WEBSOCKET = "websocket"

    def __str__(self) -> str:
        return str(self.value)
