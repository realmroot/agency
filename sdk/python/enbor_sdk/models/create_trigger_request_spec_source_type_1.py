from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.create_trigger_request_spec_source_type_1_type import CreateTriggerRequestSpecSourceType1Type
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.http_trigger_concurrency import HttpTriggerConcurrency





T = TypeVar("T", bound="CreateTriggerRequestSpecSourceType1")



@_attrs_define
class CreateTriggerRequestSpecSourceType1:
    """
        Attributes:
            type_ (CreateTriggerRequestSpecSourceType1Type):
            concurrency (HttpTriggerConcurrency | Unset):
     """

    type_: CreateTriggerRequestSpecSourceType1Type
    concurrency: HttpTriggerConcurrency | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.http_trigger_concurrency import HttpTriggerConcurrency
        type_ = self.type_.value

        concurrency: dict[str, Any] | Unset = UNSET
        if not isinstance(self.concurrency, Unset):
            concurrency = self.concurrency.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
        })
        if concurrency is not UNSET:
            field_dict["concurrency"] = concurrency

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.http_trigger_concurrency import HttpTriggerConcurrency
        d = dict(src_dict)
        type_ = CreateTriggerRequestSpecSourceType1Type(d.pop("type"))




        _concurrency = d.pop("concurrency", UNSET)
        concurrency: HttpTriggerConcurrency | Unset
        if isinstance(_concurrency,  Unset):
            concurrency = UNSET
        else:
            concurrency = HttpTriggerConcurrency.from_dict(_concurrency)




        create_trigger_request_spec_source_type_1 = cls(
            type_=type_,
            concurrency=concurrency,
        )


        create_trigger_request_spec_source_type_1.additional_properties = d
        return create_trigger_request_spec_source_type_1

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
