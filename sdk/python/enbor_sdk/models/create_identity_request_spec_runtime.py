from enum import Enum

class CreateIdentityRequestSpecRuntime(str, Enum):
    AMA = "ama"
    CLAUDE_CODE = "claude-code"
    CODEX = "codex"
    COPILOT = "copilot"

    def __str__(self) -> str:
        return str(self.value)
