"""Groq -> OpenRouter fallback. All network calls are mocked."""
import logging

import pytest

from app.config import settings
from app.core import llm, pricing

MODELS = "m1:free,m2:free,openrouter/free"


@pytest.fixture
def cfg(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-or-SECRET")
    monkeypatch.setattr(settings, "openrouter_models", MODELS)
    monkeypatch.setattr(settings, "groq_fast_model", "groq-fast")


def gen(*items):
    """Stub provider: strings are yielded, exceptions are raised."""
    def _g(*a, **k):
        for it in items:
            if isinstance(it, Exception):
                raise it
            yield it
    return _g


def patch(monkeypatch, groq, models):
    calls = []

    def g(messages, tier):
        calls.append("groq")
        return groq(messages, tier)

    def o(model, messages):
        calls.append(model)
        return models[model](model, messages)

    monkeypatch.setattr(llm, "_stream_groq", g)
    monkeypatch.setattr(llm, "_stream_openrouter", o)
    return calls


def run(tier="fast"):
    s = llm.stream_completion("q", ["ctx"], [], tier)
    return s, "".join(s)


def test_groq_fails_before_first_token_first_openrouter_model_answers(cfg, monkeypatch, caplog):
    calls = patch(monkeypatch, gen(TimeoutError("slow")), {"m1:free": gen("Hi ", "there")})
    with caplog.at_level(logging.WARNING):
        s, text = run()
    assert text == "Hi there" and s.model == "m1:free" and calls == ["groq", "m1:free"]
    assert "sk-or-SECRET" not in caplog.text and "m1:free" in caplog.text


def test_first_openrouter_model_fails_second_answers(cfg, monkeypatch):
    calls = patch(monkeypatch, gen(RuntimeError("429")),
                  {"m1:free": gen(RuntimeError("500")), "m2:free": gen("ok")})
    s, text = run()
    assert text == "ok" and s.model == "m2:free" and calls == ["groq", "m1:free", "m2:free"]


def test_groq_fails_after_text_no_fallback_no_duplicates(cfg, monkeypatch):
    calls = patch(monkeypatch, gen("part", RuntimeError("cut")), {"m1:free": gen("OTHER")})
    s = llm.stream_completion("q", [], [], "fast")
    got = []
    with pytest.raises(RuntimeError, match="cut"):
        for d in s:
            got.append(d)
    assert got == ["part"] and calls == ["groq"] and s.model == "groq-fast"


def test_openrouter_fails_after_text_does_not_switch(cfg, monkeypatch):
    calls = patch(monkeypatch, gen(RuntimeError("x")),
                  {"m1:free": gen("a", RuntimeError("cut")), "m2:free": gen("b")})
    got = []
    with pytest.raises(RuntimeError, match="cut"):
        for d in llm.stream_completion("q", [], [], "fast"):
            got.append(d)
    assert got == ["a"] and calls == ["groq", "m1:free"]


def test_no_api_key_original_error_raised(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(settings, "openrouter_models", MODELS)
    calls = patch(monkeypatch, gen(TimeoutError("groq down")), {"m1:free": gen("never")})
    with pytest.raises(TimeoutError, match="groq down"):
        run()
    assert calls == ["groq"]


def test_empty_answer_moves_to_next_model(cfg, monkeypatch):
    calls = patch(monkeypatch, gen(), {"m1:free": gen("  ", "\n"), "m2:free": gen("real")})
    s, text = run()
    assert text == "real" and s.model == "m2:free" and calls == ["groq", "m1:free", "m2:free"]


def test_everything_fails_raises_first_groq_error(cfg, monkeypatch):
    patch(monkeypatch, gen(TimeoutError("groq")),
          {m: gen(RuntimeError("or")) for m in ("m1:free", "m2:free", "openrouter/free")})
    with pytest.raises(TimeoutError, match="groq"):
        run()


def test_groq_ok_never_touches_openrouter(cfg, monkeypatch):
    calls = patch(monkeypatch, gen("fine"), {})
    s, text = run()
    assert text == "fine" and s.model == "groq-fast" and calls == ["groq"]


def test_complete_short_falls_back(cfg, monkeypatch):
    def groq(*a):
        raise TimeoutError("x")
    monkeypatch.setattr(llm, "_complete_groq", groq)
    seen = []

    def orr(model, system, user, mt):
        seen.append(model)
        if model == "m1:free":
            return ""
        return "standalone?"
    monkeypatch.setattr(llm, "_complete_openrouter", orr)
    assert llm.complete_short("s", "u") == "standalone?" and seen == ["m1:free", "m2:free"]


def test_complete_short_no_key_raises_groq_error(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    monkeypatch.setattr(llm, "_complete_groq", lambda *a: (_ for _ in ()).throw(TimeoutError("x")))
    with pytest.raises(TimeoutError):
        llm.complete_short("s", "u")


def test_openrouter_sse_parsing(cfg, monkeypatch):
    lines = [": OPENROUTER PROCESSING", "", 'data: {"choices":[{"delta":{"content":"Hel"}}]}',
             ": keep-alive", 'data: {"choices":[{"delta":{}}]}',
             'data: {"choices":[{"delta":{"content":"lo"}}]}', "data: [DONE]",
             'data: {"choices":[{"delta":{"content":"AFTER"}}]}']
    sent = {}

    class Resp:
        def raise_for_status(self): pass
        def iter_lines(self): return iter(lines)
        def __enter__(self): return self
        def __exit__(self, *a): pass

    class Client:
        def __init__(self, timeout): sent["timeout"] = timeout
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def stream(self, method, url, json, headers):
            sent.update(method=method, url=url, json=json, headers=headers)
            return Resp()

    import httpx
    monkeypatch.setattr(httpx, "Client", Client)
    out = "".join(llm._stream_openrouter("m1:free", [{"role": "user", "content": "q"}]))
    assert out == "Hello"
    assert sent["url"] == "https://openrouter.ai/api/v1/chat/completions" and sent["json"]["stream"] is True
    assert sent["headers"] == {"Authorization": "Bearer sk-or-SECRET"} and sent["json"]["temperature"] == 0.2
    assert sent["json"]["max_tokens"] == llm.MAX_ANSWER_TOKENS and sent["json"]["messages"][0]["role"] == "system"


def test_free_models_are_priced_at_zero():
    for m in ("nvidia/nemotron-3.5-lightning:free", "openrouter/free"):
        assert pricing.estimate_cost(m, 1000, 1000) == 0.0 and pricing.is_priced(m)
    assert not pricing.is_priced("some/unknown-model")


def test_chat_event_records_the_fallback_model(cfg, monkeypatch):
    from app.core.tracing import Trace
    from app.services import chat_service as cs
    s = llm.stream_completion("q", [], [], "fast")
    s.model = "m2:free"
    t = Trace("sid", "q")
    t.generation("groq-fast", "fast", 10)
    cs._record_real_model(t, s, "fast", 10)
    assert t.llm["model"] == "m2:free"