from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runtime_name import RuntimeName
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.empty_dir_volume import EmptyDirVolume
  from ..models.env_from_entry import EnvFromEntry
  from ..models.execution_env import ExecutionEnv
  from ..models.git_repository_volume import GitRepositoryVolume
  from ..models.memory_volume import MemoryVolume
  from ..models.secret_volume import SecretVolume
  from ..models.volume_mount import VolumeMount





T = TypeVar("T", bound="ExecutionSpecInput")



@_attrs_define
class ExecutionSpecInput:
    """
        Attributes:
            agent_id (str):  Example: 0195f5d6-7c20-7000-8000-000000000002.
            environment_id (None | str | Unset):  Example: 0195f5d6-7c20-7000-8000-000000000005.
            runtime (RuntimeName | Unset):  Example: codex.
            env (ExecutionEnv | Unset):  Example: {'AK_API_URL': 'https://ak.example.com'}.
            env_from (list[EnvFromEntry] | Unset):
            volumes (list[EmptyDirVolume | GitRepositoryVolume | MemoryVolume | SecretVolume] | Unset):
            volume_mounts (list[VolumeMount] | Unset):
     """

    agent_id: str
    environment_id: None | str | Unset = UNSET
    runtime: RuntimeName | Unset = UNSET
    env: ExecutionEnv | Unset = UNSET
    env_from: list[EnvFromEntry] | Unset = UNSET
    volumes: list[EmptyDirVolume | GitRepositoryVolume | MemoryVolume | SecretVolume] | Unset = UNSET
    volume_mounts: list[VolumeMount] | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.empty_dir_volume import EmptyDirVolume
        from ..models.env_from_entry import EnvFromEntry
        from ..models.execution_env import ExecutionEnv
        from ..models.git_repository_volume import GitRepositoryVolume
        from ..models.memory_volume import MemoryVolume
        from ..models.secret_volume import SecretVolume
        from ..models.volume_mount import VolumeMount
        agent_id = self.agent_id

        environment_id: None | str | Unset
        if isinstance(self.environment_id, Unset):
            environment_id = UNSET
        else:
            environment_id = self.environment_id

        runtime: str | Unset = UNSET
        if not isinstance(self.runtime, Unset):
            runtime = self.runtime.value


        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        env_from: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.env_from, Unset):
            env_from = []
            for env_from_item_data in self.env_from:
                env_from_item = env_from_item_data.to_dict()
                env_from.append(env_from_item)



        volumes: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.volumes, Unset):
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



        volume_mounts: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.volume_mounts, Unset):
            volume_mounts = []
            for volume_mounts_item_data in self.volume_mounts:
                volume_mounts_item = volume_mounts_item_data.to_dict()
                volume_mounts.append(volume_mounts_item)




        field_dict: dict[str, Any] = {}

        field_dict.update({
            "agentId": agent_id,
        })
        if environment_id is not UNSET:
            field_dict["environmentId"] = environment_id
        if runtime is not UNSET:
            field_dict["runtime"] = runtime
        if env is not UNSET:
            field_dict["env"] = env
        if env_from is not UNSET:
            field_dict["envFrom"] = env_from
        if volumes is not UNSET:
            field_dict["volumes"] = volumes
        if volume_mounts is not UNSET:
            field_dict["volumeMounts"] = volume_mounts

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

        def _parse_environment_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        environment_id = _parse_environment_id(d.pop("environmentId", UNSET))


        _runtime = d.pop("runtime", UNSET)
        runtime: RuntimeName | Unset
        if isinstance(_runtime,  Unset):
            runtime = UNSET
        else:
            runtime = RuntimeName(_runtime)




        _env = d.pop("env", UNSET)
        env: ExecutionEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = ExecutionEnv.from_dict(_env)




        _env_from = d.pop("envFrom", UNSET)
        env_from: list[EnvFromEntry] | Unset = UNSET
        if _env_from is not UNSET:
            env_from = []
            for env_from_item_data in _env_from:
                env_from_item = EnvFromEntry.from_dict(env_from_item_data)



                env_from.append(env_from_item)


        _volumes = d.pop("volumes", UNSET)
        volumes: list[EmptyDirVolume | GitRepositoryVolume | MemoryVolume | SecretVolume] | Unset = UNSET
        if _volumes is not UNSET:
            volumes = []
            for volumes_item_data in _volumes:
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


        _volume_mounts = d.pop("volumeMounts", UNSET)
        volume_mounts: list[VolumeMount] | Unset = UNSET
        if _volume_mounts is not UNSET:
            volume_mounts = []
            for volume_mounts_item_data in _volume_mounts:
                volume_mounts_item = VolumeMount.from_dict(volume_mounts_item_data)



                volume_mounts.append(volume_mounts_item)


        execution_spec_input = cls(
            agent_id=agent_id,
            environment_id=environment_id,
            runtime=runtime,
            env=env,
            env_from=env_from,
            volumes=volumes,
            volume_mounts=volume_mounts,
        )

        return execution_spec_input
