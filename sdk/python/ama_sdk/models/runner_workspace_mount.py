from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_workspace_mount_type import RunnerWorkspaceMountType
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_git_credential import RunnerGitCredential
  from ..models.runner_workspace_file import RunnerWorkspaceFile





T = TypeVar("T", bound="RunnerWorkspaceMount")



@_attrs_define
class RunnerWorkspaceMount:
    """ 
        Attributes:
            name (str):  Example: source.
            type_ (RunnerWorkspaceMountType):  Example: git_repository.
            mount_path (str):  Example: /workspace/repos/saltbo/any-managed-agents.
            url (str | Unset):  Example: https://github.com/saltbo/any-managed-agents.git.
            ref (str | Unset):  Example: main.
            credential (RunnerGitCredential | Unset):
            memory_ref (str | Unset):  Example: ama://memories/memstore_abc123.
            description (None | str | Unset):
            read_only (bool | Unset):
            files (list[RunnerWorkspaceFile] | Unset):
     """

    name: str
    type_: RunnerWorkspaceMountType
    mount_path: str
    url: str | Unset = UNSET
    ref: str | Unset = UNSET
    credential: RunnerGitCredential | Unset = UNSET
    memory_ref: str | Unset = UNSET
    description: None | str | Unset = UNSET
    read_only: bool | Unset = UNSET
    files: list[RunnerWorkspaceFile] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_git_credential import RunnerGitCredential
        from ..models.runner_workspace_file import RunnerWorkspaceFile
        name = self.name

        type_ = self.type_.value

        mount_path = self.mount_path

        url = self.url

        ref = self.ref

        credential: dict[str, Any] | Unset = UNSET
        if not isinstance(self.credential, Unset):
            credential = self.credential.to_dict()

        memory_ref = self.memory_ref

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        read_only = self.read_only

        files: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.files, Unset):
            files = []
            for files_item_data in self.files:
                files_item = files_item_data.to_dict()
                files.append(files_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "name": name,
            "type": type_,
            "mountPath": mount_path,
        })
        if url is not UNSET:
            field_dict["url"] = url
        if ref is not UNSET:
            field_dict["ref"] = ref
        if credential is not UNSET:
            field_dict["credential"] = credential
        if memory_ref is not UNSET:
            field_dict["memoryRef"] = memory_ref
        if description is not UNSET:
            field_dict["description"] = description
        if read_only is not UNSET:
            field_dict["readOnly"] = read_only
        if files is not UNSET:
            field_dict["files"] = files

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_git_credential import RunnerGitCredential
        from ..models.runner_workspace_file import RunnerWorkspaceFile
        d = dict(src_dict)
        name = d.pop("name")

        type_ = RunnerWorkspaceMountType(d.pop("type"))




        mount_path = d.pop("mountPath")

        url = d.pop("url", UNSET)

        ref = d.pop("ref", UNSET)

        _credential = d.pop("credential", UNSET)
        credential: RunnerGitCredential | Unset
        if isinstance(_credential,  Unset):
            credential = UNSET
        else:
            credential = RunnerGitCredential.from_dict(_credential)




        memory_ref = d.pop("memoryRef", UNSET)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))


        read_only = d.pop("readOnly", UNSET)

        _files = d.pop("files", UNSET)
        files: list[RunnerWorkspaceFile] | Unset = UNSET
        if _files is not UNSET:
            files = []
            for files_item_data in _files:
                files_item = RunnerWorkspaceFile.from_dict(files_item_data)



                files.append(files_item)


        runner_workspace_mount = cls(
            name=name,
            type_=type_,
            mount_path=mount_path,
            url=url,
            ref=ref,
            credential=credential,
            memory_ref=memory_ref,
            description=description,
            read_only=read_only,
            files=files,
        )

        return runner_workspace_mount

