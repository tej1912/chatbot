"""
Per-message record of what happened (no external service).

One Trace is created for each chat message. The chat service fills it in as
it goes (outcome, retrieval confidence, model used, timings) and, when the
answer is finished, stores one `chat_events` row from it for the admin
dashboard. Everything here is in memory and cheap, so it is safe on the hot
path.
"""
import time


class Trace:
    """Collects facts about one chat message."""

    def __init__(self, session_id: str, message: str):
        self.session_id = session_id
        self.message = message
        self.meta: dict = {}
        self.chunks: list[dict] | None = None
        self.llm: dict | None = None
        self._t0 = time.time()
        self._marks: dict[str, float] = {}

    def note(self, **meta) -> None:
        self.meta.update(meta)

    def mark(self, name: str) -> None:
        self._marks[name] = time.time()

    def elapsed_ms(self) -> int:
        return int((time.time() - self._t0) * 1000)

    def retrieval(self, chunks: list[dict], confidence: float) -> None:
        self.chunks = chunks
        self.meta["confidence"] = round(confidence, 4)

    def generation(self, model: str, tier: str, input_tokens: int) -> None:
        self.llm = {"model": model, "tier": tier, "input_tokens": input_tokens}

    def finish(self, output: str, outcome: str) -> None:
        self.meta["outcome"] = outcome


def begin(session_id: str, message: str) -> Trace:
    return Trace(session_id, message)
