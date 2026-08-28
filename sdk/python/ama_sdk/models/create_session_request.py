from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.execution_spec_input import ExecutionSpecInput
  from ..models.session_create_metadata import SessionCreateMetadata





T = TypeVar("T", bound="CreateSessionRequest")



@_attrs_define
class CreateSessionRequest:
    """ 
        Attributes:
            spec (ExecutionSpecInput):
            prompt (str):  Example: Research Canadian banking bonus offers and summarize current opportunities..
            metadata (SessionCreateMetadata | Unset):
     """

    spec: ExecutionSpecInput
    prompt: str
    metadata: SessionCreateMetadata | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.execution_spec_input import ExecutionSpecInput
        from ..models.session_create_metadata import SessionCreateMetadata
        spec = self.spec.to_dict()

        prompt = self.prompt

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "spec": spec,
            "prompt": prompt,
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.execution_spec_input import ExecutionSpecInput
        from ..models.session_create_metadata import SessionCreateMetadata
        d = dict(src_dict)
        spec = ExecutionSpecInput.from_dict(d.pop("spec"))




        prompt = d.pop("prompt")

        _metadata = d.pop("metadata", UNSET)
        metadata: SessionCreateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = SessionCreateMetadata.from_dict(_metadata)




        create_session_request = cls(
            spec=spec,
            prompt=prompt,
            metadata=metadata,
        )

        return create_session_request

