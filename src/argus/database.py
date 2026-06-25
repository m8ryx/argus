"""SQLite database layer with WAL mode."""

import json
import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


class Database:
    """SQLite database for event storage."""

    def __init__(self, db_path: str, journal_mode: str = "WAL") -> None:
        """Initialize database connection and schema.

        Args:
            db_path: Path to SQLite database file (tilde expansion handled by caller)
            journal_mode: SQLite journal mode (WAL, DELETE, TRUNCATE, etc.)
        """
        self.db_path = str(Path(db_path).expanduser().resolve())
        self._lock = threading.Lock()  # Thread safety for concurrent access

        # Ensure parent directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        # Connect and set journal mode
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.execute(f"PRAGMA journal_mode={journal_mode}")

        # Create schema if not exists
        self._create_schema()

        # Run migrations for schema evolution
        self._run_migrations()

    def _create_schema(self) -> None:
        """Create events table and indexes."""
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    message TEXT,
                    level TEXT,
                    data TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Create indexes for fast filtering
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_source ON events(source)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_event_type ON events(event_type)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_level ON events(level)")

            # Sessions table for session lifecycle tracking
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    project TEXT,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    status TEXT DEFAULT 'active'
                )
            """)

            # Agents table for agent/subagent tracking
            # Note: id can be tool_use_id initially (pending), updated to agent_id on completion
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    tool_use_id TEXT,
                    type TEXT NOT NULL,
                    name TEXT,
                    session_id TEXT NOT NULL,
                    parent_agent_id TEXT,
                    status TEXT DEFAULT 'running',
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    event_count INTEGER DEFAULT 0,
                    FOREIGN KEY (session_id) REFERENCES sessions(id)
                )
            """)

            # Indexes for sessions and agents
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)")

    def _get_existing_columns(self, table: str) -> set[str]:
        """Get set of existing column names for a table.

        Args:
            table: Table name to inspect

        Returns:
            Set of column names
        """
        cursor = self.conn.execute(f"PRAGMA table_info({table})")
        return {row[1] for row in cursor.fetchall()}

    def _run_migrations(self) -> None:
        """Run schema migrations for new columns and backfill data.

        Adds new columns to events table if they don't exist.
        Backfills session_id from JSON data blob where present.
        Each ALTER TABLE is atomic in SQLite, so partial failures are safe.
        """
        existing = self._get_existing_columns("events")

        # New columns for iteration 3: agent observability
        new_columns = [
            ("session_id", "TEXT"),
            ("hook", "TEXT"),
            ("tool_name", "TEXT"),
            ("tool_use_id", "TEXT"),
            ("status", "TEXT"),
            ("agent_id", "TEXT"),
            ("is_background", "INTEGER"),  # SQLite uses INTEGER for booleans
        ]

        with self.conn:
            for col_name, col_type in new_columns:
                if col_name not in existing:
                    self.conn.execute(f"ALTER TABLE events ADD COLUMN {col_name} {col_type}")

            # Create indexes for new columns (idempotent)
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_session_id ON events(session_id)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_hook ON events(hook)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_tool_name ON events(tool_name)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON events(status)")
            self.conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_id ON events(agent_id)")

            # Backfill session_id from JSON data blob (idempotent - only updates NULL)
            self.conn.execute("""
                UPDATE events
                SET session_id = json_extract(data, '$.session_id')
                WHERE session_id IS NULL
                  AND data IS NOT NULL
                  AND json_extract(data, '$.session_id') IS NOT NULL
            """)

        # Migration: add tool_use_id column to agents table
        existing_agents_cols = self._get_existing_columns("agents")
        if "tool_use_id" not in existing_agents_cols:
            with self.conn:
                self.conn.execute("ALTER TABLE agents ADD COLUMN tool_use_id TEXT")
                self.conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_agents_tool_use_id ON agents(tool_use_id)"
                )

    def get_journal_mode(self) -> str:
        """Get current journal mode (for verification).

        Returns:
            Journal mode string (e.g., 'wal')
        """
        cursor = self.conn.execute("PRAGMA journal_mode")
        result = cursor.fetchone()
        return str(result[0]).lower()

    def store_event(self, event: dict[str, Any]) -> int:
        """Store event in database.

        Args:
            event: Event dictionary with source, event_type, and optional fields.
                   New fields: session_id, hook, tool_name, tool_use_id, status, agent_id

        Returns:
            Event ID (auto-generated primary key)
        """
        # Generate timestamp if not provided
        timestamp = event.get("timestamp")
        if not timestamp:
            timestamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        # Serialize data blob to JSON
        data_blob = None
        if "data" in event and event["data"] is not None:
            data_blob = json.dumps(event["data"])

        # Insert event with thread lock for concurrent safety
        with self._lock:
            with self.conn:
                # Convert is_background bool to SQLite INTEGER (1/0/NULL)
                is_background = event.get("is_background")
                is_background_int = 1 if is_background else (0 if is_background is False else None)

                cursor = self.conn.execute(
                    """
                    INSERT INTO events (
                        source, event_type, timestamp, message, level, data,
                        session_id, hook, tool_name, tool_use_id, status, agent_id, is_background
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        event["source"],
                        event["event_type"],
                        timestamp,
                        event.get("message"),
                        event.get("level"),
                        data_blob,
                        event.get("session_id"),
                        event.get("hook"),
                        event.get("tool_name"),
                        event.get("tool_use_id"),
                        event.get("status"),
                        event.get("agent_id"),
                        is_background_int,
                    ),
                )
                event_id = cursor.lastrowid
                if event_id is None:
                    raise RuntimeError("Failed to retrieve event ID after insertion")
                return event_id

    def query_events(
        self,
        source: str | None = None,
        event_type: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 100,
        session_id: str | None = None,
        hook: str | None = None,
        tool_name: str | None = None,
        status: str | None = None,
        agent_id: str | None = None,
        tool_use_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Query events with optional filtering.

        Args:
            source: Filter by source
            event_type: Filter by event type
            since: Filter events after this timestamp (ISO8601)
            until: Filter events before this timestamp (ISO8601)
            limit: Maximum number of events to return (default 100)
            session_id: Filter by session ID
            hook: Filter by hook type
            tool_name: Filter by tool name
            status: Filter by status (success/failure/pending)
            agent_id: Filter by agent ID
            tool_use_id: Filter by tool use ID

        Returns:
            List of event dictionaries with deserialized data
        """
        # Build WHERE clause from safe, pre-defined fragments (not user input)
        where_clauses = []
        params: list[str | int] = []

        if source is not None:
            where_clauses.append("source = ?")
            params.append(source)
        if event_type is not None:
            where_clauses.append("event_type = ?")
            params.append(event_type)
        if since is not None:
            where_clauses.append("timestamp >= ?")
            params.append(since)
        if until is not None:
            where_clauses.append("timestamp <= ?")
            params.append(until)
        if session_id is not None:
            where_clauses.append("session_id = ?")
            params.append(session_id)
        if hook is not None:
            where_clauses.append("hook = ?")
            params.append(hook)
        if tool_name is not None:
            where_clauses.append("tool_name = ?")
            params.append(tool_name)
        if status is not None:
            where_clauses.append("status = ?")
            params.append(status)
        if agent_id is not None:
            where_clauses.append("agent_id = ?")
            params.append(agent_id)
        if tool_use_id is not None:
            where_clauses.append("tool_use_id = ?")
            params.append(tool_use_id)

        # Build query with parameterized values only
        base_query = (
            "SELECT id, source, event_type, timestamp, message, level, data, created_at, "
            "session_id, hook, tool_name, tool_use_id, status, agent_id, is_background FROM events"
        )

        if where_clauses:
            # Join pre-defined safe clauses (no user input in SQL structure)
            where_clause = " WHERE " + " AND ".join(where_clauses)
            query = base_query + where_clause + " ORDER BY timestamp DESC LIMIT ?"
        else:
            query = base_query + " ORDER BY timestamp DESC LIMIT ?"

        params.append(limit)

        cursor = self.conn.execute(query, params)
        rows = cursor.fetchall()

        # Convert rows to dictionaries with JSON deserialization
        events = []
        for row in rows:
            event = {
                "id": row[0],
                "source": row[1],
                "event_type": row[2],
                "timestamp": row[3],
                "message": row[4],
                "level": row[5],
                "data": json.loads(row[6]) if row[6] else None,
                "created_at": row[7],
                "session_id": row[8],
                "hook": row[9],
                "tool_name": row[10],
                "tool_use_id": row[11],
                "status": row[12],
                "agent_id": row[13],
                "is_background": bool(row[14]) if row[14] is not None else None,
            }
            events.append(event)

        return events

    def get_sources(self) -> list[str]:
        """Get list of distinct sources from events.

        Returns:
            Sorted list of unique source strings
        """
        cursor = self.conn.execute("SELECT DISTINCT source FROM events ORDER BY source")
        rows = cursor.fetchall()
        return [str(row[0]) for row in rows]

    def get_event_types(self) -> list[str]:
        """Get list of distinct event types from events.

        Returns:
            Sorted list of unique event_type strings
        """
        cursor = self.conn.execute("SELECT DISTINCT event_type FROM events ORDER BY event_type")
        rows = cursor.fetchall()
        return [str(row[0]) for row in rows]

    def get_sessions(self) -> list[dict[str, Any]]:
        """Get list of sessions with agent counts and idle state.

        Returns:
            List of session dicts with id, project, started_at, ended_at, status,
            agent_count, is_idle
        """
        cursor = self.conn.execute("""
            SELECT s.id, s.project, s.started_at, s.ended_at, s.status,
                   COUNT(a.id) as agent_count,
                   (SELECT MAX(timestamp) FROM events WHERE session_id = s.id) as last_event_time
            FROM sessions s
            LEFT JOIN agents a ON a.session_id = s.id
            GROUP BY s.id
            ORDER BY s.started_at DESC
        """)
        rows = cursor.fetchall()

        # Current time for idle calculation
        now = datetime.now(UTC)

        return [
            {
                "id": row[0],
                "project": row[1],
                "started_at": row[2],
                "ended_at": row[3],
                "status": row[4],
                "agent_count": row[5],
                "is_idle": self._calculate_idle(row[4], row[6], now),
            }
            for row in rows
        ]

    def _calculate_idle(self, status: str, last_event_time: str | None, now: datetime) -> bool:
        """Calculate if session is idle.

        A session is idle if:
        - status is 'active' AND
        - (no events exist OR last event was >10 minutes ago)

        Args:
            status: Session status
            last_event_time: ISO8601 timestamp of most recent event, or None
            now: Current datetime for comparison

        Returns:
            True if session is idle, False otherwise
        """
        if status != "active":
            return False

        if last_event_time is None:
            return True  # Active session with no events is idle

        # Parse timestamp and compare
        last_event_dt = datetime.fromisoformat(last_event_time.replace("Z", "+00:00"))
        idle_threshold = timedelta(minutes=10)

        return (now - last_event_dt) > idle_threshold

    def get_agents(self, session_id: str | None = None) -> list[dict[str, Any]]:
        """Get list of agents, optionally filtered by session.

        Args:
            session_id: Optional session ID to filter by

        Returns:
            List of agent dicts with id, type, name, session_id, status, event_count
        """
        if session_id is not None:
            cursor = self.conn.execute(
                """
                SELECT id, type, name, session_id, parent_agent_id, status,
                       created_at, completed_at, event_count
                FROM agents
                WHERE session_id = ?
                ORDER BY created_at DESC
                """,
                (session_id,),
            )
        else:
            cursor = self.conn.execute("""
                SELECT id, type, name, session_id, parent_agent_id, status,
                       created_at, completed_at, event_count
                FROM agents
                ORDER BY created_at DESC
            """)
        rows = cursor.fetchall()
        return [
            {
                "id": row[0],
                "type": row[1],
                "name": row[2],
                "session_id": row[3],
                "parent_agent_id": row[4],
                "status": row[5],
                "created_at": row[6],
                "completed_at": row[7],
                "event_count": row[8],
            }
            for row in rows
        ]

    def get_session_by_id(self, session_id: str) -> dict[str, Any] | None:
        """Get single session by ID with agent count and idle state.

        Args:
            session_id: Session identifier

        Returns:
            Session dict or None if not found
        """
        cursor = self.conn.execute(
            """
            SELECT s.id, s.project, s.started_at, s.ended_at, s.status,
                   COUNT(a.id) as agent_count,
                   (SELECT MAX(timestamp) FROM events WHERE session_id = s.id) as last_event_time
            FROM sessions s
            LEFT JOIN agents a ON a.session_id = s.id
            WHERE s.id = ?
            GROUP BY s.id
            """,
            (session_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        now = datetime.now(UTC)
        return {
            "id": row[0],
            "project": row[1],
            "started_at": row[2],
            "ended_at": row[3],
            "status": row[4],
            "agent_count": row[5],
            "is_idle": self._calculate_idle(row[4], row[6], now),
        }

    def get_agent_by_id(self, agent_id: str) -> dict[str, Any] | None:
        """Get single agent by ID.

        Args:
            agent_id: Agent identifier

        Returns:
            Agent dict or None if not found
        """
        cursor = self.conn.execute(
            """
            SELECT id, type, name, session_id, parent_agent_id, status,
                   created_at, completed_at, event_count
            FROM agents
            WHERE id = ?
            """,
            (agent_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "type": row[1],
            "name": row[2],
            "session_id": row[3],
            "parent_agent_id": row[4],
            "status": row[5],
            "created_at": row[6],
            "completed_at": row[7],
            "event_count": row[8],
        }

    def create_session(self, session_id: str, project: str | None = None) -> bool:
        """Create session record if not exists (idempotent).

        `sessions.status` remains a mutable cache column for fast lookups
        (active-session queries, idle detection), but every transition is
        also appended to the events table via store_event() so the history
        survives even though the cache column itself gets overwritten.
        Without this, closing/ending a session silently destroyed the only
        record that it had ever been in any prior state.

        Args:
            session_id: Claude Code session identifier
            project: Project name from event data

        Returns:
            True if session was created, False if already existed
        """
        started_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        cursor = self.conn.execute(
            """
            INSERT OR IGNORE INTO sessions (id, project, started_at, status)
            VALUES (?, ?, ?, 'active')
            """,
            (session_id, project, started_at),
        )
        self.conn.commit()
        created = cursor.rowcount > 0
        if created:
            self.store_event(
                {
                    "source": "argus",
                    "event_type": "session_lifecycle",
                    "timestamp": started_at,
                    "message": f"session started: {session_id}",
                    "session_id": session_id,
                    "data": {"transition": "started", "project": project},
                }
            )
        return created

    def update_session_ended(self, session_id: str) -> bool:
        """Update session status to ended.

        See create_session() docstring re: append-only lifecycle events
        alongside the mutable status cache column. Existing callers treat
        the return value as "session exists" and re-run unconditionally on
        every call (re-broadcasting session_ended, re-checking abandoned
        agents) — that behavior is preserved as-is. What's new is that the
        lifecycle event is only recorded on the actual active->ended
        transition, not on every redundant call, so re-ending an
        already-ended session (e.g. a duplicate PATCH) doesn't fabricate a
        second "session ended" event in the history.

        Args:
            session_id: Claude Code session identifier

        Returns:
            True if session was updated, False if not found
        """
        row = self.conn.execute(
            "SELECT status FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return False
        was_active = row[0] != "ended"

        ended_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        self.conn.execute(
            """
            UPDATE sessions
            SET ended_at = ?, status = 'ended'
            WHERE id = ?
            """,
            (ended_at, session_id),
        )
        self.conn.commit()

        if was_active:
            self.store_event(
                {
                    "source": "argus",
                    "event_type": "session_lifecycle",
                    "timestamp": ended_at,
                    "message": f"session ended: {session_id}",
                    "session_id": session_id,
                    "data": {"transition": "ended"},
                }
            )
        return True

    def create_agent(
        self,
        agent_id: str,
        session_id: str,
        agent_type: str = "subagent",
        name: str | None = None,
        parent_agent_id: str | None = None,
        tool_use_id: str | None = None,
    ) -> bool:
        """Create agent record if not exists (idempotent).

        Args:
            agent_id: Unique agent identifier
            session_id: Parent session ID
            agent_type: Agent type (e.g., 'subagent', 'agent')
            name: Human-readable agent name
            parent_agent_id: Parent agent ID for nested agents
            tool_use_id: Tool use ID for PreToolUse/PostToolUse correlation

        Returns:
            True if agent was created, False if already existed
        """
        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        cursor = self.conn.execute(
            """
            INSERT OR IGNORE INTO agents (id, tool_use_id, type, name, session_id, parent_agent_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
            """,
            (agent_id, tool_use_id, agent_type, name, session_id, parent_agent_id, created_at),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def create_pending_agent(
        self,
        tool_use_id: str,
        session_id: str,
        agent_type: str = "subagent",
        name: str | None = None,
        parent_agent_id: str | None = None,
    ) -> bool:
        """Create pending agent record keyed by tool_use_id (before agent_id is known).

        Called from PreToolUse when Task tool is invoked. The agent_id is not yet
        available, so we use tool_use_id as the primary key temporarily.

        Args:
            tool_use_id: Correlation ID from PreToolUse (becomes temporary primary key)
            session_id: Parent session ID
            agent_type: Agent type (e.g., 'Explore', 'code-reviewer')
            name: Human-readable agent name (usually description)
            parent_agent_id: Parent agent ID for nested agents

        Returns:
            True if agent was created, False if already existed
        """
        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        cursor = self.conn.execute(
            """
            INSERT OR IGNORE INTO agents (id, tool_use_id, type, name, session_id, parent_agent_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (tool_use_id, tool_use_id, agent_type, name, session_id, parent_agent_id, created_at),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def complete_agent_by_tool_use_id(
        self,
        tool_use_id: str,
        agent_id: str,
        status: str = "completed",
    ) -> bool:
        """Complete pending agent by correlating tool_use_id to set real agent_id.

        Called from PostToolUse when Task tool completes. Updates the pending agent
        record with the real agent_id and completion status.

        Args:
            tool_use_id: Correlation ID from PreToolUse/PostToolUse
            agent_id: Real agent ID from toolUseResult
            status: Final status ('completed' or 'failed')

        Returns:
            True if agent was updated, False if not found
        """
        completed_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        # Count events for this agent (agent_id is set after activation)
        count_cursor = self.conn.execute(
            "SELECT COUNT(*) FROM events WHERE agent_id = ?",
            (agent_id,),
        )
        event_count = count_cursor.fetchone()[0]

        # Update agent: change id from tool_use_id to agent_id, set completion status
        cursor = self.conn.execute(
            """
            UPDATE agents
            SET id = ?, completed_at = ?, status = ?, event_count = ?
            WHERE tool_use_id = ?
            """,
            (agent_id, completed_at, status, event_count, tool_use_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def activate_pending_agent(self, tool_use_id: str, agent_id: str) -> bool:
        """Activate pending agent by setting real agent_id and changing status to running.

        Called from SubagentActivated when first tool inside subagent fires.
        Updates the agent's id from tool_use_id to the real agent_id.
        The agent transitions to 'running' status until PostToolUse completes it.

        Args:
            tool_use_id: Correlation ID from PreToolUse (current agent id)
            agent_id: Real agent ID discovered from agent file

        Returns:
            True if agent was updated, False if not found
        """
        cursor = self.conn.execute(
            """
            UPDATE agents
            SET id = ?, status = 'running'
            WHERE tool_use_id = ? AND status = 'pending'
            """,
            (agent_id, tool_use_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def get_most_recent_pending_agent(self, session_id: str) -> dict[str, Any] | None:
        """Get the most recent pending agent in a session.

        Used by SubagentStart to find the pending agent created by PreToolUse,
        since SubagentStart doesn't have tool_use_id for direct correlation.

        Args:
            session_id: Session identifier

        Returns:
            Agent dict with tool_use_id or None if no pending agent found
        """
        cursor = self.conn.execute(
            """
            SELECT id, tool_use_id, type, name, session_id, parent_agent_id, status,
                   created_at, completed_at, event_count
            FROM agents
            WHERE session_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (session_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "tool_use_id": row[1],
            "type": row[2],
            "name": row[3],
            "session_id": row[4],
            "parent_agent_id": row[5],
            "status": row[6],
            "created_at": row[7],
            "completed_at": row[8],
            "event_count": row[9],
        }

    def update_agent_type(self, agent_id: str, agent_type: str) -> bool:
        """Update agent type.

        Used by SubagentStart to set the correct agent type from Claude Code payload,
        since PreToolUse may not have the accurate type.

        Args:
            agent_id: Agent identifier
            agent_type: New agent type

        Returns:
            True if agent was updated, False if not found
        """
        cursor = self.conn.execute(
            """
            UPDATE agents
            SET type = ?
            WHERE id = ?
            """,
            (agent_type, agent_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def correlate_pending_event(self, tool_use_id: str, agent_id: str) -> int:
        """Set agent_id on pending event when SubagentStart provides it.

        Called immediately when SubagentStart fires. The PreToolUse event has
        tool_use_id but no agent_id — this correlates them in real-time.

        Args:
            tool_use_id: Tool use ID from the pending agent
            agent_id: Real agent ID from SubagentStart

        Returns:
            Number of events updated
        """
        cursor = self.conn.execute(
            """
            UPDATE events
            SET agent_id = ?
            WHERE tool_use_id = ? AND agent_id IS NULL
            """,
            (agent_id, tool_use_id),
        )
        self.conn.commit()
        return cursor.rowcount

    def get_agent_by_tool_use_id(self, tool_use_id: str) -> dict[str, Any] | None:
        """Get agent by tool_use_id (for pending agents before real agent_id is set).

        Args:
            tool_use_id: Tool use ID from PreToolUse

        Returns:
            Agent dict or None if not found
        """
        cursor = self.conn.execute(
            """
            SELECT id, tool_use_id, type, name, session_id, parent_agent_id, status,
                   created_at, completed_at, event_count
            FROM agents
            WHERE tool_use_id = ?
            """,
            (tool_use_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "tool_use_id": row[1],
            "type": row[2],
            "name": row[3],
            "session_id": row[4],
            "parent_agent_id": row[5],
            "status": row[6],
            "created_at": row[7],
            "completed_at": row[8],
            "event_count": row[9],
        }

    def update_agent_completed(self, agent_id: str, status: str = "completed") -> bool:
        """Update agent status to completed and calculate event_count.

        Args:
            agent_id: Agent identifier
            status: Final status (e.g., 'completed', 'failed')

        Returns:
            True if agent was updated, False if not found
        """
        completed_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        # Count events for this agent
        count_cursor = self.conn.execute(
            "SELECT COUNT(*) FROM events WHERE agent_id = ?",
            (agent_id,),
        )
        event_count = count_cursor.fetchone()[0]

        cursor = self.conn.execute(
            """
            UPDATE agents
            SET completed_at = ?, status = ?, event_count = ?
            WHERE id = ?
            """,
            (completed_at, status, event_count, agent_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    def abandon_session_agents(self, session_id: str) -> list[dict[str, Any]]:
        """Mark all non-completed agents in a session as abandoned.

        Called when a session ends to clean up any agents that never received
        completion events (e.g., user cancelled, session timed out).

        Args:
            session_id: Session identifier

        Returns:
            List of abandoned agent dicts for broadcasting lifecycle events
        """
        completed_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        # Find agents to abandon
        cursor = self.conn.execute(
            """
            SELECT id, tool_use_id, type, name, session_id, parent_agent_id, status,
                   created_at, completed_at, event_count
            FROM agents
            WHERE session_id = ? AND status != 'completed'
            """,
            (session_id,),
        )
        rows = cursor.fetchall()

        if not rows:
            return []

        # Mark them as abandoned
        self.conn.execute(
            """
            UPDATE agents
            SET status = 'abandoned', completed_at = ?
            WHERE session_id = ? AND status != 'completed'
            """,
            (completed_at, session_id),
        )
        self.conn.commit()

        # Return agent dicts for broadcasting
        return [
            {
                "id": row[0],
                "tool_use_id": row[1],
                "type": row[2],
                "name": row[3],
                "session_id": row[4],
                "parent_agent_id": row[5],
                "status": "abandoned",
                "created_at": row[7],
                "completed_at": completed_at,
                "event_count": row[9],
            }
            for row in rows
        ]

    def cleanup_old_events(self, retention_days: int, vacuum: bool = False) -> int:
        """Delete events older than retention threshold.

        Args:
            retention_days: Delete events older than N days
            vacuum: Run VACUUM after cleanup to reclaim disk space

        Returns:
            Number of events deleted
        """

        # Calculate cutoff timestamp (events older than this will be deleted)
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        cutoff_iso = cutoff.isoformat().replace("+00:00", "Z")

        # Delete old events with thread lock for concurrent safety
        with self._lock:
            with self.conn:
                cursor = self.conn.execute(
                    "DELETE FROM events WHERE timestamp < ?",
                    (cutoff_iso,),
                )
                deleted_count = cursor.rowcount

            # Optionally run VACUUM to reclaim disk space
            # Note: VACUUM cannot run inside a transaction, so execute separately
            if vacuum and deleted_count > 0:
                self.conn.execute("VACUUM")

            return deleted_count

    def close(self) -> None:
        """Close database connection."""
        self.conn.close()

    def __del__(self) -> None:
        """Cleanup connection on deletion."""
        if hasattr(self, "conn"):
            self.conn.close()
