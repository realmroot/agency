from enum import Enum

class ListAgentsRuntime(str, Enum):
    CLAUDE_CODE = "claude-code"
    CODEX = "codex"
    COPILOT = "copilot"
    ENBOR = "enbor"

    def __str__(self) -> str:
        return str(self.value)
