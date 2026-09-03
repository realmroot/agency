from enum import Enum

class UsageRecordProviderType(str, Enum):
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"
    OPENAI = "openai"
    OPENAI_COMPATIBLE = "openai-compatible"
    SANDBOX = "sandbox"
    WORKERS_AI = "workers-ai"

    def __str__(self) -> str:
        return str(self.value)
