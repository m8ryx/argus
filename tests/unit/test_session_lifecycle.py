"""Unit tests for session lifecycle event recording.

INVARIANT PROTECTION: Session status transitions must be recoverable from
history, not just reflected in the mutable sessions.status cache column.
"""

from argus.database import Database


def test_create_session_records_lifecycle_event(test_db: Database) -> None:
    """
    INVARIANT: Creating a session appends a session_lifecycle "started"
    event to the events table, not just the mutable sessions.status column.
    BREAKS: Without this, the session's prior states are unrecoverable once
    sessions.status is later overwritten (e.g. on session end) — the events
    table is the only append-only record of what happened.
    """
    session_id = "test-session-create"
    created = test_db.create_session(session_id, project="argus")
    assert created is True

    events = test_db.query_events(session_id=session_id)
    lifecycle_events = [e for e in events if e["event_type"] == "session_lifecycle"]
    assert len(lifecycle_events) == 1
    assert lifecycle_events[0]["data"]["transition"] == "started"
    assert lifecycle_events[0]["data"]["project"] == "argus"


def test_create_session_idempotent_no_duplicate_event(test_db: Database) -> None:
    """
    INVARIANT: Calling create_session twice for the same id only records
    one "started" lifecycle event.
    BREAKS: Re-POSTing a SessionStart (e.g. on hook retry) would otherwise
    fabricate multiple "started" events for a session that only started once.
    """
    session_id = "test-session-idempotent-create"
    assert test_db.create_session(session_id) is True
    assert test_db.create_session(session_id) is False  # already existed

    events = test_db.query_events(session_id=session_id)
    lifecycle_events = [e for e in events if e["event_type"] == "session_lifecycle"]
    assert len(lifecycle_events) == 1


def test_update_session_ended_records_lifecycle_event(test_db: Database) -> None:
    """
    INVARIANT: Ending a session appends a session_lifecycle "ended" event,
    independent of the mutable status column update.
    BREAKS: PATCH /sessions/{id} (or an automatic SessionEnd hook) silently
    overwrites sessions.status with no append-only trace that the session
    was ever in any prior state.
    """
    session_id = "test-session-end"
    test_db.create_session(session_id)
    ended = test_db.update_session_ended(session_id)
    assert ended is True

    events = test_db.query_events(session_id=session_id)
    lifecycle_events = [e for e in events if e["event_type"] == "session_lifecycle"]
    transitions = {e["data"]["transition"] for e in lifecycle_events}
    assert transitions == {"started", "ended"}


def test_update_session_ended_twice_no_duplicate_event(test_db: Database) -> None:
    """
    INVARIANT: Re-ending an already-ended session (e.g. a duplicate PATCH
    call) returns True for backward compatibility with existing callers,
    but does NOT record a second "ended" lifecycle event.
    BREAKS: Without this, every redundant close_session call would fabricate
    a new "ended" transition that never actually happened, polluting the
    audit trail with false state changes.
    """
    session_id = "test-session-double-end"
    test_db.create_session(session_id)
    assert test_db.update_session_ended(session_id) is True
    assert test_db.update_session_ended(session_id) is True  # still True (exists)

    events = test_db.query_events(session_id=session_id)
    ended_events = [
        e
        for e in events
        if e["event_type"] == "session_lifecycle" and e["data"]["transition"] == "ended"
    ]
    assert len(ended_events) == 1


def test_update_session_ended_unknown_session_returns_false(test_db: Database) -> None:
    """
    INVARIANT: Ending a session that was never created returns False and
    records no lifecycle event.
    BREAKS: Existing callers (PATCH /sessions/{id}) rely on False to raise a
    404 — silently recording an event here would mask the not-found case.
    """
    assert test_db.update_session_ended("session-that-never-existed") is False

    events = test_db.query_events(session_id="session-that-never-existed")
    assert events == []
