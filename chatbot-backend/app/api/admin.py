"""
Admin dashboard API (all routes need the X-Admin-Key header).

  GET    /v1/admin/stats?days=30         totals, per-day series, per-model cost, outcome mix
  GET    /v1/admin/conversations         visitor questions + answers, filter / search / paginate
  GET    /v1/admin/pricing               the price table used for cost estimates
  DELETE /v1/admin/events?older_than_days=N   retention: delete old logs (privacy)

Documents (upload / list / delete) live in ingest.py; today's cap usage in health.py.
Costs are ESTIMATES - see app/core/pricing.py.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core import pricing
from app.db.models import ChatEvent, ConversationMessage
from app.db.session import get_db
from app.core.security import require_admin

router = APIRouter(prefix="/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])

ANSWERED = ("answered", "cache_hit")
NOT_ANSWERED = ("low_confidence_fallback",)

# filter name used by the dashboard -> SQL condition
def _outcome_filter(name: str):
    if name == "answered":
        return ChatEvent.outcome.in_(ANSWERED)
    if name == "not_answered":
        return ChatEvent.outcome.in_(NOT_ANSWERED)
    if name == "blocked":
        return ChatEvent.outcome.like("blocked\\_%", escape="\\")
    if name == "error":
        return ChatEvent.outcome.like("error\\_%", escape="\\") | (ChatEvent.outcome == "budget_exhausted")
    if name == "smalltalk":
        return ChatEvent.outcome == "smalltalk"
    return ChatEvent.outcome == name  # an exact outcome string


def _round(x, n=6):
    return round(float(x or 0), n)


@router.get("/stats")
def stats(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(days=days)
    base = db.query(ChatEvent).filter(ChatEvent.created_at >= since)

    t = (
        db.query(
            func.count(ChatEvent.id),
            func.count(func.distinct(ChatEvent.session_id)),
            func.coalesce(func.sum(ChatEvent.cost_usd), 0.0),
            func.coalesce(func.sum(ChatEvent.input_tokens), 0),
            func.coalesce(func.sum(ChatEvent.output_tokens), 0),
            func.avg(ChatEvent.confidence),
            func.avg(ChatEvent.latency_ms),
        )
        .filter(ChatEvent.created_at >= since)
        .one()
    )
    by_outcome = {
        o: n
        for o, n in db.query(ChatEvent.outcome, func.count(ChatEvent.id))
        .filter(ChatEvent.created_at >= since)
        .group_by(ChatEvent.outcome)
        .all()
    }
    answered = sum(by_outcome.get(o, 0) for o in ANSWERED)
    not_answered = sum(by_outcome.get(o, 0) for o in NOT_ANSWERED)
    blocked = sum(n for o, n in by_outcome.items() if o.startswith("blocked_"))
    errors = sum(n for o, n in by_outcome.items() if o.startswith("error_")) + by_outcome.get("budget_exhausted", 0)
    llm_answers = by_outcome.get("answered", 0)
    day_col = func.date(ChatEvent.created_at)
    rows = (
        db.query(
            day_col,
            func.count(ChatEvent.id),
            func.coalesce(func.sum(case((ChatEvent.outcome.in_(ANSWERED), 1), else_=0)), 0),
            func.coalesce(func.sum(case((ChatEvent.outcome.in_(NOT_ANSWERED), 1), else_=0)), 0),
            func.coalesce(func.sum(ChatEvent.cost_usd), 0.0),
        )
        .filter(ChatEvent.created_at >= since)
        .group_by(day_col)
        .all()
    )
    per_day = {str(d): (n, a, na, c) for d, n, a, na, c in rows}
    daily = []
    today = datetime.utcnow().date()
    for i in range(days - 1, -1, -1):
        d = str(today - timedelta(days=i))
        n, a, na, c = per_day.get(d, (0, 0, 0, 0.0))
        daily.append({"day": d, "messages": n, "answered": a, "not_answered": na, "cost_usd": _round(c)})

    prices = pricing.price_table()
    by_model = [
        {
            "model": m,
            "answers": n,
            "input_tokens": int(i),
            "output_tokens": int(o),
            "cost_usd": _round(c),
            "priced": pricing.is_priced(m),
        }
        for m, n, i, o, c in db.query(
            ChatEvent.model,
            func.count(ChatEvent.id),
            func.coalesce(func.sum(ChatEvent.input_tokens), 0),
            func.coalesce(func.sum(ChatEvent.output_tokens), 0),
            func.coalesce(func.sum(ChatEvent.cost_usd), 0.0),
        )
        .filter(ChatEvent.created_at >= since, ChatEvent.model.isnot(None), ChatEvent.input_tokens > 0)
        .group_by(ChatEvent.model)
        .order_by(func.sum(ChatEvent.cost_usd).desc())
        .all()
    ]

    total = t[0] or 0
    return {
        "period_days": days,
        "totals": {
            "messages": total,
            "sessions": t[1] or 0,
            "answered": answered,
            "llm_answers": llm_answers,
            "cache_hits": by_outcome.get("cache_hit", 0),
            "not_answered": not_answered,
            "smalltalk": by_outcome.get("smalltalk", 0),
            "blocked": blocked,
            "errors": errors,
            "answer_rate": round(answered / total, 4) if total else None,
            "avg_confidence": round(float(t[5]), 4) if t[5] is not None else None,
            "avg_latency_ms": int(t[6]) if t[6] is not None else None,
            "cost_usd": _round(t[2]),
            "input_tokens": int(t[3]),
            "output_tokens": int(t[4]),
            "cost_per_llm_answer_usd": _round(t[2] / llm_answers, 6) if llm_answers else None,
        },
        "by_outcome": by_outcome,
        "daily": daily,
        "by_model": by_model,
        "cost_note": "Estimated from ~4 characters/token and list prices; excludes small guardrail/rewrite calls. Compare with your provider's usage page.",
    }


@router.get("/conversations")
def conversations(
    outcome: str | None = Query(None, max_length=40),
    q: str | None = Query(None, max_length=200),
    days: int | None = Query(None, ge=1, le=3650),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(ChatEvent)
    if outcome and outcome != "all":
        query = query.filter(_outcome_filter(outcome))
    if days:
        query = query.filter(ChatEvent.created_at >= datetime.utcnow() - timedelta(days=days))
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.filter(ChatEvent.question.ilike(like, escape="\\") | ChatEvent.answer.ilike(like, escape="\\"))
    total = query.count()
    rows = query.order_by(ChatEvent.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(e.id),
                "created_at": e.created_at.isoformat() + "Z" if e.created_at else None,
                "session": (e.session_id or "")[:8],
                "outcome": e.outcome,
                "question": e.question,
                "answer": e.answer,
                "confidence": e.confidence,
                "model": e.model,
                "tier": e.tier,
                "cost_usd": _round(e.cost_usd),
                "latency_ms": e.latency_ms,
            }
            for e in rows
        ],
    }


@router.get("/pricing")
def get_pricing():
    return {
        "unit": "USD per 1M tokens",
        "models": [{"model": m, "input": p[0], "output": p[1]} for m, p in sorted(pricing.price_table().items())],
        "how_to_change": "Set MODEL_PRICES_JSON in the backend .env, e.g. {\"my-model\": [0.2, 0.8]}, then restart.",
    }


@router.delete("/events")
def delete_old_events(older_than_days: int = Query(..., ge=1, le=3650), db: Session = Depends(get_db)):
    """Retention: remove analytics rows AND stored chat history older than N days."""
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    try:
        events = db.query(ChatEvent).filter(ChatEvent.created_at < cutoff).delete(synchronize_session=False)
        messages = (
            db.query(ConversationMessage).filter(ConversationMessage.created_at < cutoff).delete(synchronize_session=False)
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="delete_failed") from exc
    return {"deleted_events": events, "deleted_messages": messages, "older_than_days": older_than_days}