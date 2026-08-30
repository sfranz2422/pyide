"""
PyIDE — a browser-based Python IDE for intro programming classes.

Student code runs entirely in the browser via Pyodide (Python compiled to
WebAssembly). The server only stores and serves shared code snapshots, so
there is no sandboxing or CPU cost per student run.
"""

import os
import re
import secrets
from datetime import datetime, timezone

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)
from sqlalchemy import Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

MAX_CODE_BYTES = 200_000          # ~200 KB, generous for a class assignment
ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no look-alike characters
ID_LENGTH = 7

DEFAULT_CODE = '''# Welcome to Python!
# Write your code here, then press Run (or Ctrl+Enter).

name = input("What is your name? ")
print("Hello, " + name + "!")

for i in range(1, 6):
    print(i, "squared is", i * i)
'''


def _database_url() -> str:
    """Render supplies DATABASE_URL; fall back to a local SQLite file."""
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        return "sqlite:///" + os.path.join(os.path.dirname(__file__), "pyide.db")
    # SQLAlchemy 2.x wants the postgresql:// scheme, Render hands out postgres://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------

Base = declarative_base()


class Snippet(Base):
    __tablename__ = "snippets"

    id = Column(Integer, primary_key=True)
    slug = Column(String(16), unique=True, index=True, nullable=False)
    title = Column(String(120), nullable=False, default="Untitled")
    author = Column(String(80), nullable=False, default="")
    code = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False,
                        default=lambda: datetime.now(timezone.utc))


engine = create_engine(
    _database_url(),
    pool_pre_ping=True,
    connect_args={"check_same_thread": False}
    if _database_url().startswith("sqlite")
    else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base.metadata.create_all(engine)


def new_slug(db) -> str:
    """Random short id, retried on the (very unlikely) collision."""
    for _ in range(12):
        slug = "".join(secrets.choice(ID_ALPHABET) for _ in range(ID_LENGTH))
        if not db.query(Snippet.id).filter_by(slug=slug).first():
            return slug
    raise RuntimeError("could not allocate a share id")


def clean(value, limit) -> str:
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    return value[:limit]


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

app = Flask(__name__)


@app.get("/")
def index():
    return render_template(
        "index.html",
        code=DEFAULT_CODE,
        title="Untitled",
        author="",
        readonly=False,
        slug=None,
        shared_at=None,
    )


@app.get("/s/<slug>")
def view_shared(slug):
    db = SessionLocal()
    try:
        snip = db.query(Snippet).filter_by(slug=slug).first()
        if snip is None:
            abort(404)
        return render_template(
            "index.html",
            code=snip.code,
            title=snip.title,
            author=snip.author,
            readonly=True,
            slug=snip.slug,
            shared_at=snip.created_at.strftime("%b %d, %Y at %I:%M %p UTC"),
        )
    finally:
        db.close()


@app.get("/s/<slug>/fork")
def fork_shared(slug):
    """Open a shared snapshot as an editable copy."""
    db = SessionLocal()
    try:
        snip = db.query(Snippet).filter_by(slug=slug).first()
        if snip is None:
            abort(404)
        return render_template(
            "index.html",
            code=snip.code,
            title=f"Copy of {snip.title}",
            author="",
            readonly=False,
            slug=None,
            shared_at=None,
        )
    finally:
        db.close()


@app.get("/s/<slug>/raw")
def raw_shared(slug):
    db = SessionLocal()
    try:
        snip = db.query(Snippet).filter_by(slug=slug).first()
        if snip is None:
            abort(404)
        return snip.code, 200, {"Content-Type": "text/plain; charset=utf-8"}
    finally:
        db.close()


@app.post("/api/share")
def create_share():
    data = request.get_json(silent=True) or {}
    code = data.get("code", "")

    if not isinstance(code, str) or not code.strip():
        return jsonify(error="There's no code to share yet."), 400
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        return jsonify(error="That program is too large to share."), 413

    db = SessionLocal()
    try:
        snip = Snippet(
            slug=new_slug(db),
            title=clean(data.get("title"), 120) or "Untitled",
            author=clean(data.get("author"), 80),
            code=code,
        )
        db.add(snip)
        db.commit()
        return jsonify(
            slug=snip.slug,
            url=url_for("view_shared", slug=snip.slug, _external=True),
        )
    finally:
        db.close()


@app.errorhandler(404)
def not_found(_):
    return render_template("404.html"), 404


@app.get("/healthz")
def healthz():
    return "ok"


if __name__ == "__main__":
    app.run(debug=True, port=5000)
