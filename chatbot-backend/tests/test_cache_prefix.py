"""Every Redis key the app creates must start with REDIS_PREFIX (shared Redis instance)."""
import pytest

from app.core import cache


class RecordingRedis:
    def __init__(self):
        self.keys: set[str] = set()
        self.store: dict[str, str] = {}

    def _seen(self, key):
        self.keys.add(key)

    def get(self, key):
        self._seen(key)
        return self.store.get(key)

    def set(self, key, value, ex=None):
        self._seen(key)
        self.store[key] = value

    def incr(self, key):
        self._seen(key)
        self.store[key] = str(int(self.store.get(key, 0)) + 1)
        return int(self.store[key])

    def decr(self, key):
        self._seen(key)

    def incrby(self, key, n):
        self._seen(key)
        self.store[key] = str(int(self.store.get(key, 0)) + n)

    def expire(self, key, secs):
        self._seen(key)

    def pipeline(self):
        outer = self

        class Pipe:
            def __getattr__(self, name):
                def call(key, *a, **k):
                    outer._seen(key)
                    return self
                return call

            def execute(self):
                return [0, 0, 1, True]

        return Pipe()


@pytest.fixture
def rec(monkeypatch):
    r = RecordingRedis()
    monkeypatch.setattr(cache, "_client", r)
    return r


def test_prefix_constant():
    assert cache.REDIS_PREFIX == "chatbot:"


def test_all_keys_are_prefixed(rec):
    cache.append_history("sess1", "user", "hi")
    cache.get_history("sess1")
    cache.set_cached_answer(None, [0.1] * 32, "answer")
    cache.get_cached_answer(None, [0.1] * 32)
    cache.bump_cache_version()
    cache.check_rate_limit("ip:1.2.3.4", 10, 60)
    cache.reserve_llm_budget(100)
    cache.get_budget_usage()

    assert rec.keys, "no keys were touched"
    bad = [k for k in rec.keys if not k.startswith(cache.REDIS_PREFIX)]
    assert not bad, f"unprefixed keys: {bad}"
    joined = " ".join(rec.keys)
    for part in ("history:", "semcache:", "semcache_version", "ratelimit:", "budget:"):
        assert part in joined
