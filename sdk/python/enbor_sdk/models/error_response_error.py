from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.error_response_error_details import ErrorResponseErrorDetails





T = TypeVar("T", bound="ErrorResponseError")



@_attrs_define
class ErrorResponseError:
    """
        Attributes:
            type_ (str):  Example: validation_error.
            message (str):  Example: Invalid request.
            issues (list[Any] | Unset):
            details (ErrorResponseErrorDetails | Unset):
     """

    type_: str
    message: str
    issues: list[Any] | Unset = UNSET
    details: ErrorResponseErrorDetails | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.error_response_error_details import ErrorResponseErrorDetails
        type_ = self.type_

        message = self.message

        issues: list[Any] | Unset = UNSET
        if not isinstance(self.issues, Unset):
            issues = self.issues



        details: dict[str, Any] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = self.details.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "type": type_,
            "message": message,
        })
        if issues is not UNSET:
            field_dict["issues"] = issues
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.error_response_error_details import ErrorResponseErrorDetails
        d = dict(src_dict)
        type_ = d.pop("type")

        message = d.pop("message")

        issues = cast(list[Any], d.pop("issues", UNSET))


        _details = d.pop("details", UNSET)
        details: ErrorResponseErrorDetails | Unset
        if isinstance(_details,  Unset):
            details = UNSET
        else:
            details = ErrorResponseErrorDetails.from_dict(_details)




        error_response_error = cls(
            type_=type_,
            message=message,
            issues=issues,
            details=details,
        )


        error_response_error.additional_properties = d
        return error_response_error

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
