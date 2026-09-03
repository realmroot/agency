from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.trigger_source_type_0 import TriggerSourceType0
  from ..models.trigger_source_type_1 import TriggerSourceType1
  from ..models.trigger_source_type_2 import TriggerSourceType2
  from ..models.trigger_template import TriggerTemplate





T = TypeVar("T", bound="TriggerSpec")



@_attrs_define
class TriggerSpec:
    """
        Attributes:
            source (TriggerSourceType0 | TriggerSourceType1 | TriggerSourceType2):
            suspend (bool):
            template (TriggerTemplate):
     """

    source: TriggerSourceType0 | TriggerSourceType1 | TriggerSourceType2
    suspend: bool
    template: TriggerTemplate
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.trigger_source_type_0 import TriggerSourceType0
        from ..models.trigger_source_type_1 import TriggerSourceType1
        from ..models.trigger_source_type_2 import TriggerSourceType2
        from ..models.trigger_template import TriggerTemplate
        source: dict[str, Any]
        if isinstance(self.source, TriggerSourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, TriggerSourceType1):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()


        suspend = self.suspend

        template = self.template.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "source": source,
            "suspend": suspend,
            "template": template,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.trigger_source_type_0 import TriggerSourceType0
        from ..models.trigger_source_type_1 import TriggerSourceType1
        from ..models.trigger_source_type_2 import TriggerSourceType2
        from ..models.trigger_template import TriggerTemplate
        d = dict(src_dict)
        def _parse_source(data: object) -> TriggerSourceType0 | TriggerSourceType1 | TriggerSourceType2:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_trigger_source_type_0 = TriggerSourceType0.from_dict(data)



                return componentsschemas_trigger_source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_trigger_source_type_1 = TriggerSourceType1.from_dict(data)



                return componentsschemas_trigger_source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_trigger_source_type_2 = TriggerSourceType2.from_dict(data)



            return componentsschemas_trigger_source_type_2

        source = _parse_source(d.pop("source"))


        suspend = d.pop("suspend")

        template = TriggerTemplate.from_dict(d.pop("template"))




        trigger_spec = cls(
            source=source,
            suspend=suspend,
            template=template,
        )


        trigger_spec.additional_properties = d
        return trigger_spec

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
