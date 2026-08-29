from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.identity_status_state import IdentityStatusState
from ..models.resource_phase import ResourcePhase
from typing import cast

if TYPE_CHECKING:
  from ..models.identity_descriptor_type_0 import IdentityDescriptorType0





T = TypeVar("T", bound="IdentityStatus")



@_attrs_define
class IdentityStatus:
    """
        Attributes:
            phase (ResourcePhase):
            state (IdentityStatusState):
            failure_code (None | str):
            bound_agent_id (None | str):
            descriptor (IdentityDescriptorType0 | None):
     """

    phase: ResourcePhase
    state: IdentityStatusState
    failure_code: None | str
    bound_agent_id: None | str
    descriptor: IdentityDescriptorType0 | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.identity_descriptor_type_0 import IdentityDescriptorType0
        phase = self.phase.value

        state = self.state.value

        failure_code: None | str
        failure_code = self.failure_code

        bound_agent_id: None | str
        bound_agent_id = self.bound_agent_id

        descriptor: dict[str, Any] | None
        if isinstance(self.descriptor, IdentityDescriptorType0):
            descriptor = self.descriptor.to_dict()
        else:
            descriptor = self.descriptor


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "phase": phase,
            "state": state,
            "failureCode": failure_code,
            "boundAgentId": bound_agent_id,
            "descriptor": descriptor,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.identity_descriptor_type_0 import IdentityDescriptorType0
        d = dict(src_dict)
        phase = ResourcePhase(d.pop("phase"))




        state = IdentityStatusState(d.pop("state"))




        def _parse_failure_code(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        failure_code = _parse_failure_code(d.pop("failureCode"))


        def _parse_bound_agent_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        bound_agent_id = _parse_bound_agent_id(d.pop("boundAgentId"))


        def _parse_descriptor(data: object) -> IdentityDescriptorType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_identity_descriptor_type_0 = IdentityDescriptorType0.from_dict(data)



                return componentsschemas_identity_descriptor_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(IdentityDescriptorType0 | None, data)

        descriptor = _parse_descriptor(d.pop("descriptor"))


        identity_status = cls(
            phase=phase,
            state=state,
            failure_code=failure_code,
            bound_agent_id=bound_agent_id,
            descriptor=descriptor,
        )


        identity_status.additional_properties = d
        return identity_status

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
