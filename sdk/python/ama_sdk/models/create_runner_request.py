from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_runner_request_auth_mode import CreateRunnerRequestAuthMode
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.create_runner_request_metadata import CreateRunnerRequestMetadata





T = TypeVar("T", bound="CreateRunnerRequest")



@_attrs_define
class CreateRunnerRequest:
    """ 
        Attributes:
            name (str):  Example: mac-mini-build-runner.
            capabilities (list[str] | Unset):  Example: ['node', 'git'].
            environment_id (str | Unset):  Example: env_abc123.
            secret_ref (str | Unset):  Example: ama://vaults/vault_abc123/credentials/vaultcred_abc123.
            auth_mode (CreateRunnerRequestAuthMode | Unset):  Example: bearer.
            max_concurrent (int | Unset):  Example: 2.
            metadata (CreateRunnerRequestMetadata | Unset):  Example: {'pool': 'default'}.
     """

    name: str
    capabilities: list[str] | Unset = UNSET
    environment_id: str | Unset = UNSET
    secret_ref: str | Unset = UNSET
    auth_mode: CreateRunnerRequestAuthMode | Unset = UNSET
    max_concurrent: int | Unset = UNSET
    metadata: CreateRunnerRequestMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_runner_request_metadata import CreateRunnerRequestMetadata
        name = self.name

        capabilities: list[str] | Unset = UNSET
        if not isinstance(self.capabilities, Unset):
            capabilities = self.capabilities



        environment_id = self.environment_id

        secret_ref = self.secret_ref

        auth_mode: str | Unset = UNSET
        if not isinstance(self.auth_mode, Unset):
            auth_mode = self.auth_mode.value


        max_concurrent = self.max_concurrent

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
        })
        if capabilities is not UNSET:
            field_dict["capabilities"] = capabilities
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if secret_ref is not UNSET:
            field_dict["secretRef"] = secret_ref
        if auth_mode is not UNSET:
            field_dict["authMode"] = auth_mode
        if max_concurrent is not UNSET:
            field_dict["maxConcurrent"] = max_concurrent
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_runner_request_metadata import CreateRunnerRequestMetadata
        d = dict(src_dict)
        name = d.pop("name")

        capabilities = cast(list[str], d.pop("capabilities", UNSET))


        environment_id = d.pop("environmentId", UNSET)

        secret_ref = d.pop("secretRef", UNSET)

        _auth_mode = d.pop("authMode", UNSET)
        auth_mode: CreateRunnerRequestAuthMode | Unset
        if isinstance(_auth_mode,  Unset):
            auth_mode = UNSET
        else:
            auth_mode = CreateRunnerRequestAuthMode(_auth_mode)




        max_concurrent = d.pop("maxConcurrent", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: CreateRunnerRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = CreateRunnerRequestMetadata.from_dict(_metadata)




        create_runner_request = cls(
            name=name,
            capabilities=capabilities,
            environment_id=environment_id,
            secret_ref=secret_ref,
            auth_mode=auth_mode,
            max_concurrent=max_concurrent,
            metadata=metadata,
        )

        return create_runner_request

