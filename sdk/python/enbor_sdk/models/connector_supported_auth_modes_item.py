from enum import Enum

class ConnectorSupportedAuthModesItem(str, Enum):
    VAULT_CREDENTIAL = "vault_credential"

    def __str__(self) -> str:
        return str(self.value)
