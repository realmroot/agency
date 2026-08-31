from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast
import datetime

if TYPE_CHECKING:
  from ..models.create_trigger_request_spec_source_type_0 import CreateTriggerRequestSpecSourceType0
  from ..models.create_trigger_request_spec_source_type_1 import CreateTriggerRequestSpecSourceType1
  from ..models.create_trigger_request_spec_source_type_2 import CreateTriggerRequestSpecSourceType2
  from ..models.create_trigger_request_spec_template import CreateTriggerRequestSpecTemplate





T = TypeVar("T", bound="CreateTriggerRequestSpec")



@_attrs_define
class CreateTriggerRequestSpec:
    """
        Attributes:
            source (CreateTriggerRequestSpecSourceType0 | CreateTriggerRequestSpecSourceType1 |
                CreateTriggerRequestSpecSourceType2):
            template (CreateTriggerRequestSpecTemplate):
            suspend (bool | Unset):
            next_due_at (datetime.datetime | Unset):  Example: 2026-05-26T12:00:00.000Z.
     """

    source: CreateTriggerRequestSpecSourceType0 | CreateTriggerRequestSpecSourceType1 | CreateTriggerRequestSpecSourceType2
    template: CreateTriggerRequestSpecTemplate
    suspend: bool | Unset = UNSET
    next_due_at: datetime.datetime | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.create_trigger_request_spec_source_type_0 import CreateTriggerRequestSpecSourceType0
        from ..models.create_trigger_request_spec_source_type_1 import CreateTriggerRequestSpecSourceType1
        from ..models.create_trigger_request_spec_source_type_2 import CreateTriggerRequestSpecSourceType2
        from ..models.create_trigger_request_spec_template import CreateTriggerRequestSpecTemplate
        source: dict[str, Any]
        if isinstance(self.source, CreateTriggerRequestSpecSourceType0):
            source = self.source.to_dict()
        elif isinstance(self.source, CreateTriggerRequestSpecSourceType1):
            source = self.source.to_dict()
        else:
            source = self.source.to_dict()


        template = self.template.to_dict()

        suspend = self.suspend

        next_due_at: str | Unset = UNSET
        if not isinstance(self.next_due_at, Unset):
            next_due_at = self.next_due_at.isoformat()


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "source": source,
            "template": template,
        })
        if suspend is not UNSET:
            field_dict["suspend"] = suspend
        if next_due_at is not UNSET:
            field_dict["nextDueAt"] = next_due_at

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_trigger_request_spec_source_type_0 import CreateTriggerRequestSpecSourceType0
        from ..models.create_trigger_request_spec_source_type_1 import CreateTriggerRequestSpecSourceType1
        from ..models.create_trigger_request_spec_source_type_2 import CreateTriggerRequestSpecSourceType2
        from ..models.create_trigger_request_spec_template import CreateTriggerRequestSpecTemplate
        d = dict(src_dict)
        def _parse_source(data: object) -> CreateTriggerRequestSpecSourceType0 | CreateTriggerRequestSpecSourceType1 | CreateTriggerRequestSpecSourceType2:
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_0 = CreateTriggerRequestSpecSourceType0.from_dict(data)



                return source_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                source_type_1 = CreateTriggerRequestSpecSourceType1.from_dict(data)



                return source_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            source_type_2 = CreateTriggerRequestSpecSourceType2.from_dict(data)



            return source_type_2

        source = _parse_source(d.pop("source"))


        template = CreateTriggerRequestSpecTemplate.from_dict(d.pop("template"))




        suspend = d.pop("suspend", UNSET)

        _next_due_at = d.pop("nextDueAt", UNSET)
        next_due_at: datetime.datetime | Unset
        if isinstance(_next_due_at,  Unset):
            next_due_at = UNSET
        else:
            next_due_at = datetime.datetime.fromisoformat(_next_due_at)




        create_trigger_request_spec = cls(
            source=source,
            template=template,
            suspend=suspend,
            next_due_at=next_due_at,
        )

        return create_trigger_request_spec
