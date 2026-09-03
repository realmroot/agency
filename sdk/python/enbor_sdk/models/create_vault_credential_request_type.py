from enum import Enum

class CreateVaultCredentialRequestType(str, Enum):
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_BASIC_AUTH = "ama.dev/basic-auth"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_OAUTH_TOKEN = "ama.dev/oauth-token"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_OPAQUE = "opaque"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_PRIVATE_KEY_JWK = "ama.dev/private-key-jwk"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_REALMROOT_AGENT_STATE = "ama.dev/realmroot-agent-state"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_SSH_AUTH = "ama.dev/ssh-auth"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_TLS = "ama.dev/tls"

    def __str__(self) -> str:
        return str(self.value)
