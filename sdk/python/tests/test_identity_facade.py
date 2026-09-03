from unittest import TestCase
from unittest.mock import patch

from enbor_sdk.facade import create_enbor_client


class IdentityFacadeTest(TestCase):
    def test_forwards_required_idempotency_key(self) -> None:
        client = create_enbor_client(base_url="https://example.com")
        response = object()
        body = object()
        with (
            patch("enbor_sdk.facade.create_identity_api.sync_detailed", return_value=response) as create,
            patch("enbor_sdk.facade._unwrap", return_value="identity") as unwrap,
        ):
            result = client.identities.create(body, "identity-idempotency-1")

        self.assertEqual(result, "identity")
        create.assert_called_once_with(
            client=client.raw,
            body=body,
            idempotency_key="identity-idempotency-1",
        )
        unwrap.assert_called_once_with(response)
