"""Pydantic models for events and configuration."""

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ServerConfig(BaseModel):
    """Server configuration.

    Security note: Default host 127.0.0.1 binds to localhost only for security.
    For local network access, set host to "0.0.0.0" in config.
    Network access is protected by API key authentication.
    """

    host: str = Field(default="127.0.0.1", description="Bind address")
    port: int = Field(default=8765, ge=1, le=65535, description="Server port")
    api_keys: list[str] = Field(..., min_length=1, description="Valid API keys for auth")

    @field_validator("api_keys")
    @classmethod
    def validate_api_keys_unique(cls, v: list[str]) -> list[str]:
        """Ensure API keys are unique."""
        if len(v) != len(set(v)):
            raise ValueError("API keys must be unique")
        return v


class DatabaseConfig(BaseModel):
    """Database configuration."""

    path: str = Field(default="~/.local/share/argus/events.db", description="SQLite database path")
    journal_mode: Literal["WAL", "DELETE", "TRUNCATE", "PERSIST", "MEMORY", "OFF"] = Field(
        default="WAL", description="SQLite journal mode"
    )

    @field_validator("path")
    @classmethod
    def expand_path(cls, v: str) -> str:
        """Expand and normalize path, resolving symlinks."""
        # Expand tilde and resolve to absolute path
        expanded = Path(v).expanduser().resolve()
        return str(expanded)


class RetentionConfig(BaseModel):
    """Event retention configuration."""

    retention_days: int = Field(default=30, ge=1, description="Delete events older than N days")
    cleanup_time: str = Field(default="03:00", description="When to run cleanup (HH:MM)")
    vacuum_after_cleanup: bool = Field(default=True, description="Run VACUUM after cleanup")

    @field_validator("cleanup_time")
    @classmethod
    def validate_cleanup_time_format(cls, v: str) -> str:
        """Validate cleanup_time format is HH:MM."""
        parts = v.split(":")
        if len(parts) != 2:
            raise ValueError("cleanup_time must be in HH:MM format")
        try:
            hour, minute = int(parts[0]), int(parts[1])
            if not (0 <= hour <= 23 and 0 <= minute <= 59):
                raise ValueError("Invalid time values")
        except ValueError as e:
            raise ValueError("cleanup_time must be valid 24-hour time (HH:MM)") from e
        return v


class LoggingConfig(BaseModel):
    """Logging configuration."""

    level: Literal["debug", "info", "warn", "error"] = Field(
        default="info", description="Log level"
    )


class Config(BaseModel):
    """Root configuration model."""

    server: ServerConfig
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    retention: RetentionConfig = Field(default_factory=RetentionConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)


# Event models


_SURROGATE = re.compile("[\ud800-\udfff]")


def scrub_surrogates(value: Any) -> Any:
    """Replace lone UTF-16 surrogates with U+FFFD, recursively through lists and dicts.

    A client that truncates a string in the middle of an emoji (JavaScript's .slice()
    counts UTF-16 code units) sends half a surrogate pair. Python stores it happily, but
    the JSON response then fails to encode as UTF-8 and every request that includes the
    event returns 500 — one bad event blanked the whole dashboard (2026-10-11).
    """
    if isinstance(value, str):
        return _SURROGATE.sub("\ufffd", value)
    if isinstance(value, list):
        return [scrub_surrogates(v) for v in value]
    if isinstance(value, dict):
        return {scrub_surrogates(k): scrub_surrogates(v) for k, v in value.items()}
    return value


class EventCreate(BaseModel):
    """Event creation model for POST input.

    Accepts events from observability producers (Sable, Prismis, etc).
    Timestamp auto-generated if not provided.
    """

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def _scrub_lone_surrogates(cls, data: Any) -> Any:
        # Before validation: pydantic rejects a lone surrogate in a str field, and the 422
        # response echoing the input then fails to encode — the client got a 500 and the
        # event was lost. Scrubbing first means it is accepted with U+FFFD instead.
        return scrub_surrogates(data)

    source: str = Field(
        ..., min_length=1, max_length=50, description="Producing application identifier"
    )
    event_type: Literal["tool", "session", "agent", "response", "prompt", "command", "skill"] = (
        Field(..., description="Event category")
    )
    timestamp: str | None = Field(default=None, description="ISO8601 timestamp (UTC with Z suffix)")
    message: str | None = Field(
        default=None, max_length=2000, description="Human-readable description"
    )
    data: dict[str, Any] | None = Field(default=None, description="Arbitrary JSON data")

    # Agent observability fields (all optional for backwards compatibility)
    session_id: str | None = Field(default=None, description="Claude Code session identifier")
    hook: (
        Literal[
            "PreToolUse",
            "PostToolUse",
            "Stop",
            "SessionStart",
            "SessionEnd",
            "SubagentStart",
            "SubagentStop",
            "SubagentActivated",
            "UserPromptSubmit",
        ]
        | None
    ) = Field(default=None, description="Claude Code hook that fired")
    tool_name: str | None = Field(default=None, description="Tool invoked (Bash, Read, Edit, etc.)")
    tool_use_id: str | None = Field(
        default=None, description="Correlates PreToolUse/PostToolUse pairs"
    )
    status: Literal["success", "failure", "pending", "activated"] | None = Field(
        default=None, description="Event outcome"
    )
    agent_id: str | None = Field(default=None, description="Links event to agent instance")
    is_background: bool | None = Field(
        default=None, description="Whether this is a background tool/agent execution"
    )

    @field_validator("source")
    @classmethod
    def validate_source_pattern(cls, v: str) -> str:
        """Validate source matches pattern: lowercase start, alphanumeric + hyphens."""
        v = v.strip()
        if not v:
            raise ValueError("source must not be empty")
        if not re.match(r"^[a-z][a-z0-9-]*$", v):
            raise ValueError(
                "source must start with lowercase letter and contain only lowercase letters, numbers, and hyphens"
            )
        return v

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp_format(cls, v: str | None) -> str | None:
        """Validate timestamp is ISO8601 format if provided."""
        if v is None:
            return None
        try:
            # Attempt to parse ISO8601 timestamp
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as e:
            raise ValueError(f"timestamp must be valid ISO8601 format: {e}") from e
        return v


class Event(BaseModel):
    """Event model for database output.

    Includes server-generated fields (id, timestamp).
    """

    id: int = Field(..., description="Database-generated event ID")
    source: str = Field(..., description="Producing application identifier")
    event_type: str = Field(..., description="Event category")
    timestamp: str = Field(..., description="ISO8601 timestamp (UTC with Z suffix)")
    message: str | None = Field(default=None, description="Human-readable description")
    data: dict[str, Any] | None = Field(default=None, description="Arbitrary JSON data")


# API Response Models


class SessionResponse(BaseModel):
    """Response model for a single session."""

    id: str = Field(..., description="Session identifier")
    project: str | None = Field(None, description="Project name")
    started_at: str = Field(..., description="ISO8601 start timestamp")
    ended_at: str | None = Field(None, description="ISO8601 end timestamp")
    status: str = Field(..., description="Session status (active/ended)")
    agent_count: int = Field(..., description="Number of agents in session")
    is_idle: bool = Field(
        ..., description="Whether session is idle (active with no events for 10+ minutes)"
    )


class SessionListResponse(BaseModel):
    """Response model for list of sessions."""

    sessions: list[SessionResponse] = Field(..., description="List of sessions")


class AgentResponse(BaseModel):
    """Response model for a single agent."""

    id: str = Field(..., description="Agent identifier")
    type: str = Field(..., description="Agent type")
    name: str | None = Field(None, description="Agent name")
    session_id: str = Field(..., description="Parent session ID")
    parent_agent_id: str | None = Field(None, description="Parent agent ID if nested")
    status: str = Field(..., description="Agent status")
    created_at: str = Field(..., description="ISO8601 creation timestamp")
    completed_at: str | None = Field(None, description="ISO8601 completion timestamp")
    event_count: int = Field(..., description="Number of events from this agent")


class AgentListResponse(BaseModel):
    """Response model for list of agents."""

    agents: list[AgentResponse] = Field(..., description="List of agents")


class EventResponse(BaseModel):
    """Response model for a single event."""

    id: int = Field(..., description="Event ID")
    source: str = Field(..., description="Event source")
    event_type: str = Field(..., description="Event type")
    timestamp: str = Field(..., description="ISO8601 timestamp")
    message: str | None = Field(None, description="Event message")
    data: dict[str, Any] | None = Field(None, description="Additional event data")
    created_at: str = Field(..., description="Database creation timestamp")
    session_id: str | None = Field(None, description="Session ID")
    hook: str | None = Field(None, description="Claude Code hook")
    tool_name: str | None = Field(None, description="Tool name")
    tool_use_id: str | None = Field(None, description="Tool use correlation ID")
    status: str | None = Field(None, description="Event status")
    agent_id: str | None = Field(None, description="Agent ID")
    is_background: bool | None = Field(None, description="Background execution flag")


class EventListResponse(BaseModel):
    """Response model for list of events."""

    events: list[EventResponse] = Field(..., description="List of events")
    total: int = Field(..., description="Total count returned")
