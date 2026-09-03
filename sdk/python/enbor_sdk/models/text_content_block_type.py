from enum import Enum

class TextContentBlockType(str, Enum):
    TEXT = "text"

    def __str__(self) -> str:
        return str(self.value)
