from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
  from ..models.auth_organization import AuthOrganization
  from ..models.auth_project import AuthProject
  from ..models.auth_user import AuthUser





T = TypeVar("T", bound="AuthSession")



@_attrs_define
class AuthSession:
    """ 
        Attributes:
            user (AuthUser):
            organization (AuthOrganization):
            project (AuthProject):
     """

    user: AuthUser
    organization: AuthOrganization
    project: AuthProject
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)





    def to_dict(self) -> dict[str, Any]:
        from ..models.auth_organization import AuthOrganization
        from ..models.auth_project import AuthProject
        from ..models.auth_user import AuthUser
        user = self.user.to_dict()

        organization = self.organization.to_dict()

        project = self.project.to_dict()


        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({
            "user": user,
            "organization": organization,
            "project": project,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.auth_organization import AuthOrganization
        from ..models.auth_project import AuthProject
        from ..models.auth_user import AuthUser
        d = dict(src_dict)
        user = AuthUser.from_dict(d.pop("user"))




        organization = AuthOrganization.from_dict(d.pop("organization"))




        project = AuthProject.from_dict(d.pop("project"))




        auth_session = cls(
            user=user,
            organization=organization,
            project=project,
        )


        auth_session.additional_properties = d
        return auth_session

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
