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
    session,
    url_for,
)
from sqlalchemy import Column, DateTime, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

import accounts

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

# Signing in, saved work, assignments and turning in. Its own metadata, so it
# creates only its own tables and never touches snippets or WebIDE's.
accounts.create_all(engine)


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

# Signed session cookies. Generated if unset so the app still boots locally,
# but then every restart logs everyone out — set it properly on the server.
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",       # Lax, not Strict: the OAuth redirect
                                        # arrives from Google and must carry
                                        # the cookie or login silently fails
    SESSION_COOKIE_SECURE=bool(os.environ.get("DATABASE_URL")),
)

# --------------------------------------------------------------------------
# Signing in
# --------------------------------------------------------------------------
# Entirely optional. With no Google credentials set, `oauth` stays None, the
# sign-in button never renders, and every route below behaves as it did before
# any of this existed.

oauth = None
if accounts.login_configured():
    from authlib.integrations.flask_client import OAuth

    oauth = OAuth(app)
    oauth.register(
        name="google",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        server_metadata_url=(
            "https://accounts.google.com/.well-known/openid-configuration"
        ),
        client_kwargs={"scope": "openid email profile"},
    )


def current_user(db):
    """The signed-in user, or None. Never raises."""
    uid = session.get("uid")
    if not uid:
        return None
    return db.query(accounts.User).filter_by(id=uid).first()


def user_context(db):
    """What every template needs to know about who is looking."""
    user = current_user(db)
    return {
        "login_enabled": accounts.login_configured(),
        "user": user,
        "user_name": user.display_name() if user else "",
        "user_email": user.email if user else "",
        "is_teacher": bool(user and accounts.is_teacher(user.email)),
    }


@app.context_processor
def inject_user():
    """Available to every template, so no page can forget who is looking."""
    db = SessionLocal()
    try:
        return user_context(db)
    finally:
        db.close()


@app.get("/login")
def login():
    if not oauth:
        abort(404)
    # Where to go afterwards, so a student who signs in from an assignment
    # link lands back on that assignment rather than on a blank editor.
    nxt = request.args.get("next", "")
    session["after_login"] = nxt if nxt.startswith("/") else ""
    return oauth.google.authorize_redirect(
        url_for("auth_callback", _external=True, _scheme=_scheme())
    )


def _scheme():
    """Render terminates TLS in front of us, so url_for sees plain http."""
    return "https" if os.environ.get("DATABASE_URL") else "http"


@app.get("/auth/callback")
def auth_callback():
    if not oauth:
        abort(404)
    try:
        token = oauth.google.authorize_access_token()
    except Exception:
        return render_template("signin_problem.html",
                               reason="That sign-in didn't complete."), 400

    info = token.get("userinfo") or {}
    sub = info.get("sub")
    email = (info.get("email") or "").strip()

    # Checked here, on the server, from the verified token — never from
    # anything the browser handed us.
    if not sub or not email or not info.get("email_verified"):
        return render_template("signin_problem.html",
                               reason="Google didn't confirm that address."), 400
    if not accounts.email_allowed(email):
        return render_template(
            "signin_problem.html",
            reason="%s isn't a school account for this site. Sign in with "
                   "your school address." % email), 403

    db = SessionLocal()
    try:
        user = db.query(accounts.User).filter_by(google_sub=sub).first()
        if user is None:
            user = accounts.User(google_sub=sub, email=email,
                                 name=info.get("name") or "")
            db.add(user)
        else:
            user.email = email                     # a school can rename a mailbox
            user.name = info.get("name") or user.name
            user.last_seen = accounts.now()
        db.commit()
        session["uid"] = user.id
    finally:
        db.close()

    return redirect(session.pop("after_login", "") or url_for("index"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(request.args.get("next") or url_for("index"))


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


# --------------------------------------------------------------------------
# Saved work
# --------------------------------------------------------------------------
# A draft is a student's living copy: it autosaves as they type and is found
# again by who they are, not by a link they have to keep. There is exactly one
# per student per assignment, so opening the assignment link a week later
# returns them to their own work rather than to a fresh starter.

def _draft_payload(db, draft, extra=None):
    ctx = user_context(db)
    ctx.update(
        code=draft.code,
        files=draft.file_map(),
        title=draft.title,
        author=ctx["user_name"],
        readonly=False,
        authoring=False,
        slug=None,
        shared_at=None,
        draft_slug=draft.slug,
    )
    ctx.update(extra or {})
    return ctx


@app.get("/p/<slug>")
def open_draft(slug):
    """A student's own saved project."""
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return redirect(url_for("login", next=request.path))
        draft = db.query(accounts.Draft).filter_by(slug=slug).first()
        if draft is None:
            abort(404)
        # Somebody else's work is simply not found, rather than forbidden —
        # there is no reason to confirm that a given link belongs to anyone.
        if draft.owner_id != user.id:
            abort(404)

        assignment = None
        if draft.assignment_id:
            assignment = db.query(accounts.Assignment).filter_by(
                id=draft.assignment_id).first()

        submitted = None
        if assignment:
            submitted = db.query(accounts.Submission).filter_by(
                assignment_id=assignment.id, student_id=user.id).first()

        return render_template("index.html", **_draft_payload(db, draft, {
            "assignment_title": assignment.title if assignment else "",
            "assignment_slug": assignment.slug if assignment else "",
            "submitted_at": submitted.submitted_at.strftime("%b %d at %I:%M %p")
                            if submitted else "",
        }))
    finally:
        db.close()


@app.post("/api/draft/<slug>")
def save_draft(slug):
    """Autosave. Called a moment after the student stops typing."""
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="not signed in"), 401
        draft = db.query(accounts.Draft).filter_by(slug=slug).first()
        if draft is None or draft.owner_id != user.id:
            return jsonify(error="no such project"), 404

        data = request.get_json(silent=True) or {}
        code = data.get("code", "")
        if not isinstance(code, str):
            return jsonify(error="bad code"), 400
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That program is too large to save."), 413

        files, file_error = validate_files(data.get("files"))
        if file_error:
            return jsonify(error=file_error), 400

        draft.code = code
        draft.files = json.dumps(files)
        draft.title = clean(data.get("title"), 200) or draft.title
        draft.updated_at = accounts.now()
        db.commit()
        return jsonify(saved_at=draft.updated_at.strftime("%I:%M %p"))
    finally:
        db.close()


@app.get("/api/my/projects")
def my_projects():
    """Everything this student has saved, newest first."""
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="not signed in"), 401
        rows = (db.query(accounts.Draft)
                  .filter_by(owner_id=user.id)
                  .order_by(accounts.Draft.updated_at.desc())
                  .limit(60).all())
        titles = {a.id: a.title for a in db.query(accounts.Assignment).all()}
        return jsonify(projects=[{
            "slug": d.slug,
            "title": d.title,
            "assignment": titles.get(d.assignment_id, ""),
            "updated": d.updated_at.strftime("%b %d, %I:%M %p"),
            "url": url_for("open_draft", slug=d.slug),
        } for d in rows])
    finally:
        db.close()


# --------------------------------------------------------------------------
# Assignments
# --------------------------------------------------------------------------

@app.post("/api/assignment")
def publish_assignment():
    """Turn whatever the teacher is looking at into an assignment link."""
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="Only a teacher can publish an assignment."), 403

        data = request.get_json(silent=True) or {}
        code = data.get("code", "")
        if not isinstance(code, str) or not code.strip():
            return jsonify(error="There's no code to hand out yet."), 400
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That program is too large."), 413

        files, file_error = validate_files(data.get("files"))
        if file_error:
            return jsonify(error=file_error), 400

        item = accounts.Assignment(
            slug=accounts.new_id(db, accounts.Assignment),
            teacher_id=user.id,
            title=clean(data.get("title"), 200) or "Untitled assignment",
            code=code,
            files=json.dumps(files),
        )
        db.add(item)
        db.commit()
        return jsonify(slug=item.slug,
                       url=url_for("open_assignment", slug=item.slug,
                                   _external=True, _scheme=_scheme()))
    finally:
        db.close()


@app.get("/a/<slug>")
def open_assignment(slug):
    """The link a teacher hands out.

    Signed in, this finds the student's own copy — or makes one the first
    time — and sends them to it. Signed out, it behaves exactly like a fork
    of a shared project always has: an editable copy that saves nothing. A
    student with no account, or whose sign-in is being awkward, can still do
    the work and share a link the old way.
    """
    db = SessionLocal()
    try:
        item = db.query(accounts.Assignment).filter_by(slug=slug).first()
        if item is None:
            abort(404)

        user = current_user(db)
        if user is None:
            ctx = user_context(db)
            ctx.update(
                code=item.code,
                files=item.file_map(),
                title=item.title,
                author="",
                readonly=False,
                authoring=False,
                slug=None,
                shared_at=None,
                draft_slug=None,
                assignment_title=item.title,
                assignment_slug=item.slug,
                submitted_at="",
                sign_in_hint=True,
            )
            return render_template("index.html", **ctx)

        draft = db.query(accounts.Draft).filter_by(
            owner_id=user.id, assignment_id=item.id).first()
        if draft is None:
            draft = accounts.Draft(
                slug=accounts.new_id(db, accounts.Draft),
                owner_id=user.id,
                assignment_id=item.id,
                title=item.title,
                code=item.code,
                files=item.files,
            )
            db.add(draft)
            db.commit()
        return redirect(url_for("open_draft", slug=draft.slug))
    finally:
        db.close()


# --------------------------------------------------------------------------
# Turning it in
# --------------------------------------------------------------------------

@app.post("/api/submit")
def turn_in():
    """Freeze the student's work and record it against the assignment.

    The frozen copy is an ordinary share snapshot, so what was handed in
    cannot change afterwards however much the student keeps tinkering.
    Turning in again replaces the row and points it at a newer snapshot.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="Sign in first, then you can turn work in."), 401

        data = request.get_json(silent=True) or {}
        draft = db.query(accounts.Draft).filter_by(
            slug=str(data.get("draft", ""))).first()
        if draft is None or draft.owner_id != user.id:
            return jsonify(error="no such project"), 404
        if not draft.assignment_id:
            return jsonify(error="This project isn't part of an assignment."), 400

        item = db.query(accounts.Assignment).filter_by(id=draft.assignment_id).first()
        if item is None:
            return jsonify(error="That assignment is gone."), 404
        if item.closed:
            return jsonify(error="That assignment is closed."), 403

        code = data.get("code", draft.code)
        files, file_error = validate_files(data.get("files"))
        if file_error:
            return jsonify(error=file_error), 400
        if not isinstance(code, str) or not code.strip():
            return jsonify(error="There's nothing to turn in yet."), 400

        # keep the draft in step, so the saved copy matches what was submitted
        draft.code = code
        draft.files = json.dumps(files)
        draft.updated_at = accounts.now()

        snap = Snippet(
            slug=new_slug(db),
            title=draft.title or item.title,
            author=user.display_name(),
            code=code,
            files=json.dumps(files),
        )
        db.add(snap)
        db.flush()

        row = db.query(accounts.Submission).filter_by(
            assignment_id=item.id, student_id=user.id).first()
        if row is None:
            row = accounts.Submission(assignment_id=item.id, student_id=user.id,
                                      snippet_slug=snap.slug)
            db.add(row)
        else:
            row.snippet_slug = snap.slug
            row.submitted_at = accounts.now()
            row.times_submitted = (row.times_submitted or 1) + 1
        db.commit()
        return jsonify(ok=True,
                       submitted_at=row.submitted_at.strftime("%b %d at %I:%M %p"),
                       again=row.times_submitted > 1)
    finally:
        db.close()


# --------------------------------------------------------------------------
# The teacher's view
# --------------------------------------------------------------------------

def _require_teacher(db):
    user = current_user(db)
    if user is None:
        return None, redirect(url_for("login", next=request.path))
    if not accounts.is_teacher(user.email):
        abort(404)                      # don't advertise that it exists
    return user, None


@app.get("/teacher")
def teacher_home():
    db = SessionLocal()
    try:
        user, bounce = _require_teacher(db)
        if bounce:
            return bounce
        items = (db.query(accounts.Assignment)
                   .filter_by(teacher_id=user.id)
                   .order_by(accounts.Assignment.created_at.desc()).all())
        counts = {}
        for item in items:
            counts[item.id] = db.query(accounts.Submission).filter_by(
                assignment_id=item.id).count()
        ctx = user_context(db)
        ctx.update(assignments=items, counts=counts)
        return render_template("teacher.html", **ctx)
    finally:
        db.close()


@app.get("/teacher/<slug>")
def teacher_assignment(slug):
    db = SessionLocal()
    try:
        user, bounce = _require_teacher(db)
        if bounce:
            return bounce
        item = db.query(accounts.Assignment).filter_by(slug=slug).first()
        if item is None or item.teacher_id != user.id:
            abort(404)

        rows = (db.query(accounts.Submission, accounts.User)
                  .join(accounts.User, accounts.Submission.student_id == accounts.User.id)
                  .filter(accounts.Submission.assignment_id == item.id)
                  .order_by(accounts.User.name).all())
        handed_in = [{
            "name": student.display_name(),
            "email": student.email,
            "when": sub.submitted_at.strftime("%b %d at %I:%M %p"),
            "times": sub.times_submitted,
            "url": url_for("view_shared", slug=sub.snippet_slug),
        } for sub, student in rows]

        # Anyone who opened the assignment but never pressed Turn in.
        started = (db.query(accounts.User)
                     .join(accounts.Draft, accounts.Draft.owner_id == accounts.User.id)
                     .filter(accounts.Draft.assignment_id == item.id).all())
        done = {s["email"] for s in handed_in}
        not_yet = sorted({u.email: u.display_name() for u in started
                          if u.email not in done}.values())

        ctx = user_context(db)
        ctx.update(assignment=item, handed_in=handed_in, not_yet=not_yet,
                   share_url=url_for("open_assignment", slug=item.slug,
                                     _external=True, _scheme=_scheme()))
        return render_template("teacher_assignment.html", **ctx)
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
