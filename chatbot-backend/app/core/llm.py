"""
LLM router: picks a "fast" or "complex" Groq model per question
(GROQ_FAST_MODEL / GROQ_COMPLEX_MODEL in .env).
If Groq fails, optional OpenRouter free models (OPENROUTER_MODELS in .env) answer instead.
"""
import json
import logging
from collections.abc import Iterator

from app.config import settings
from app.core import brand

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

SYSTEM_PROMPT = f"""You are the support assistant for {brand.COMPANY_NAME} ({brand.TOPICS}), embedded on its website.
Answer ONLY using the provided context. If the context doesn't contain the
answer, say you're not sure and offer to connect the user with support —
never invent an answer.

Formatting rules — the frontend renders basic markdown, so:
- Keep answers SHORT. 2-4 sentences for a simple question. Never pad with
  filler or repeat the question back.
- Use a bullet list (lines starting with "- ") only when listing 3+ items
  (like plan features) — plain sentences otherwise.
- Use **bold** only for a genuinely key term or number, sparingly.
- No headers, no long preambles, no "Certainly! Here's..." — answer
  directly.
"""

MAX_ANSWER_TOKENS = 350

REWRITE_SYSTEM_PROMPT = (
    "You rewrite the LAST user message of a support chat into ONE standalone question. "
    "Use earlier messages only to resolve references like 'it', 'that', 'the second one'. "
    "Keep the user's meaning. If the message is already standalone, return it unchanged. "
    "Output only the question - no quotes, no explanation."
)


def estimate_tokens(text: str) -> int:
    """Rough token estimate (~4 chars/token) - used for spend caps, not billing."""
    return max(1, len(text) // 4)


def _build_prompt(question: str, context_chunks: list[str], history: list[dict]) -> list[dict]:
    context_block = "\n\n---\n\n".join(context_chunks) if context_chunks else "(no relevant context found)"
    messages = list(history)
    messages.append(
        {
            "role": "user",
            "content": f"Context:\n{context_block}\n\nQuestion: {question}",
        }
    )
    return messages


def route_tier(question: str, retrieval_score: float) -> str:
    """
    Simple heuristic router — swap for a real classifier or a cheap LLM
    call if you need smarter routing later.
    Complex tier triggers on: long question, low retrieval confidence
    (model needs to reason more / hedge), or explicit escalation language.
    """
    long_question = len(question) > 220
    low_confidence = retrieval_score < settings.retrieval_confidence_threshold
    escalation_words = ("compare", "explain why", "difference between", "recommend")
    needs_reasoning = any(w in question.lower() for w in escalation_words)

    if long_question or low_confidence or needs_reasoning:
        return "complex"
    return "fast"


class ModelStream:
    """
    Iterable of text deltas. `.model` is set at the first real token and names the
    model that actually answered (Groq, or an OpenRouter fallback) - the chat
    event records it so the admin dashboard shows the true model.
    """

    def __init__(self, messages: list[dict], tier: str):
        self._messages = messages
        self._tier = tier
        self.model: str | None = None

    def __iter__(self) -> Iterator[str]:
        first_error: Exception | None = None
        for model, make in _providers(self._messages, self._tier):
            started = False
            pending = ""  # whitespace-only start is held back: a blank answer is "empty"
            try:
                for delta in make():
                    if started:
                        yield delta
                        continue
                    pending += delta
                    if pending.strip():
                        started = True
                        self.model = model
                        yield pending
                if started:
                    if model != self._primary():
                        logger.warning("LLM fallback: answered by %s", model)
                    return
                logger.warning("LLM provider %s returned an empty answer", model)
            except Exception as exc:
                if started:
                    raise  # already streamed text: never switch model mid-answer
                logger.warning("LLM provider %s failed before first token: %s: %s",
                               model, type(exc).__name__, exc)
                first_error = first_error or exc
        if first_error is not None:
            raise first_error

    def _primary(self) -> str:
        return _groq_model(self._tier)


def _groq_model(tier: str) -> str:
    return settings.groq_fast_model if tier == "fast" else settings.groq_complex_model


def _openrouter_models() -> list[str]:
    """Fallback models from OPENROUTER_MODELS (in order); empty when no key is set."""
    if not settings.openrouter_api_key:
        return []
    return [m.strip() for m in settings.openrouter_models.split(",") if m.strip()]


def _providers(messages: list[dict], tier: str):
    """(model name, factory) pairs in the order they are tried: Groq, then OpenRouter."""
    yield _groq_model(tier), lambda: _stream_groq(messages, tier)
    for model in _openrouter_models():
        yield model, (lambda m=model: _stream_openrouter(m, messages))


def stream_completion(
    question: str,
    context_chunks: list[str],
    history: list[dict],
    tier: str,
) -> ModelStream:
    """Iterate for text deltas (SSE streaming). Groq first, OpenRouter models as fallback."""
    return ModelStream(_build_prompt(question, context_chunks, history), tier)


def _stream_groq(messages: list[dict], tier: str) -> Iterator[str]:
    from groq import Groq

    client = Groq(api_key=settings.groq_api_key, timeout=settings.llm_timeout_seconds, max_retries=1)
    model = _groq_model(tier)

    stream = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        stream=True,
        temperature=0.2,
        max_tokens=MAX_ANSWER_TOKENS,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def _stream_openrouter(model: str, messages: list[dict]) -> Iterator[str]:
    """OpenRouter chat completions over SSE ("data: {json}" lines, ends with [DONE])."""
    import httpx

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        "stream": True,
        "temperature": 0.2,
        "max_tokens": MAX_ANSWER_TOKENS,
    }
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}"}
    with httpx.Client(timeout=settings.openrouter_timeout_seconds) as client:
        with client.stream("POST", OPENROUTER_URL, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                line = line.strip()
                if not line or line.startswith(":"):  # blank / ": OPENROUTER PROCESSING" keep-alive
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    obj = json.loads(data)
                except ValueError:
                    continue
                if obj.get("error"):
                    raise RuntimeError(f"OpenRouter stream error: {obj['error']}")
                choices = obj.get("choices") or []
                delta = (choices[0].get("delta") or {}).get("content") if choices else None
                if delta:
                    yield delta


def _complete_groq(system: str, user: str, max_tokens: int) -> str:
    from groq import Groq

    client = Groq(api_key=settings.groq_api_key, timeout=settings.llm_timeout_seconds, max_retries=1)
    resp = client.chat.completions.create(
        model=settings.groq_fast_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=max_tokens,
        temperature=0,
    )
    return (resp.choices[0].message.content or "").strip()


def _complete_openrouter(model: str, system: str, user: str, max_tokens: int) -> str:
    import httpx

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_tokens": max_tokens,
        "temperature": 0,
    }
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}"}
    resp = httpx.post(OPENROUTER_URL, json=payload, headers=headers, timeout=settings.openrouter_timeout_seconds)
    resp.raise_for_status()
    choices = resp.json().get("choices") or []
    return ((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""


def complete_short(system: str, user: str, max_tokens: int = 100) -> str:
    """Small non-streaming completion on the FAST tier (query rewriting etc.). Same fallback as streaming."""
    first_error: Exception | None = None
    attempts = [(settings.groq_fast_model, lambda: _complete_groq(system, user, max_tokens))]
    attempts += [(m, (lambda m=m: _complete_openrouter(m, system, user, max_tokens))) for m in _openrouter_models()]
    for i, (model, call) in enumerate(attempts):
        try:
            text = call()
        except Exception as exc:
            logger.warning("LLM provider %s failed (short completion): %s: %s", model, type(exc).__name__, exc)
            first_error = first_error or exc
            continue
        if text:
            if i > 0:
                logger.warning("LLM fallback: short completion answered by %s", model)
            return text
        logger.warning("LLM provider %s returned an empty short completion", model)
    if first_error is not None:
        raise first_error
    return ""


def rewrite_standalone(question: str, history: list[dict]) -> str:
    """
    Turn a follow-up ("how many days is that?") into a standalone question
    ("how many days is the refund window?") so retrieval and the answer cache
    work. No history -> returned unchanged with zero LLM calls. Any failure
    falls back to the original question. The result is used ONLY for retrieval
    and cache keys, never shown to the user or fed to the answering prompt.
    """
    if not history:
        return question
    convo = "\n".join(
        f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content'][:300]}"
        for m in history[-4:]
    )
    user_prompt = f"Conversation:\n{convo}\n\nLast user message: {question}\n\nStandalone question:"
    try:
        rewritten = complete_short(REWRITE_SYSTEM_PROMPT, user_prompt, max_tokens=80)
    except Exception:
        return question
    rewritten = rewritten.strip().splitlines()[0].strip().strip('"') if rewritten.strip() else ""
    if not rewritten or len(rewritten) > 400:
        return question
    return rewritten