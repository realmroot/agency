from enum import Enum

class RunnerSandboxRequestType(str, Enum):
    SANDBOX_EXECUTE = "sandbox.execute"
    SANDBOX_READMEMORYSTORES = "sandbox.readMemoryStores"
    SANDBOX_STOP = "sandbox.stop"

    def __str__(self) -> str:
        return str(self.value)
