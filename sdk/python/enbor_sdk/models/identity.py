from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.identity_spec import IdentitySpec
  from ..models.identity_status import IdentityStatus
  from ..models.resource_metadata import ResourceMetadata





T = TypeVar("T", bound="Identity")



@_attrs_define
class Identity:
    """
        Attributes:
            metadata (ResourceMetadata):
            spec (IdentitySpec):
            status (IdentityStatus):
     """

    metadata: ResourceMetadata
    spec: IdentitySpec
    status: IdentityStatus
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.identity_spec import IdentitySpec
        from ..models.identity_status import IdentityStatus
        from ..models.resource_metadata import ResourceMetadata
        metadata = self.metadata.to_dict()

        spec = self.spec.to_dict()

        status = self.status.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "metadata": metadata,
            "spec": spec,
            "status": status,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.identity_spec import IdentitySpec
        from ..models.identity_status import IdentityStatus
        from ..models.resource_metadata import ResourceMetadata
        d = dict(src_dict)
        metadata = ResourceMetadata.from_dict(d.pop("metadata"))




        spec = IdentitySpec.from_dict(d.pop("spec"))




        status = IdentityStatus.from_dict(d.pop("status"))




        identity = cls(
            metadata=metadata,
            spec=spec,
            status=status,
        )


        identity.additional_properties = d
        return identity

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
