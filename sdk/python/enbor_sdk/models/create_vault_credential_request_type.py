from enum import Enum

class CreateVaultCredentialRequestType(str, Enum):
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_BASIC_AUTH = "enbor.dev/basic-auth"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_OAUTH_TOKEN = "enbor.dev/oauth-token"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_OPAQUE = "opaque"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_PRIVATE_KEY_JWK = "enbor.dev/private-key-jwk"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_REALMROOT_AGENT_STATE = "enbor.dev/realmroot-agent-state"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_SSH_AUTH = "enbor.dev/ssh-auth"
    CREATE_VAULT_CREDENTIAL_REQUEST_TYPE_TLS = "enbor.dev/tls"

    def __str__(self) -> str:
        return str(self.value)
