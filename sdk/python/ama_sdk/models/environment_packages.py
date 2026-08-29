from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.environment_packages_type import EnvironmentPackagesType
from typing import cast






T = TypeVar("T", bound="EnvironmentPackages")



@_attrs_define
class EnvironmentPackages:
    """
        Attributes:
            type_ (EnvironmentPackagesType):
            apt (list[str]):
            cargo (list[str]):
            gem (list[str]):
            go (list[str]):
            npm (list[str]):
            pip (list[str]):
            webi (list[str]):
     """

    type_: EnvironmentPackagesType
    apt: list[str]
    cargo: list[str]
    gem: list[str]
    go: list[str]
    npm: list[str]
    pip: list[str]
    webi: list[str]





    def to_dict(self) -> dict[str, Any]:
        type_ = self.type_.value

        apt = self.apt



        cargo = self.cargo



        gem = self.gem



        go = self.go



        npm = self.npm



        pip = self.pip



        webi = self.webi




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "type": type_,
            "apt": apt,
            "cargo": cargo,
            "gem": gem,
            "go": go,
            "npm": npm,
            "pip": pip,
            "webi": webi,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        type_ = EnvironmentPackagesType(d.pop("type"))




        apt = cast(list[str], d.pop("apt"))


        cargo = cast(list[str], d.pop("cargo"))


        gem = cast(list[str], d.pop("gem"))


        go = cast(list[str], d.pop("go"))


        npm = cast(list[str], d.pop("npm"))


        pip = cast(list[str], d.pop("pip"))


        webi = cast(list[str], d.pop("webi"))


        environment_packages = cls(
            type_=type_,
            apt=apt,
            cargo=cargo,
            gem=gem,
            go=go,
            npm=npm,
            pip=pip,
            webi=webi,
        )

        return environment_packages
