"""Reproducibility manifest schema. Required core fields; every section accepts extra keys so new
architectures/frameworks/hyperparameters/metrics need no schema change. Null values == missing."""
from typing import Dict, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = "modelledger/1.0"
Num = Union[int, float]


class _Section(BaseModel):
    model_config = ConfigDict(extra="allow")


class ModelInfo(_Section):
    name: str = Field(min_length=1, max_length=128)
    version: str = Field(min_length=1, max_length=64)
    architecture: str = Field(min_length=1, max_length=128)
    framework: str = Field(min_length=1, max_length=64)
    framework_version: Optional[str] = None


class Training(_Section):
    optimizer: Optional[str] = None
    learning_rate: Optional[Num] = None
    batch_size: Optional[int] = None
    epochs: Optional[int] = None
    random_seed: Optional[int] = None


class Dataset(_Section):
    name: Optional[str] = None
    version: Optional[str] = None


class Evaluation(_Section):
    """Free-form metrics: any extra key must be a number (or null/absent)."""
    accuracy: Optional[Num] = None
    f1_score: Optional[Num] = None
    eer: Optional[Num] = None

    @field_validator("*", mode="before")
    @classmethod
    def _numeric(cls, v):
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))):
            raise ValueError("metrics must be numbers")
        return v


class Environment(_Section):
    python_version: Optional[str] = None
    hardware: Optional[str] = None


class Artifacts(_Section):
    model_sha256: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    filename: Optional[str] = None
    size_bytes: Optional[int] = None
    artifact_cid: Optional[str] = None
    code_commit: Optional[str] = None


class Manifest(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: str = SCHEMA_VERSION
    model: ModelInfo
    training: Training = Training()
    dataset: Dataset = Dataset()
    evaluation: Evaluation = Evaluation()
    environment: Environment = Environment()
    artifacts: Artifacts = Artifacts()
    notes: Optional[str] = None


def validate_manifest(raw: dict) -> dict:
    """Validate and return a plain dict (extras preserved, nulls kept; canonicalization drops them)."""
    return Manifest.model_validate(raw).model_dump(mode="json")
