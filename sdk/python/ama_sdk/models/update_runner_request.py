from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_runner_request_state import UpdateRunnerRequestState
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.update_runner_request_metadata import UpdateRunnerRequestMetadata





T = TypeVar("T", bound="UpdateRunnerRequest")



@_attrs_define
class UpdateRunnerRequest:
    """ 
        Attributes:
            name (str | Unset):
            state (UpdateRunnerRequestState | Unset):
            max_concurrent (int | Unset):
            metadata (UpdateRunnerRequestMetadata | Unset):
            archived (bool | Unset):
     """

    name: str | Unset = UNSET
    state: UpdateRunnerRequestState | Unset = UNSET
    max_concurrent: int | Unset = UNSET
    metadata: UpdateRunnerRequestMetadata | Unset = UNSET
    archived: bool | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.update_runner_request_metadata import UpdateRunnerRequestMetadata
        name = self.name

        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value


        max_concurrent = self.max_concurrent

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        archived = self.archived


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if name is not UNSET:
            field_dict["name"] = name
        if state is not UNSET:
            field_dict["state"] = state
        if max_concurrent is not UNSET:
            field_dict["maxConcurrent"] = max_concurrent
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if archived is not UNSET:
            field_dict["archived"] = archived

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.update_runner_request_metadata import UpdateRunnerRequestMetadata
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _state = d.pop("state", UNSET)
        state: UpdateRunnerRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = UpdateRunnerRequestState(_state)




        max_concurrent = d.pop("maxConcurrent", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: UpdateRunnerRequestMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = UpdateRunnerRequestMetadata.from_dict(_metadata)




        archived = d.pop("archived", UNSET)

        update_runner_request = cls(
            name=name,
            state=state,
            max_concurrent=max_concurrent,
            metadata=metadata,
            archived=archived,
        )

        return update_runner_request

