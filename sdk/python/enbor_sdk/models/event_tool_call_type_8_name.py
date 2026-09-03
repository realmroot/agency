from enum import Enum

class EventToolCallType8Name(str, Enum):
    WEB_SEARCH = "web_search"

    def __str__(self) -> str:
        return str(self.value)
