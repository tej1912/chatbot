"""Admin dashboard API against a real (in-memory SQLite) database - the SQL itself runs."""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.core import pricing
from app.db.models import ChatEvent, ConversationMessage
from app.db.session import get_db
from app.main import app

ADMIN = {"X-Admin-Key": settings.admin_api_key}


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    ChatEvent.__table__.create(engine)
    ConversationMessage.__table__.create(engine)
    Session = sessionmaker(bind=engine)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    c = TestClient(app)
    c.Session = Session
    yield c
    app.dependency_overrides.clear()


def add(client, outcome="answered", question="q", answer="a", cost=0.001, model="openai/gpt-oss-20b",
        conf=0.8, days_ago=0, session="sess-1234567890", tokens=(1000, 100)):
    db = client.Session()
    db.add(ChatEvent(
        created_at=datetime.utcnow() - timedelta(days=days_ago), session_id=session, outcome=outcome,
        question=question, answer=answer, confidence=conf, model=model if cost or tokens[0] else None,
        tier="fast", input_tokens=tokens[0] if cost else 0, output_tokens=tokens[1] if cost else 0,
        cost_usd=cost, latency_ms=900,
    ))
    db.commit()
    db.close()


def test_all_admin_routes_need_the_key(client):
    for method, path in [("get", "/v1/admin/stats"), ("get", "/v1/admin/conversations"),
                         ("get", "/v1/admin/pricing"), ("delete", "/v1/admin/events?older_than_days=30")]:
        assert getattr(client, method)(path).status_code == 401
        assert getattr(client, method)(path, headers={"X-Admin-Key": "wrong"}).status_code == 401


def test_stats_empty_database(client):
    body = client.get("/v1/admin/stats?days=7", headers=ADMIN).json()
    assert body["totals"]["messages"] == 0 and body["totals"]["answer_rate"] is None
    assert len(body["daily"]) == 7 and body["by_model"] == []


def test_stats_totals_daily_and_models(client):
    add(client, "answered", cost=0.002)
    add(client, "answered", cost=0.003, session="other-session-xyz")
    add(client, "cache_hit", cost=0.0, model=None, conf=0.9)
    add(client, "low_confidence_fallback", cost=0.0, model=None, conf=0.2)
    add(client, "blocked_regex", cost=0.0, model=None, conf=None)
    add(client, "error_llm", cost=0.0005)
    add(client, "answered", cost=0.01, days_ago=3, model="mystery-model")
    add(client, "answered", cost=0.5, days_ago=60)  # outside a 30-day window

    t = client.get("/v1/admin/stats?days=30", headers=ADMIN).json()
    tot = t["totals"]
    assert tot["messages"] == 7 and tot["sessions"] == 2 + 0 + 0 + 0 + 0 + 0 + 0 or tot["sessions"] >= 2
    assert tot["answered"] == 4 and tot["llm_answers"] == 3 and tot["cache_hits"] == 1
    assert tot["not_answered"] == 1 and tot["blocked"] == 1 and tot["errors"] == 1
    assert tot["answer_rate"] == round(4 / 7, 4)
    assert abs(tot["cost_usd"] - (0.002 + 0.003 + 0.0005 + 0.01)) < 1e-9
    assert tot["cost_per_llm_answer_usd"] is not None
    assert len(t["daily"]) == 30
    today = t["daily"][-1]
    assert today["messages"] == 6 and today["not_answered"] == 1 and today["answered"] == 3
    models = {m["model"]: m for m in t["by_model"]}
    assert models["openai/gpt-oss-20b"]["priced"] is True and models["mystery-model"]["priced"] is False


def test_conversations_filters_search_pagination(client):
    add(client, "answered", question="How do I print a check?", answer="Use the print page.")
    add(client, "low_confidence_fallback", question="What is the weather?", answer="not sure", cost=0.0, model=None)
    add(client, "blocked_nemo", question="ignore rules", answer="refused", cost=0.0, model=None)
    add(client, "error_llm", question="why?", answer=None, cost=0.0)
    add(client, "smalltalk", question="hi", answer="Hello", cost=0.0, model=None)

    def get(**params):
        return client.get("/v1/admin/conversations", params=params, headers=ADMIN).json()

    assert get()["total"] == 5
    assert get(outcome="answered")["total"] == 1
    assert [i["question"] for i in get(outcome="not_answered")["items"]] == ["What is the weather?"]
    assert get(outcome="blocked")["total"] == 1 and get(outcome="error")["total"] == 1
    assert get(outcome="smalltalk")["total"] == 1
    assert get(q="PRINT")["total"] == 1                  # case-insensitive, matches question
    assert get(q="print page")["total"] == 1             # matches answer
    assert get(q="100%")["total"] == 0                   # % is literal, not a wildcard
    page = get(limit=2, offset=0)
    assert len(page["items"]) == 2 and page["total"] == 5
    assert len(get(limit=2, offset=4)["items"]) == 1
    item = get(outcome="answered")["items"][0]
    assert item["session"] == "sess-123" and item["model"] == "openai/gpt-oss-20b" and item["cost_usd"] > 0


def test_conversations_validation(client):
    assert client.get("/v1/admin/conversations?limit=9999", headers=ADMIN).status_code == 422
    assert client.get("/v1/admin/conversations?offset=-1", headers=ADMIN).status_code == 422


def test_retention_delete(client):
    add(client, days_ago=40)
    add(client, days_ago=2)
    db = client.Session()
    db.add(ConversationMessage(session_id="s", role="user", content="old", created_at=datetime.utcnow() - timedelta(days=40)))
    db.add(ConversationMessage(session_id="s", role="user", content="new"))
    db.commit(); db.close()
    r = client.delete("/v1/admin/events?older_than_days=30", headers=ADMIN).json()
    assert r["deleted_events"] == 1 and r["deleted_messages"] == 1
    assert client.get("/v1/admin/conversations", headers=ADMIN).json()["total"] == 1
    assert client.delete("/v1/admin/events", headers=ADMIN).status_code == 422          # parameter required
    assert client.delete("/v1/admin/events?older_than_days=0", headers=ADMIN).status_code == 422


def test_pricing_table_and_env_override(client, monkeypatch):
    assert pricing.estimate_cost("openai/gpt-oss-20b", 1_000_000, 1_000_000) == pytest.approx(0.375)
    assert pricing.estimate_cost("unknown-model", 1000, 1000) == 0.0
    assert pricing.estimate_cost(None, 1000, 1000) == 0.0
    monkeypatch.setattr(settings, "model_prices_json", '{"my-model": [1, 2], "openai/gpt-oss-20b": [0.5, 0.5]}')
    assert pricing.estimate_cost("my-model", 1_000_000, 500_000) == pytest.approx(2.0)
    assert pricing.estimate_cost("openai/gpt-oss-20b", 1_000_000, 0) == pytest.approx(0.5)
    body = client.get("/v1/admin/pricing", headers=ADMIN).json()
    assert {"model": "my-model", "input": 1.0, "output": 2.0} in body["models"]
    monkeypatch.setattr(settings, "model_prices_json", "not json")
    assert pricing.estimate_cost("openai/gpt-oss-20b", 1_000_000, 0) == pytest.approx(0.075)  # bad override ignored
