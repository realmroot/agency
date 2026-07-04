from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.health_response_runtime import HealthResponseRuntime
from ..models.health_response_status import HealthResponseStatus
from typing import cast
import datetime






T = TypeVar("T", bound="HealthResponse")



@_attrs_define
class HealthResponse:
    """ 
        Attributes:
            status (HealthResponseStatus):  Example: ok.
            name (str):  Example: Any Managed Agents.
            runtime (HealthResponseRuntime):  Example: cloudflare-workers.
            oidc_issuer (None | str):  Example: https://id.example.com/api/auth.
            oidc_resource (None | str):  Example: https://ama.example.com.
            runner_client_id (None | str):  Example: ama-runner.
            runner_scopes (None | str):  Example: openid profile email offline_access.
            timestamp (datetime.datetime):  Example: 2026-05-22T00:00:00.000Z.
     """

    status: HealthResponseStatus
    name: str
    runtime: HealthResponseRuntime
    oidc_issuer: None | str
    oidc_resource: None | str
    runner_client_id: None | str
    runner_scopes: None | str
    timestamp: datetime.datetime
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        status = self.status.value

        name = self.name

        runtime = self.runtime.value

        oidc_issuer: None | str
        oidc_issuer = self.oidc_issuer

        oidc_resource: None | str
        oidc_resource = self.oidc_resource

        runner_client_id: None | str
        runner_client_id = self.runner_client_id

        runner_scopes: None | str
        runner_scopes = self.runner_scopes

        timestamp = self.timestamp.isoformat()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "status": status,
            "name": name,
            "runtime": runtime,
            "oidcIssuer": oidc_issuer,
            "oidcResource": oidc_resource,
            "runnerClientId": runner_client_id,
            "runnerScopes": runner_scopes,
            "timestamp": timestamp,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = HealthResponseStatus(d.pop("status"))




        name = d.pop("name")

        runtime = HealthResponseRuntime(d.pop("runtime"))




        def _parse_oidc_issuer(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        oidc_issuer = _parse_oidc_issuer(d.pop("oidcIssuer"))


        def _parse_oidc_resource(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        oidc_resource = _parse_oidc_resource(d.pop("oidcResource"))


        def _parse_runner_client_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        runner_client_id = _parse_runner_client_id(d.pop("runnerClientId"))


        def _parse_runner_scopes(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        runner_scopes = _parse_runner_scopes(d.pop("runnerScopes"))


        timestamp = datetime.datetime.fromisoformat(d.pop("timestamp"))




        health_response = cls(
            status=status,
            name=name,
            runtime=runtime,
            oidc_issuer=oidc_issuer,
            oidc_resource=oidc_resource,
            runner_client_id=runner_client_id,
            runner_scopes=runner_scopes,
            timestamp=timestamp,
        )


        health_response.additional_properties = d
        return health_response

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
