from enum import Enum

class ImageContentBlockType(str, Enum):
    IMAGE = "image"

    def __str__(self) -> str:
        return str(self.value)
