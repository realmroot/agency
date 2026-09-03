from enum import Enum

class RunnerWorkPayloadProtocol(str, Enum):
    AMA_RUNNER_WORK = "ama-runner-work"

    def __str__(self) -> str:
        return str(self.value)
