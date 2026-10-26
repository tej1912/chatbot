"""
Price table + cost estimate for the admin dashboard.

Prices are USD per 1M tokens (input, output). Token counts in this project are
ESTIMATES (~4 characters per token) and the small guardrail / follow-up-rewrite
calls are not included, so treat the result as a budget indicator, not a bill.
Always compare with your provider's usage page. Override or add models with
MODEL_PRICES_JSON in .env, e.g. {"my-model": [0.2, 0.8]}.
"""
import json
import logging

from app.config import settings

logger = logging.getLogger("pricing")

# Groq's published rates. Add other models (e.g. a fallback provider) with MODEL_PRICES_JSON.
DEFAULT_PRICES: dict[str, tuple[float, float]] = {
    "openai/gpt-oss-20b": (0.075, 0.30),
    "openai/gpt-oss-120b": (0.15, 0.60),
}


def price_table() -> dict[str, tuple[float, float]]:
    table = dict(DEFAULT_PRICES)
    if settings.model_prices_json.strip():
        try:
            for model, pair in json.loads(settings.model_prices_json).items():
                table[str(model)] = (float(pair[0]), float(pair[1]))
        except Exception:
            logger.warning("MODEL_PRICES_JSON is not valid - ignoring it")
    return table


def estimate_cost(model: str | None, input_tokens: int, output_tokens: int) -> float:
    """USD estimate; 0.0 for an unknown model (the dashboard flags those as unpriced)."""
    if not model:
        return 0.0
    price = price_table().get(model)
    if not price:
        return 0.0
    return (input_tokens * price[0] + output_tokens * price[1]) / 1_000_000
