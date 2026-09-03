from enum import Enum

class SessionSocketAckMessageType(str, Enum):
    ACK = "ack"

    def __str__(self) -> str:
        return str(self.value)
