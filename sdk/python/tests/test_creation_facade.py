from unittest import TestCase
from unittest.mock import patch

from enbor_sdk.facade import create_ama_client


class CreationFacadeTest(TestCase):
    def test_agents_create_omits_unspecified_idempotency_key(self) -> None:
        client = create_ama_client(base_url="https://example.com")
        response = object()
        body = object()
        with (
            patch("enbor_sdk.facade.create_agent_api.sync_detailed", return_value=response) as create,
            patch("enbor_sdk.facade._unwrap", return_value="agent"),
        ):
            result = client.agents.create(body)

        self.assertEqual(result, "agent")
        create.assert_called_once_with(client=client.raw, body=body)

    def test_agents_create_forwards_provided_idempotency_key(self) -> None:
        client = create_ama_client(base_url="https://example.com")
        response = object()
        body = object()
        with (
            patch("enbor_sdk.facade.create_agent_api.sync_detailed", return_value=response) as create,
            patch("enbor_sdk.facade._unwrap", return_value="agent"),
        ):
            result = client.agents.create(body, "agent-idempotency-1")

        self.assertEqual(result, "agent")
        create.assert_called_once_with(client=client.raw, body=body, idempotency_key="agent-idempotency-1")

    def test_environments_create_omits_unspecified_idempotency_key(self) -> None:
        client = create_ama_client(base_url="https://example.com")
        response = object()
        body = object()
        with (
            patch("enbor_sdk.facade.create_environment_api.sync_detailed", return_value=response) as create,
            patch("enbor_sdk.facade._unwrap", return_value="environment"),
        ):
            result = client.environments.create(body)

        self.assertEqual(result, "environment")
        create.assert_called_once_with(client=client.raw, body=body)

    def test_environments_create_forwards_provided_idempotency_key(self) -> None:
        client = create_ama_client(base_url="https://example.com")
        response = object()
        body = object()
        with (
            patch("enbor_sdk.facade.create_environment_api.sync_detailed", return_value=response) as create,
            patch("enbor_sdk.facade._unwrap", return_value="environment"),
        ):
            result = client.environments.create(body, "environment-idempotency-1")

        self.assertEqual(result, "environment")
        create.assert_called_once_with(client=client.raw, body=body, idempotency_key="environment-idempotency-1")
