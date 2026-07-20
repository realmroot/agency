from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.http_trigger_concurrency_mode import HttpTriggerConcurrencyMode






T = TypeVar("T", bound="HttpTriggerConcurrency")



@_attrs_define
class HttpTriggerConcurrency:
    """ 
        Attributes:
            mode (HttpTriggerConcurrencyMode):
     """

    mode: HttpTriggerConcurrencyMode





    def to_dict(self) -> dict[str, Any]:
        mode = self.mode.value


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "mode": mode,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        mode = HttpTriggerConcurrencyMode(d.pop("mode"))




        http_trigger_concurrency = cls(
            mode=mode,
        )

        return http_trigger_concurrency

