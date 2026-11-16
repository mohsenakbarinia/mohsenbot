"""Initial PostgreSQL + pgvector schema for NEXORA AI.

Revision ID: 001_initial_pgvector
Revises:
Create Date: 2026-11-16
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision = "001_initial_pgvector"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_id", sa.String(64), unique=True, index=True),
        sa.Column("username", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("language", sa.String(8), nullable=False, server_default="fa"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("daily_token_limit", sa.Integer(), nullable=False, server_default="150000"),
        sa.Column("monthly_token_limit", sa.Integer(), nullable=False, server_default="2500000"),
        sa.Column("daily_request_limit", sa.Integer(), nullable=False, server_default="250"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "memory_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("category", sa.String(48), nullable=False),
        sa.Column("topic_key", sa.String(96), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("source", sa.String(24), nullable=False, server_default="auto"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "memory_embeddings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("memory_id", sa.Integer(), sa.ForeignKey("memory_records.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("embedding", Vector(768), nullable=False),
        sa.Column("model_name", sa.String(96), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("memory_embeddings")
    op.drop_table("memory_records")
    op.drop_table("users")
