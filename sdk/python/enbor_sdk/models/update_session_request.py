from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.update_session_request_state import UpdateSessionRequestState
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.session_update_metadata import SessionUpdateMetadata





T = TypeVar("T", bound="UpdateSessionRequest")



@_attrs_define
class UpdateSessionRequest:
    """
        Attributes:
            metadata (SessionUpdateMetadata | Unset):
            state (UpdateSessionRequestState | Unset):  Example: closed.
     """

    metadata: SessionUpdateMetadata | Unset = UNSET
    state: UpdateSessionRequestState | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.session_update_metadata import SessionUpdateMetadata
        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        state: str | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.value



        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if metadata is not UNSET:
            field_dict["metadata"] = metadata
        if state is not UNSET:
            field_dict["state"] = state

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.session_update_metadata import SessionUpdateMetadata
        d = dict(src_dict)
        _metadata = d.pop("metadata", UNSET)
        metadata: SessionUpdateMetadata | Unset
        if isinstance(_metadata,  Unset):
            metadata = UNSET
        else:
            metadata = SessionUpdateMetadata.from_dict(_metadata)




        _state = d.pop("state", UNSET)
        state: UpdateSessionRequestState | Unset
        if isinstance(_state,  Unset):
            state = UNSET
        else:
            state = UpdateSessionRequestState(_state)




        update_session_request = cls(
            metadata=metadata,
            state=state,
        )

        return update_session_request
