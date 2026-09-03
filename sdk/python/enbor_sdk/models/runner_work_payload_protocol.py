from enum import Enum

class RunnerWorkPayloadProtocol(str, Enum):
    ENBOR_RUNNER_WORK = "enbor-runner-work"

    def __str__(self) -> str:
        return str(self.value)
