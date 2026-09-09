"""
PyIDE — a browser-based Python IDE for intro programming classes.

Student code runs entirely in the browser via Pyodide (Python compiled to
WebAssembly). The server only stores and serves shared code snapshots, so
there is no sandboxing or CPU cost per student run.
"""

import json
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
MAX_FILES = 12
MAX_FILE_BYTES = 100_000          # per attached data file
MAX_FILES_TOTAL = 400_000         # all attached files together
ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no look-alike characters
ID_LENGTH = 7

# Files students can attach: data for the program to read, notes to display,
# and other .py modules for it to import. main.py is the one thing that runs,
# so it is the one name that can't be attached — it arrives as `code`.
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,50}\.[A-Za-z0-9]{1,8}$")

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
    # attached data files, as a JSON object of {filename: contents}
    files = Column(Text, nullable=False, default="{}")
    # A demo snapshot: reachable only at /d/<slug>, which shows the output and
    # never the program. One flag decides everything — a hidden snapshot is
    # refused by /s, /fork and /raw alike, so there is no second door to forget
    # about and nothing to gain by editing the letter in the URL.
    hidden = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False,
                        default=lambda: datetime.now(timezone.utc))

    def file_map(self) -> dict:
        try:
            data = json.loads(self.files or "{}")
            return data if isinstance(data, dict) else {}
        except (ValueError, TypeError):
            return {}

    @property
    def is_hidden(self) -> bool:
        # rows written before this column existed come back as NULL
        return bool(self.hidden)


engine = create_engine(
    _database_url(),
    pool_pre_ping=True,
    connect_args={"check_same_thread": False}
    if _database_url().startswith("sqlite")
    else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
Base.metadata.create_all(engine)


# Columns added after the table first shipped, with the DDL to add each one.
# Every default has to make an existing row correct: an old snapshot has no
# attached files and is not a demo.
LATER_COLUMNS = [
    ("files", "ALTER TABLE snippets ADD COLUMN files TEXT NOT NULL DEFAULT '{}'"),
    ("hidden", "ALTER TABLE snippets ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0"),
]


def _add_missing_columns() -> None:
    """Bring an older deployment's table up to date.

    create_all() only creates missing tables, never missing columns, so a
    database written before a column existed would break on the first query.
    Each ALTER runs only when its column is absent, so this is safe to run on
    every boot — which it does, because Render restarts a service on deploy
    and there is no migration step to remember.
    """
    from sqlalchemy import inspect, text

    try:
        existing = {c["name"] for c in inspect(engine).get_columns("snippets")}
    except Exception:
        return
    for name, ddl in LATER_COLUMNS:
        if name in existing:
            continue
        with engine.begin() as conn:
            try:
                conn.execute(text(ddl))
            except Exception:
                pass


_add_missing_columns()


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


def validate_files(raw):
    """Check an incoming {name: contents} map. Returns (files, error)."""
    if raw in (None, ""):
        return {}, None
    if not isinstance(raw, dict):
        return None, "Those attached files could not be read."
    if len(raw) > MAX_FILES:
        return None, "A project can hold at most %d files." % MAX_FILES

    files, total = {}, 0
    for name, body in raw.items():
        name = str(name).strip()
        # no directories, no traversal — these are plain names in one folder
        if "/" in name or "\\" in name or name in (".", ".."):
            return None, "'%s' is not a valid file name." % name
        if not FILE_NAME.match(name):
            return None, ("'%s' is not a valid file name. Use letters, digits, "
                          "dashes and underscores, and end with an extension "
                          "like .txt or .csv." % name)
        if name.lower() == "main.py":
            return None, ("main.py is the program itself and is saved with the "
                          "project, so it can't also be attached as a file.")
        if not isinstance(body, str):
            return None, "'%s' could not be read as text." % name
        size = len(body.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            return None, "'%s' is too large to save." % name
        total += size
        if total > MAX_FILES_TOTAL:
            return None, "Those files are too large to save together."
        files[name] = body
    return files, None


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

app = Flask(__name__)


@app.get("/")
def index():
    return render_template(
        "index.html",
        code=DEFAULT_CODE,
        files={},
        title="Untitled",
        author="",
        readonly=False,
        # only here can notes be written; shared snapshots and forks show them
        # rendered and never expose the markdown source
        authoring=True,
        slug=None,
        shared_at=None,
    )


def load_visible(db, slug):
    """A snapshot the /s routes are allowed to serve.

    A demo snapshot is not one of them. Changing /d/abc to /s/abc is the first
    thing anyone tries, so the refusal lives here rather than in the template:
    the code never leaves the database for a hidden row, whatever the URL says.
    """
    snip = db.query(Snippet).filter_by(slug=slug).first()
    if snip is None or snip.is_hidden:
        abort(404)
    return snip


@app.get("/s/<slug>")
def view_shared(slug):
    db = SessionLocal()
    try:
        snip = load_visible(db, slug)
        return render_template(
            "index.html",
            code=snip.code,
            files=snip.file_map(),
            title=snip.title,
            author=snip.author,
            readonly=True,
            authoring=False,
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
        snip = load_visible(db, slug)
        return render_template(
            "index.html",
            code=snip.code,
            files=snip.file_map(),
            title=f"Copy of {snip.title}",
            author="",
            readonly=False,
            authoring=False,
            slug=None,
            shared_at=None,
        )
    finally:
        db.close()


@app.get("/s/<slug>/raw")
def raw_shared(slug):
    db = SessionLocal()
    try:
        snip = load_visible(db, slug)
        return snip.code, 200, {"Content-Type": "text/plain; charset=utf-8"}
    finally:
        db.close()


# --------------------------------------------------------------------------
# Demo links — output only, no code on display
# --------------------------------------------------------------------------
#
# The program still has to reach the browser: Pyodide runs it there, which is
# what makes the whole IDE free to run and impossible to abuse. So this is not
# encryption and it is not sold as such. What it does is remove every ordinary
# way of reading the code — there is no editor on the page, no markup holding
# the source, no /raw, no fork, and no Download. Recovering it means opening
# the network panel on purpose, which is a different kind of student from the
# one who presses Ctrl+U out of curiosity.


def load_demo(db, slug):
    snip = db.query(Snippet).filter_by(slug=slug).first()
    if snip is None or not snip.is_hidden:
        abort(404)
    return snip


@app.get("/d/<slug>")
def view_demo(slug):
    db = SessionLocal()
    try:
        snip = load_demo(db, slug)
        # Deliberately no code and no file contents in this render: the page
        # asks for them separately, and only once Run is pressed.
        return render_template("demo.html", title=snip.title, slug=snip.slug)
    finally:
        db.close()


@app.get("/d/<slug>/source")
def demo_source(slug):
    """What the demo page fetches when Run is pressed."""
    db = SessionLocal()
    try:
        snip = load_demo(db, slug)
        response = jsonify(code=snip.code, files=snip.file_map())
        # Nothing here should sit in a shared cache or turn up in a search
        # result, and a stale copy would be a stale demo.
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response
    finally:
        db.close()


@app.post("/api/share")
def create_share():
    data = request.get_json(silent=True) or {}
    code = data.get("code", "")
    author = clean(data.get("author"), 80)

    if not isinstance(code, str) or not code.strip():
        return jsonify(error="There's no code to share yet."), 400
    if len(code.encode("utf-8")) > MAX_CODE_BYTES:
        return jsonify(error="That program is too large to share."), 413
    # a submission nobody can be identified from is no use to a teacher
    if not author:
        return jsonify(error="Put your name in before sharing.",
                       field="author"), 400

    files, file_error = validate_files(data.get("files"))
    if file_error:
        return jsonify(error=file_error), 400

    hidden = bool(data.get("hidden"))

    db = SessionLocal()
    try:
        snip = Snippet(
            slug=new_slug(db),
            title=clean(data.get("title"), 120) or "Untitled",
            author=author,
            code=code,
            files=json.dumps(files),
            hidden=1 if hidden else 0,
        )
        db.add(snip)
        db.commit()
        route = "view_demo" if hidden else "view_shared"
        return jsonify(
            slug=snip.slug,
            hidden=hidden,
            url=url_for(route, slug=snip.slug, _external=True),
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
