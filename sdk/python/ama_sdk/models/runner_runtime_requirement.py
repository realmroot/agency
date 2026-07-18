from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..models.runner_runtime_requirement_runtime import RunnerRuntimeRequirementRuntime
from ..types import UNSET, Unset






T = TypeVar("T", bound="RunnerRuntimeRequirement")



@_attrs_define
class RunnerRuntimeRequirement:
    """ 
        Attributes:
            runtime (RunnerRuntimeRequirementRuntime):
            model (str | Unset):
     """

    runtime: RunnerRuntimeRequirementRuntime
    model: str | Unset = UNSET





    def to_dict(self) -> dict[str, Any]:
        runtime = self.runtime.value

        model = self.model


        field_dict: dict[str, Any] = {}

        field_dict.update({
            "runtime": runtime,
        })
        if model is not UNSET:
            field_dict["model"] = model

        return field_dict



    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        runtime = RunnerRuntimeRequirementRuntime(d.pop("runtime"))




        model = d.pop("model", UNSET)

        runner_runtime_requirement = cls(
            runtime=runtime,
            model=model,
        )

        return runner_runtime_requirement

