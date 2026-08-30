from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime_name import RuntimeName
from typing import cast

if TYPE_CHECKING:
  from ..models.empty_dir_volume import EmptyDirVolume
  from ..models.env_from_entry import EnvFromEntry
  from ..models.execution_env import ExecutionEnv
  from ..models.git_repository_volume import GitRepositoryVolume
  from ..models.memory_volume import MemoryVolume
  from ..models.secret_volume import SecretVolume
  from ..models.volume_mount import VolumeMount





T = TypeVar("T", bound="TriggerTemplateSpec")



@_attrs_define
class TriggerTemplateSpec:
    """
        Attributes:
            agent_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000002.
            environment_id (None | str):  Example: 0195f5d6-7c20-7000-8000-000000000005.
            runtime (RuntimeName):  Example: codex.
            env (ExecutionEnv):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            env_from (list[EnvFromEntry]):
            volumes (list[EmptyDirVolume | GitRepositoryVolume | MemoryVolume | SecretVolume]):
            volume_mounts (list[VolumeMount]):
            prompt_template (str):  Example: Research current Canadian banking bonus offers..
     """

    agent_id: str
    environment_id: None | str
    runtime: RuntimeName
    env: ExecutionEnv
    env_from: list[EnvFromEntry]
    volumes: list[EmptyDirVolume | GitRepositoryVolume | MemoryVolume | SecretVolume]
    volume_mounts: list[VolumeMount]
    prompt_template: str





    def to_dict(self) -> dict[str, Any]:
        from ..models.empty_dir_volume import EmptyDirVolume
        from ..models.env_from_entry import EnvFromEntry
        from ..models.execution_env import ExecutionEnv
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
        agent_id = self.agent_id

        environment_id: None | str
        environment_id = self.environment_id

        runtime = self.runtime.value

        env = self.env.to_dict()

        env_from = []
        for env_from_item_data in self.env_from:
            env_from_item = env_from_item_data.to_dict()
            env_from.append(env_from_item)



        volumes = []
        for volumes_item_data in self.volumes:
            volumes_item: dict[str, Any]
            if isinstance(volumes_item_data, SecretVolume):
                volumes_item = volumes_item_data.to_dict()
            elif isinstance(volumes_item_data, GitRepositoryVolume):
                volumes_item = volumes_item_data.to_dict()
            elif isinstance(volumes_item_data, MemoryVolume):
                volumes_item = volumes_item_data.to_dict()
            else:
                volumes_item = volumes_item_data.to_dict()

            volumes.append(volumes_item)



        volume_mounts = []
        for volume_mounts_item_data in self.volume_mounts:
            volume_mounts_item = volume_mounts_item_data.to_dict()
            volume_mounts.append(volume_mounts_item)



        prompt_template = self.prompt_template


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
            "environmentId": environment_id,
            "runtime": runtime,
            "env": env,
            "envFrom": env_from,
            "volumes": volumes,
            "volumeMounts": volume_mounts,
            "promptTemplate": prompt_template,
        })

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.empty_dir_volume import EmptyDirVolume
        from ..models.env_from_entry import EnvFromEntry
        from ..models.execution_env import ExecutionEnv
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
        d = dict(src_dict)
        agent_id = d.pop("agentId")

        def _parse_environment_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        environment_id = _parse_environment_id(d.pop("environmentId"))


        runtime = RuntimeName(d.pop("runtime"))




        env = ExecutionEnv.from_dict(d.pop("env"))




        env_from = []
        _env_from = d.pop("envFrom")
        for env_from_item_data in (_env_from):
            env_from_item = EnvFromEntry.from_dict(env_from_item_data)



            env_from.append(env_from_item)


        volumes = []
        _volumes = d.pop("volumes")
        for volumes_item_data in (_volumes):
            def _parse_volumes_item(data: object) -> EmptyDirVolume | GitRepositoryVolume | MemoryVolume | SecretVolume:
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_volume_type_0 = SecretVolume.from_dict(data)



                    return componentsschemas_volume_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_volume_type_1 = GitRepositoryVolume.from_dict(data)



                    return componentsschemas_volume_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_volume_type_2 = MemoryVolume.from_dict(data)



                    return componentsschemas_volume_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_volume_type_3 = EmptyDirVolume.from_dict(data)



                return componentsschemas_volume_type_3

            volumes_item = _parse_volumes_item(volumes_item_data)

            volumes.append(volumes_item)


        volume_mounts = []
        _volume_mounts = d.pop("volumeMounts")
        for volume_mounts_item_data in (_volume_mounts):
            volume_mounts_item = VolumeMount.from_dict(volume_mounts_item_data)



            volume_mounts.append(volume_mounts_item)


        prompt_template = d.pop("promptTemplate")

        trigger_template_spec = cls(
            agent_id=agent_id,
            environment_id=environment_id,
            runtime=runtime,
            env=env,
            env_from=env_from,
            volumes=volumes,
            volume_mounts=volume_mounts,
            prompt_template=prompt_template,
        )

        return trigger_template_spec
