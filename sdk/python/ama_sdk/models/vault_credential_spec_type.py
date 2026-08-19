from enum import Enum

class VaultCredentialSpecType(str, Enum):
    VAULT_CREDENTIAL_TYPE_BASIC_AUTH = "ama.dev/basic-auth"
    VAULT_CREDENTIAL_TYPE_OAUTH_TOKEN = "ama.dev/oauth-token"
    VAULT_CREDENTIAL_TYPE_OPAQUE = "opaque"
    VAULT_CREDENTIAL_TYPE_PRIVATE_KEY_JWK = "ama.dev/private-key-jwk"
    VAULT_CREDENTIAL_TYPE_REALMROOT_AGENT_STATE = "ama.dev/realmroot-agent-state"
    VAULT_CREDENTIAL_TYPE_SSH_AUTH = "ama.dev/ssh-auth"
    VAULT_CREDENTIAL_TYPE_TLS = "ama.dev/tls"

    def __str__(self) -> str:
        return str(self.value)
