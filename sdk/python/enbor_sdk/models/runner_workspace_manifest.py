from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_workspace_manifest_root import RunnerWorkspaceManifestRoot
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_workspace_mount import RunnerWorkspaceMount





T = TypeVar("T", bound="RunnerWorkspaceManifest")



@_attrs_define
class RunnerWorkspaceManifest:
    """
        Attributes:
            root (RunnerWorkspaceManifestRoot):  Example: /workspace.
            mounts (list[RunnerWorkspaceMount]):
     """

    root: RunnerWorkspaceManifestRoot
    mounts: list[RunnerWorkspaceMount]





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_workspace_mount import RunnerWorkspaceMount
        root = self.root.value

        mounts = []
        for mounts_item_data in self.mounts:
            mounts_item = mounts_item_data.to_dict()
            mounts.append(mounts_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "root": root,
            "mounts": mounts,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_workspace_mount import RunnerWorkspaceMount
        d = dict(src_dict)
        root = RunnerWorkspaceManifestRoot(d.pop("root"))




        mounts = []
        _mounts = d.pop("mounts")
        for mounts_item_data in (_mounts):
            mounts_item = RunnerWorkspaceMount.from_dict(mounts_item_data)



            mounts.append(mounts_item)


        runner_workspace_manifest = cls(
            root=root,
            mounts=mounts,
        )

        return runner_workspace_manifest
