import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Float, Index, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.config import settings
from app.db.session import Base


class Document(Base):
    """A source document (a page, FAQ entry, policy doc) that gets chunked."""

    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=False)
    url = Column(String, nullable=True)
    category = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    """A retrieval unit: a slice of a document, with its embedding."""

    __tablename__ = "chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    content = Column(Text, nullable=False)
    # header/section context prepended at ingest time — improves retrieval
    header_context = Column(String, nullable=True)
    embedding = Column(Vector(settings.embedding_dim), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="chunks")


class ConversationMessage(Base):
    """Persistent chat history (Redis holds the hot/recent copy)."""

    __tablename__ = "conversation_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    retrieval_score = Column(Float, nullable=True)  # top chunk score, for eval/debug
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatEvent(Base):
    """
    One row per visitor message (whatever happened to it): feeds the admin
    dashboard - usage, estimated cost, unanswered questions. New table, so an
    existing database picks it up automatically at startup (create_all).
    """

    __tablename__ = "chat_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    session_id = Column(String, nullable=False, index=True)
    # answered | cache_hit | low_confidence_fallback | smalltalk | blocked_regex |
    # blocked_nemo | budget_exhausted | error_*
    outcome = Column(String, nullable=False, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    tier = Column(String, nullable=True)
    model = Column(String, nullable=True)
    input_tokens = Column(Integer, default=0)   # estimated (~4 chars/token)
    output_tokens = Column(Integer, default=0)  # estimated
    cost_usd = Column(Float, default=0.0)       # estimated from the price table
    latency_ms = Column(Integer, nullable=True)


Index("ix_chunks_document_id", Chunk.document_id)
