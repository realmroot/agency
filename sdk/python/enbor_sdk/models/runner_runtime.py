from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_runtime_state import RunnerRuntimeState
from ..types import UNSET, Unset
from typing import cast






T = TypeVar("T", bound="RunnerRuntime")



@_attrs_define
class RunnerRuntime:
    """
        Attributes:
            runtime (str):  Example: codex.
            models (list[str]):  Example: ['gpt-5.3-codex'].
            state (RunnerRuntimeState):  Example: ready.
            version (str | Unset):  Example: 0.42.0.
            detail (str | Unset):  Example: host CLI enumerated 2 models.
     """

    runtime: str
    models: list[str]
    state: RunnerRuntimeState
    version: str | Unset = UNSET
    detail: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        runtime = self.runtime

        models = self.models



        state = self.state.value

        version = self.version

        detail = self.detail


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "runtime": runtime,
            "models": models,
            "state": state,
        })
        if version is not UNSET:
            field_dict["version"] = version
        if detail is not UNSET:
            field_dict["detail"] = detail

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        runtime = d.pop("runtime")

        models = cast(list[str], d.pop("models"))


        state = RunnerRuntimeState(d.pop("state"))




        version = d.pop("version", UNSET)

        detail = d.pop("detail", UNSET)

        runner_runtime = cls(
            runtime=runtime,
            models=models,
            state=state,
            version=version,
            detail=detail,
        )

        return runner_runtime
