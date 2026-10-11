"""Lone UTF-16 surrogates must never break event responses.

A client that truncates a string mid-emoji (JavaScript .slice() counts UTF-16 code
units) sends half a surrogate pair. On 2026-10-11 one such event made every
GET /events?limit=1000 return 500, which blanked the dashboard.
"""

from fastapi.testclient import TestClient

HEADERS = {"X-API-Key": "test-key-1", "content-type": "application/json"}


def test_event_with_lone_surrogate_is_stored_and_readable(client: TestClient) -> None:
    """
    INVARIANT: An event carrying half an emoji is accepted and later served
    BREAKS: One malformed client event returns 500 for every query that includes it
    """
    # Raw JSON so the lone high surrogate arrives exactly as a truncating client sends it.
    body = '{"source": "pai", "event_type": "tool", "message": "Bash: deploy \\ud83e", "data": {"preview": "done \\ud83e"}}'
    response = client.post("/events", content=body, headers=HEADERS)
    assert response.status_code == 201

    response = client.get("/events?limit=1000", headers=HEADERS)
    assert response.status_code == 200
    event = response.json()["events"][0]
    assert event["message"] == "Bash: deploy �"
    assert event["data"]["preview"] == "done �"


def test_previously_stored_lone_surrogate_does_not_break_reads(client: TestClient) -> None:
    """
    INVARIANT: Events stored before ingest scrubbing existed are still served
    BREAKS: Upgrading Argus leaves the dashboard blank until bad rows are found by hand
    """
    # Bypass the API to store a row the way the pre-fix server did.
    client.app.state.db.store_event({"source": "pai", "event_type": "tool", "data": {"preview": "half \ud83e"}})

    response = client.get("/events?limit=1000", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["events"][0]["data"]["preview"] == "half �"
