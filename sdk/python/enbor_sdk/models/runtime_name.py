from enum import Enum

class RuntimeName(str, Enum):
    ENBOR = "ama"
    CLAUDE_CODE = "claude-code"
    CODEX = "codex"
    COPILOT = "copilot"

    def __str__(self) -> str:
        return str(self.value)
