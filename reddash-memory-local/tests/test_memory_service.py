from backend.app.memory_service import sanitize_actor_id


def test_sanitize_actor_id_replaces_underscores() -> None:
    assert sanitize_actor_id("CUST_DEMO_001") == "CUST-DEMO-001"


def test_sanitize_actor_id_collapses_invalid_characters() -> None:
    assert sanitize_actor_id(" user@demo / agent ") == "user-demo-agent"


def test_sanitize_actor_id_uses_fallback_when_empty() -> None:
    assert sanitize_actor_id("__", fallback="reddash-agent") == "reddash-agent"
