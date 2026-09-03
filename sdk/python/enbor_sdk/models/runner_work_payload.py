from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_work_payload_protocol import RunnerWorkPayloadProtocol
from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
  from ..models.runner_runtime_requirement import RunnerRuntimeRequirement
  from ..models.runner_tool_call import RunnerToolCall
  from ..models.runner_work_payload_agent_snapshot import RunnerWorkPayloadAgentSnapshot
  from ..models.runner_work_payload_env import RunnerWorkPayloadEnv
  from ..models.runner_work_payload_environment_snapshot_type_0 import RunnerWorkPayloadEnvironmentSnapshotType0
  from ..models.runner_work_payload_input import RunnerWorkPayloadInput
  from ..models.runner_work_payload_runtime_config import RunnerWorkPayloadRuntimeConfig
  from ..models.runner_workspace_manifest import RunnerWorkspaceManifest





T = TypeVar("T", bound="RunnerWorkPayload")



@_attrs_define
class RunnerWorkPayload:
    """
        Attributes:
            protocol (RunnerWorkPayloadProtocol | Unset):
            type_ (str | Unset):  Example: session.start.
            session_id (str | Unset):  Example: 0195f5d6-7c20-7000-8000-00000000000e.
            hosting_mode (str | Unset):  Example: self_hosted.
            runtime (str | Unset):  Example: codex.
            runtime_config (RunnerWorkPayloadRuntimeConfig | Unset):
            provider (str | Unset):  Example: provider_codex.
            model (str | Unset):  Example: gpt-5.3-codex.
            agent_snapshot (RunnerWorkPayloadAgentSnapshot | Unset):
            environment_snapshot (None | RunnerWorkPayloadEnvironmentSnapshotType0 | Unset):
            runtime_driver (str | Unset):  Example: codex-self-hosted.
            runtime_requirement (RunnerRuntimeRequirement | Unset):
            env (RunnerWorkPayloadEnv | Unset):
            workspace_manifest (RunnerWorkspaceManifest | Unset):
            prompt (None | str | Unset):
            resume (bool | Unset):
            resume_token (None | str | Unset):
            approved (bool | Unset):
            tool_call_id (str | Unset):  Example: call_abc123.
            tool_name (str | Unset):  Example: bash.
            input_ (RunnerWorkPayloadInput | Unset):
            tool_call (RunnerToolCall | Unset):
     """

    protocol: RunnerWorkPayloadProtocol | Unset = UNSET
    type_: str | Unset = UNSET
    session_id: str | Unset = UNSET
    hosting_mode: str | Unset = UNSET
    runtime: str | Unset = UNSET
    runtime_config: RunnerWorkPayloadRuntimeConfig | Unset = UNSET
    provider: str | Unset = UNSET
    model: str | Unset = UNSET
    agent_snapshot: RunnerWorkPayloadAgentSnapshot | Unset = UNSET
    environment_snapshot: None | RunnerWorkPayloadEnvironmentSnapshotType0 | Unset = UNSET
    runtime_driver: str | Unset = UNSET
    runtime_requirement: RunnerRuntimeRequirement | Unset = UNSET
    env: RunnerWorkPayloadEnv | Unset = UNSET
    workspace_manifest: RunnerWorkspaceManifest | Unset = UNSET
    prompt: None | str | Unset = UNSET
    resume: bool | Unset = UNSET
    resume_token: None | str | Unset = UNSET
    approved: bool | Unset = UNSET
    tool_call_id: str | Unset = UNSET
    tool_name: str | Unset = UNSET
    input_: RunnerWorkPayloadInput | Unset = UNSET
    tool_call: RunnerToolCall | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        from ..models.runner_runtime_requirement import RunnerRuntimeRequirement
        from ..models.runner_tool_call import RunnerToolCall
        from ..models.runner_work_payload_agent_snapshot import RunnerWorkPayloadAgentSnapshot
        from ..models.runner_work_payload_env import RunnerWorkPayloadEnv
        from ..models.runner_work_payload_environment_snapshot_type_0 import RunnerWorkPayloadEnvironmentSnapshotType0
        from ..models.runner_work_payload_input import RunnerWorkPayloadInput
        from ..models.runner_work_payload_runtime_config import RunnerWorkPayloadRuntimeConfig
        from ..models.runner_workspace_manifest import RunnerWorkspaceManifest
        protocol: str | Unset = UNSET
        if not isinstance(self.protocol, Unset):
            protocol = self.protocol.value


        type_ = self.type_

        session_id = self.session_id

        hosting_mode = self.hosting_mode

        runtime = self.runtime

        runtime_config: dict[str, Any] | Unset = UNSET
        if not isinstance(self.runtime_config, Unset):
            runtime_config = self.runtime_config.to_dict()

        provider = self.provider

        model = self.model

        agent_snapshot: dict[str, Any] | Unset = UNSET
        if not isinstance(self.agent_snapshot, Unset):
            agent_snapshot = self.agent_snapshot.to_dict()

        environment_snapshot: dict[str, Any] | None | Unset
        if isinstance(self.environment_snapshot, Unset):
            environment_snapshot = UNSET
        elif isinstance(self.environment_snapshot, RunnerWorkPayloadEnvironmentSnapshotType0):
            environment_snapshot = self.environment_snapshot.to_dict()
        else:
            environment_snapshot = self.environment_snapshot

        runtime_driver = self.runtime_driver

        runtime_requirement: dict[str, Any] | Unset = UNSET
        if not isinstance(self.runtime_requirement, Unset):
            runtime_requirement = self.runtime_requirement.to_dict()

        env: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env, Unset):
            env = self.env.to_dict()

        workspace_manifest: dict[str, Any] | Unset = UNSET
        if not isinstance(self.workspace_manifest, Unset):
            workspace_manifest = self.workspace_manifest.to_dict()

        prompt: None | str | Unset
        if isinstance(self.prompt, Unset):
            prompt = UNSET
        else:
            prompt = self.prompt

        resume = self.resume

        resume_token: None | str | Unset
        if isinstance(self.resume_token, Unset):
            resume_token = UNSET
        else:
            resume_token = self.resume_token

        approved = self.approved

        tool_call_id = self.tool_call_id

        tool_name = self.tool_name

        input_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.input_, Unset):
            input_ = self.input_.to_dict()

        tool_call: dict[str, Any] | Unset = UNSET
        if not isinstance(self.tool_call, Unset):
            tool_call = self.tool_call.to_dict()


        field_dict: dict[str, Any] = {}

        field_dict.update({
        })
        if protocol is not UNSET:
            field_dict["protocol"] = protocol
        if type_ is not UNSET:
            field_dict["type"] = type_
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id
        if hosting_mode is not UNSET:
            field_dict["hostingMode"] = hosting_mode
        if runtime is not UNSET:
            field_dict["runtime"] = runtime
        if runtime_config is not UNSET:
            field_dict["runtimeConfig"] = runtime_config
        if provider is not UNSET:
            field_dict["provider"] = provider
        if model is not UNSET:
            field_dict["model"] = model
        if agent_snapshot is not UNSET:
            field_dict["agentSnapshot"] = agent_snapshot
        if environment_snapshot is not UNSET:
            field_dict["environmentSnapshot"] = environment_snapshot
        if runtime_driver is not UNSET:
            field_dict["runtimeDriver"] = runtime_driver
        if runtime_requirement is not UNSET:
            field_dict["runtimeRequirement"] = runtime_requirement
        if env is not UNSET:
            field_dict["env"] = env
        if workspace_manifest is not UNSET:
            field_dict["workspaceManifest"] = workspace_manifest
        if prompt is not UNSET:
            field_dict["prompt"] = prompt
        if resume is not UNSET:
            field_dict["resume"] = resume
        if resume_token is not UNSET:
            field_dict["resumeToken"] = resume_token
        if approved is not UNSET:
            field_dict["approved"] = approved
        if tool_call_id is not UNSET:
            field_dict["toolCallId"] = tool_call_id
        if tool_name is not UNSET:
            field_dict["toolName"] = tool_name
        if input_ is not UNSET:
            field_dict["input"] = input_
        if tool_call is not UNSET:
            field_dict["toolCall"] = tool_call

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.runner_runtime_requirement import RunnerRuntimeRequirement
        from ..models.runner_tool_call import RunnerToolCall
        from ..models.runner_work_payload_agent_snapshot import RunnerWorkPayloadAgentSnapshot
        from ..models.runner_work_payload_env import RunnerWorkPayloadEnv
        from ..models.runner_work_payload_environment_snapshot_type_0 import RunnerWorkPayloadEnvironmentSnapshotType0
        from ..models.runner_work_payload_input import RunnerWorkPayloadInput
        from ..models.runner_work_payload_runtime_config import RunnerWorkPayloadRuntimeConfig
        from ..models.runner_workspace_manifest import RunnerWorkspaceManifest
        d = dict(src_dict)
        _protocol = d.pop("protocol", UNSET)
        protocol: RunnerWorkPayloadProtocol | Unset
        if isinstance(_protocol,  Unset):
            protocol = UNSET
        else:
            protocol = RunnerWorkPayloadProtocol(_protocol)




        type_ = d.pop("type", UNSET)

        session_id = d.pop("sessionId", UNSET)

        hosting_mode = d.pop("hostingMode", UNSET)

        runtime = d.pop("runtime", UNSET)

        _runtime_config = d.pop("runtimeConfig", UNSET)
        runtime_config: RunnerWorkPayloadRuntimeConfig | Unset
        if isinstance(_runtime_config,  Unset):
            runtime_config = UNSET
        else:
            runtime_config = RunnerWorkPayloadRuntimeConfig.from_dict(_runtime_config)




        provider = d.pop("provider", UNSET)

        model = d.pop("model", UNSET)

        _agent_snapshot = d.pop("agentSnapshot", UNSET)
        agent_snapshot: RunnerWorkPayloadAgentSnapshot | Unset
        if isinstance(_agent_snapshot,  Unset):
            agent_snapshot = UNSET
        else:
            agent_snapshot = RunnerWorkPayloadAgentSnapshot.from_dict(_agent_snapshot)




        def _parse_environment_snapshot(data: object) -> None | RunnerWorkPayloadEnvironmentSnapshotType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                environment_snapshot_type_0 = RunnerWorkPayloadEnvironmentSnapshotType0.from_dict(data)



                return environment_snapshot_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | RunnerWorkPayloadEnvironmentSnapshotType0 | Unset, data)

        environment_snapshot = _parse_environment_snapshot(d.pop("environmentSnapshot", UNSET))


        runtime_driver = d.pop("runtimeDriver", UNSET)

        _runtime_requirement = d.pop("runtimeRequirement", UNSET)
        runtime_requirement: RunnerRuntimeRequirement | Unset
        if isinstance(_runtime_requirement,  Unset):
            runtime_requirement = UNSET
        else:
            runtime_requirement = RunnerRuntimeRequirement.from_dict(_runtime_requirement)




        _env = d.pop("env", UNSET)
        env: RunnerWorkPayloadEnv | Unset
        if isinstance(_env,  Unset):
            env = UNSET
        else:
            env = RunnerWorkPayloadEnv.from_dict(_env)




        _workspace_manifest = d.pop("workspaceManifest", UNSET)
        workspace_manifest: RunnerWorkspaceManifest | Unset
        if isinstance(_workspace_manifest,  Unset):
            workspace_manifest = UNSET
        else:
            workspace_manifest = RunnerWorkspaceManifest.from_dict(_workspace_manifest)




        def _parse_prompt(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        prompt = _parse_prompt(d.pop("prompt", UNSET))


        resume = d.pop("resume", UNSET)

        def _parse_resume_token(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        resume_token = _parse_resume_token(d.pop("resumeToken", UNSET))


        approved = d.pop("approved", UNSET)

        tool_call_id = d.pop("toolCallId", UNSET)

        tool_name = d.pop("toolName", UNSET)

        _input_ = d.pop("input", UNSET)
        input_: RunnerWorkPayloadInput | Unset
        if isinstance(_input_,  Unset):
            input_ = UNSET
        else:
            input_ = RunnerWorkPayloadInput.from_dict(_input_)




        _tool_call = d.pop("toolCall", UNSET)
        tool_call: RunnerToolCall | Unset
        if isinstance(_tool_call,  Unset):
            tool_call = UNSET
        else:
            tool_call = RunnerToolCall.from_dict(_tool_call)




        runner_work_payload = cls(
            protocol=protocol,
            type_=type_,
            session_id=session_id,
            hosting_mode=hosting_mode,
            runtime=runtime,
            runtime_config=runtime_config,
            provider=provider,
            model=model,
            agent_snapshot=agent_snapshot,
            environment_snapshot=environment_snapshot,
            runtime_driver=runtime_driver,
            runtime_requirement=runtime_requirement,
            env=env,
            workspace_manifest=workspace_manifest,
            prompt=prompt,
            resume=resume,
            resume_token=resume_token,
            approved=approved,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            input_=input_,
            tool_call=tool_call,
        )

        return runner_work_payload
