from enum import Enum

class VaultCredentialSpecType(str, Enum):
    VAULT_CREDENTIAL_TYPE_BASIC_AUTH = "enbor.dev/basic-auth"
    VAULT_CREDENTIAL_TYPE_OAUTH_TOKEN = "enbor.dev/oauth-token"
    VAULT_CREDENTIAL_TYPE_OPAQUE = "opaque"
    VAULT_CREDENTIAL_TYPE_PRIVATE_KEY_JWK = "enbor.dev/private-key-jwk"
    VAULT_CREDENTIAL_TYPE_REALMROOT_AGENT_STATE = "enbor.dev/realmroot-agent-state"
    VAULT_CREDENTIAL_TYPE_SSH_AUTH = "enbor.dev/ssh-auth"
    VAULT_CREDENTIAL_TYPE_TLS = "enbor.dev/tls"

    def __str__(self) -> str:
        return str(self.value)
