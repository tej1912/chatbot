from app.core import tracing


def test_trace_collects_facts():
    t = tracing.begin("sess-1", "What is the refund window?")
    t.note(standalone="What is the refund window?", category=None)
    t.mark("retrieval_start")
    t.retrieval([{"doc": "FAQ", "score": 0.03}], 0.71)
    t.generation("openai/gpt-oss-20b", "fast", 900)
    t.finish("30 days.", "answered")

    assert t.session_id == "sess-1"
    assert t.meta["confidence"] == 0.71 and t.meta["outcome"] == "answered"
    assert t.llm == {"model": "openai/gpt-oss-20b", "tier": "fast", "input_tokens": 900}
    assert t.elapsed_ms() >= 0


def test_no_llm_means_no_generation():
    t = tracing.begin("s", "hi")
    t.finish("hello", "smalltalk")
    assert t.llm is None and t.meta["outcome"] == "smalltalk"
