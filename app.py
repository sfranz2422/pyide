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
from datetime import datetime, timedelta, timezone

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

APP_NAME = "pyide"          # this editor, in the shared account tables

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

MAX_CODE_BYTES = 200_000          # ~200 KB, generous for a class assignment
LIVE_OUTPUT_BYTES = 20_000        # the tail of a Run, sent to the class
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

def _announce_login_settings():
    """One line in the logs on boot, so a wrong setting is visible without
    anyone having to fail a sign-in to discover it."""
    if not accounts.login_configured():
        print("[pyide] Google sign-in: OFF "
              "(set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable)")
        return
    domains = accounts.allowed_domains()
    print("[pyide] Google sign-in: ON — %s" % (
        ("only " + ", ".join("@" + d for d in domains)) if domains
        else "any Google account (ALLOWED_EMAIL_DOMAINS is empty)"))
    teachers = accounts.teacher_emails()
    print("[pyide] teachers: %s" % (", ".join(teachers) if teachers
                                    else "NONE SET — nobody can publish"))


_announce_login_settings()

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


_redirect_logged = [False]


@app.get("/login")
def login():
    if not oauth:
        abort(404)
    # Where to go afterwards, so a student who signs in from an assignment
    # link lands back on that assignment rather than on a blank editor.
    nxt = request.args.get("next", "")
    session["after_login"] = nxt if nxt.startswith("/") else ""
    target = url_for("auth_callback", _external=True, _scheme=_scheme())
    # Printed once per worker. Google's redirect_uri_mismatch page never says
    # which URI it objected to, so the exact string to paste into the Cloud
    # Console's "Authorized redirect URIs" is in the logs after a sign-in try.
    if not _redirect_logged[0]:
        _redirect_logged[0] = True
        print(f"[{APP_NAME}] redirect URI sent to Google: {target}", flush=True)
    try:
        return oauth.google.authorize_redirect(target)
    except Exception:
        # Authlib fetches Google's discovery document on the first sign-in of
        # each worker, so a network blip or a blocked outbound request lands
        # here. A student should see a sentence and a way onwards, not a
        # stack trace — and the editor still works without signing in.
        return render_template(
            "signin_problem.html",
            reason="Couldn't reach Google just now. Try again in a moment."), 503


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
        # Name the addresses that WOULD work. Without this the page can only
        # say "not allowed", which is useless to a student picking the wrong
        # account and worse for whoever set the variable to a placeholder.
        allowed = accounts.allowed_domains()
        wanted = " or ".join("@" + d for d in allowed)
        return render_template(
            "signin_problem.html",
            reason="You signed in as %s, but this site only accepts %s "
                   "addresses." % (email, wanted),
            allowed=allowed,
            tried=email), 403

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
    """Signing out ends any lesson this teacher is broadcasting here.

    The browser remembers a lesson so a reload resumes it, and nothing here
    can reach into localStorage to forget it. Ending the lesson is what makes
    that memory harmless: the next sign-in finds nothing open to resume. It
    is also what signing out means — nobody is at the keyboard any more, and
    the class should be told the lesson ended rather than watch a mirror that
    has quietly stopped.
    """
    uid = session.get("uid")
    if uid:
        db = SessionLocal()
        try:
            (db.query(accounts.LiveSession)
               .filter_by(host_id=uid, app=APP_NAME, ended=0)
               .update({"ended": 1, "updated_at": _live_now()},
                       synchronize_session=False))
            db.commit()
        except Exception:
            db.rollback()      # signing out must work even if this does not
        finally:
            db.close()
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
    # Authoring means "these notes are yours to edit", and it also decides
    # whether the notes pane can be selected at all. You own the notes in your
    # own project; on an assignment they belong to whoever set it, so a student
    # gets them read-only and uncopyable — but the teacher must not be locked
    # out of their own material.
    owns_notes = ctx["is_teacher"] or draft.assignment_id is None
    ctx.update(
        code=draft.code,
        files=draft.file_map(),
        title=draft.title,
        author=ctx["user_name"],
        readonly=False,
        authoring=owns_notes,
        slug=None,
        shared_at=None,
        draft_slug=draft.slug,
    )
    # HAS THIS COPY BEEN WORKED ON YET?
    #
    # Used by the rescue in the editor: a student who typed while signed out
    # and then signed in gets that work put back, and this decides whether it
    # can happen silently. A draft still identical to the starter has nothing
    # to lose, which is the ordinary case — the draft was made moments ago by
    # the very click that signed them in. Anything else gets asked about,
    # because restoring would destroy real work.
    ctx["draft_fresh"] = True
    if draft.assignment_id:
        starter = db.query(accounts.Assignment).filter_by(
            id=draft.assignment_id).first()
        if starter is not None:
            ctx["draft_fresh"] = (draft.code == starter.code
                                  and draft.file_map() == starter.file_map())
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


@app.post("/api/draft")
def start_draft():
    """Keep a project the student started themselves.

    Assignments make a draft automatically, so this covers the other two ways
    into the editor: a new project, or a fork of somebody's share link. Press
    Save once and it becomes theirs, autosaving from then on exactly like an
    assignment does — nothing about the editor behaves differently afterwards.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="Sign in first, then you can save projects."), 401

        data = request.get_json(silent=True) or {}
        code = data.get("code", "")
        if not isinstance(code, str) or not code.strip():
            return jsonify(error="There's nothing to save yet."), 400
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That program is too large to save."), 413

        files, file_error = validate_files(data.get("files"))
        if file_error:
            return jsonify(error=file_error), 400

        draft = accounts.Draft(
            slug=accounts.new_id(db, accounts.Draft),
            owner_id=user.id,
            assignment_id=None,           # not part of an assignment
            app=APP_NAME,
            title=clean(data.get("title"), 200) or "Untitled",
            code=code,
            files=json.dumps(files),
        )
        db.add(draft)
        db.commit()
        return jsonify(slug=draft.slug, url=url_for("open_draft", slug=draft.slug))
    finally:
        db.close()


@app.delete("/api/draft/<slug>")
def delete_draft(slug):
    """Throw away one of your own saved projects.

    Only ever your own, and only ever the working copy. Anything already
    turned in stays with the teacher untouched — a submission points at its
    own frozen snapshot, not at this. Deleting an assignment copy is also how
    a student starts that assignment over: open the link again and they get a
    clean one from the starter.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="not signed in"), 401
        draft = db.query(accounts.Draft).filter_by(slug=slug).first()
        if draft is None or draft.owner_id != user.id:
            return jsonify(error="no such project"), 404
        db.delete(draft)
        db.commit()
        return jsonify(ok=True)
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
                  .filter_by(owner_id=user.id, app=APP_NAME)
                  .order_by(accounts.Draft.updated_at.desc())
                  .limit(60).all())
        titles = {a.id: a.title for a in db.query(accounts.Assignment).all()}
        # which of these have been handed in, so deleting one can say so
        turned_in = {s.assignment_id for s in db.query(accounts.Submission)
                     .filter_by(student_id=user.id).all()}
        return jsonify(projects=[{
            "slug": d.slug,
            "title": d.title,
            "assignment": titles.get(d.assignment_id, ""),
            "submitted": bool(d.assignment_id and d.assignment_id in turned_in),
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
            app=APP_NAME,
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
        item = db.query(accounts.Assignment).filter_by(
            slug=slug, app=APP_NAME).first()
        if item is None:
            abort(404)

        user = current_user(db)

        # The author clicking their own handout link. Without this they get a
        # student's copy of their own assignment: it sits in their project list
        # looking like a duplicate, it counts them among the students who have
        # started, and — worst — editing it changes nothing for the class,
        # because a draft is a copy. So the author lands on the editable
        # assignment instead, which is what they almost always wanted.
        # `?preview=1` still gives the student's view, on purpose.
        if (user is not None and user.id == item.teacher_id
                and request.args.get("preview") != "1"):
            return redirect(url_for("edit_assignment", slug=item.slug))

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
                app=APP_NAME,
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


# ---------------------------------------------------------------- kaypy
# The game engine is vendored, not installed at runtime, because a class
# arrives all at once: micropip.install("kaypy") would be 1.36 MB per student
# per session, of which 92 KB is engine and 2.4 MB is a sound file the browser
# never opens. See tools/vendor_kaypy.py.
#
# The cost of that choice is that a new release does not arrive on its own, so
# this is the thing that notices. Once a day, from the server, and only while
# the dashboard is actually being looked at: students never touch PyPI, and a
# day when nobody opens the dashboard costs nothing at all.

KAYPY_STAMP = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "static", "py", "kaypy.json")
PYPI_KAYPY = "https://pypi.org/pypi/kaypy/json"
PYPI_CHECK_SECONDS = 24 * 60 * 60

# (checked_at, latest_version_or_None). Module-level rather than a table: it is
# a cache, it costs nothing to lose, and a restart simply asks again. Two
# gunicorn workers means at most two requests a day, which is nobody's problem.
_kaypy_pypi = [0.0, None]


def _vendored_kaypy():
    try:
        with open(KAYPY_STAMP) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _version_tuple(text):
    """Enough version parsing for '0.1.1' against '0.2.0'.

    Deliberately not `packaging`: this compares two versions of one package,
    both written by the same person in the same shape. Anything it cannot read
    falls back to "different means newer", which errs toward telling you.
    """
    parts = []
    for chunk in str(text).split("."):
        digits = re.match(r"\d+", chunk)
        if digits is None:
            break
        parts.append(int(digits.group()))
    return tuple(parts)


def _latest_kaypy():
    """What PyPI says, at most once a day, and never at the cost of the page."""
    import time

    now = time.time()
    if now - _kaypy_pypi[0] < PYPI_CHECK_SECONDS:
        return _kaypy_pypi[1]

    # Stamp the time before the request, not after: a PyPI that is down or slow
    # must not mean trying again on every single dashboard load.
    _kaypy_pypi[0] = now
    try:
        import requests
        res = requests.get(PYPI_KAYPY, timeout=4)
        if res.ok:
            _kaypy_pypi[1] = res.json()["info"]["version"]
    except Exception:
        pass                       # no network, no PyPI, no matter
    return _kaypy_pypi[1]


def kaypy_status():
    """What the dashboard shows about the engine PyIDE is serving."""
    stamp = _vendored_kaypy()
    here = stamp.get("version")
    if not here:
        return {"vendored": None,
                "note": "No engine vendored yet — run tools/vendor_kaypy.py"}

    latest = _latest_kaypy()
    newer = bool(latest and latest != here and
                 (_version_tuple(latest) > _version_tuple(here)
                  or not _version_tuple(latest)))
    return {
        "vendored": here,
        "commit": stamp.get("commit"),
        "vendored_at": stamp.get("vendored_at", "")[:10],
        "latest": latest,
        "newer": newer,
        "ahead": bool(latest and not newer and latest != here),
    }


@app.get("/teacher")
def teacher_home():
    db = SessionLocal()
    try:
        user, bounce = _require_teacher(db)
        if bounce:
            return bounce
        show_archived = request.args.get("archived") == "1"
        items = (db.query(accounts.Assignment)
                   .filter_by(teacher_id=user.id, app=APP_NAME)
                   .order_by(accounts.Assignment.created_at.desc()).all())
        live = [a for a in items if not a.archived]
        filed = [a for a in items if a.archived]

        counts = {}
        for item in items:
            counts[item.id] = db.query(accounts.Submission).filter_by(
                assignment_id=item.id).count()

        ctx = user_context(db)
        ctx.update(assignments=live, archived=filed, counts=counts,
                   show_archived=show_archived, kaypy=kaypy_status())
        return render_template("teacher.html", **ctx)
    finally:
        db.close()


@app.get("/teacher/<slug>/edit")
def edit_assignment(slug):
    """Open a published assignment to change it.

    The notes are yours here, so the markdown opens for editing the same way
    it does in a new project. Handing work out is not supposed to be the last
    time you can touch it.
    """
    db = SessionLocal()
    try:
        user, bounce = _require_teacher(db)
        if bounce:
            return bounce
        item = db.query(accounts.Assignment).filter_by(
            slug=slug, app=APP_NAME).first()
        if item is None or item.teacher_id != user.id:
            abort(404)

        # Not the author's own draft, if one is lying about from before the
        # redirect in open_assignment existed — that is not a student who
        # started.
        started = (db.query(accounts.Draft)
                     .filter(accounts.Draft.assignment_id == item.id,
                             accounts.Draft.owner_id != item.teacher_id)
                     .count())
        ctx = user_context(db)
        ctx.update(
            code=item.code,
            files=item.file_map(),
            title=item.title,
            author=ctx["user_name"],
            readonly=False,
            authoring=True,          # your notes, your assignment
            slug=None,
            shared_at=None,
            draft_slug=None,
            assignment_title=item.title,
            assignment_slug="",      # no Turn in — you are not a student here
            submitted_at="",
            editing_assignment=item.slug,
            editing_started=started,
        )
        return render_template("index.html", **ctx)
    finally:
        db.close()


@app.post("/api/assignment/<slug>")
def update_assignment(slug):
    """Save changes to a published assignment.

    This changes what students get when they open the link *from now on*.
    Anyone already working keeps their copy exactly as it is — their code is
    theirs, and an edit to the starter must never reach in and overwrite it.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="not allowed"), 403
        item = db.query(accounts.Assignment).filter_by(
            slug=slug, app=APP_NAME).first()
        if item is None or item.teacher_id != user.id:
            return jsonify(error="no such assignment"), 404

        data = request.get_json(silent=True) or {}
        code = data.get("code", "")
        if not isinstance(code, str) or not code.strip():
            return jsonify(error="There's no code to hand out."), 400
        if len(code.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That program is too large."), 413

        files, file_error = validate_files(data.get("files"))
        if file_error:
            return jsonify(error=file_error), 400

        item.title = clean(data.get("title"), 200) or item.title
        item.code = code
        item.files = json.dumps(files)
        db.commit()

        # Not the author's own draft, if one is lying about from before the
        # redirect in open_assignment existed — that is not a student who
        # started.
        started = (db.query(accounts.Draft)
                     .filter(accounts.Draft.assignment_id == item.id,
                             accounts.Draft.owner_id != item.teacher_id)
                     .count())
        return jsonify(ok=True, title=item.title, already_started=started)
    finally:
        db.close()


@app.post("/api/assignment/<slug>/archive")
def archive_assignment(slug):
    """Tidy an assignment away, or bring it back.

    Nothing is destroyed: every submission and every student's copy stays
    exactly as it was. It only stops crowding the dashboard.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="not allowed"), 403
        item = db.query(accounts.Assignment).filter_by(
            slug=slug, app=APP_NAME).first()
        if item is None or item.teacher_id != user.id:
            return jsonify(error="no such assignment"), 404
        item.archived = 0 if item.archived else 1
        db.commit()
        return jsonify(ok=True, archived=bool(item.archived))
    finally:
        db.close()


@app.delete("/api/assignment/<slug>")
def delete_assignment(slug):
    """Delete an assignment outright — only if nobody has turned anything in.

    The refusal is the point. Submissions are the closest thing this app has
    to a record of a student's work for a teacher, and no single click should
    be able to wipe them. An assignment with submissions can be archived
    instead, which hides it and keeps everything.

    Students who started but never submitted keep their code: their copy is
    detached from the assignment and becomes an ordinary saved project, so a
    tidy-up on your side never deletes work on theirs.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="not allowed"), 403
        item = db.query(accounts.Assignment).filter_by(
            slug=slug, app=APP_NAME).first()
        if item is None or item.teacher_id != user.id:
            return jsonify(error="no such assignment"), 404

        handed_in = db.query(accounts.Submission).filter_by(
            assignment_id=item.id).count()
        if handed_in:
            return jsonify(
                error="%d student%s turned work in to this. Archive it instead "
                      "— that hides it and keeps everything."
                      % (handed_in, "" if handed_in == 1 else "s"),
                submissions=handed_in), 409

        detached = (db.query(accounts.Draft)
                      .filter_by(assignment_id=item.id).all())
        for draft in detached:
            draft.assignment_id = None       # their work becomes their own
        db.delete(item)
        db.commit()
        return jsonify(ok=True, kept_projects=len(detached))
    finally:
        db.close()


@app.get("/teacher/<slug>")
def teacher_assignment(slug):
    db = SessionLocal()
    try:
        user, bounce = _require_teacher(db)
        if bounce:
            return bounce
        item = db.query(accounts.Assignment).filter_by(
            slug=slug, app=APP_NAME).first()
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
                     .filter(accounts.Draft.assignment_id == item.id,
                             accounts.Draft.owner_id != item.teacher_id).all())
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


# --------------------------------------------------------------------------
# Teaching live
#
# The teacher presses Go live in their ordinary editor and keeps working the
# way they always do — tabs, notes, Run. Every few hundred milliseconds the
# current file is written to one row. Students open /live/<code>, watch that
# row appear above them, and type their own copy underneath.
#
# THE STUDENT'S OWN EDITOR IS NEVER WRITTEN TO FROM THE WIRE. Nothing that
# arrives from a poll can reach it: the mirror and the student's editor are
# two CodeMirror instances and only the mirror is ever given text. A class
# losing a paragraph of their own work because the teacher typed is the one
# failure that would stop anyone using this twice, so it is arranged to be
# impossible rather than avoided carefully.
#
# There is deliberately no button that copies the teacher's code into the
# student's editor. Typing it is the exercise.
# --------------------------------------------------------------------------

#: How stale a session can get before it is swept. A lesson is an hour; a row
#: still being pushed to is never touched, however old.
LIVE_STALE_HOURS = 12


def _live_now():
    return datetime.now(timezone.utc)


def _find_live(db, code):
    return db.query(accounts.LiveSession).filter_by(
        code=(code or "").strip().lower(), app=APP_NAME).first()


@app.get("/api/live/assignments")
def live_assignments():
    """The teacher's open assignments, for the chooser on Go live.

    Picking one is what makes Turn in possible for the class, so this is not
    decoration: a lesson with no assignment is a lesson nobody can hand
    anything in from.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="Only a teacher can start a live lesson."), 403
        rows = (db.query(accounts.Assignment)
                  .filter_by(teacher_id=user.id, app=APP_NAME,
                             archived=0, closed=0)
                  .order_by(accounts.Assignment.created_at.desc())
                  .limit(40).all())
        return jsonify(assignments=[{"slug": a.slug, "title": a.title}
                                    for a in rows])
    finally:
        db.close()


@app.get("/api/live/assignment/<slug>")
def live_assignment_starter(slug):
    """One assignment's starter, for opening it in the editor on Go live.

    Separate from the list above on purpose: the list is shown every time
    Go live is pressed and is only titles, while this is fetched once and
    only if the teacher says yes to loading it. Sending every starter with
    the list would be up to a few megabytes for a chooser most of which is
    never read.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="Only a teacher can do that."), 403
        item, why = _assignment_for(db, user, clean(slug, 16))
        if why or item is None:
            return jsonify(error=why or "No such assignment."), 404
        return jsonify(title=item.title, code=item.code, files=item.file_map())
    finally:
        db.close()


def _assignment_for(db, user, slug):
    """The teacher's own assignment by slug, or (None, reason).

    Checked against teacher_id rather than just the teacher list, so one
    teacher cannot attach a lesson to another's assignment and collect their
    class's work.
    """
    if not slug:
        return None, None
    item = db.query(accounts.Assignment).filter_by(
        slug=slug, app=APP_NAME).first()
    if item is None:
        return None, "No assignment with that link."
    if item.teacher_id != user.id:
        return None, "That is not your assignment."
    if item.closed:
        return None, "That assignment is closed, so nothing could be "\
                     "turned in to it."
    return item, None


def _slug_of_assignment(db, assignment_id):
    if not assignment_id:
        return ""
    row = db.query(accounts.Assignment).filter_by(id=assignment_id).first()
    return row.slug if row else ""


def _title_of_assignment(db, assignment_id):
    if not assignment_id:
        return ""
    row = db.query(accounts.Assignment).filter_by(id=assignment_id).first()
    return row.title if row else ""


@app.post("/api/live/start")
def live_start():
    """Open a session, or hand back the one already running.

    Reusing the open one matters: pressing Go live after a reload should put
    the same code back on the projector, not invent a second one that half
    the class is not looking at.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None or not accounts.is_teacher(user.email):
            return jsonify(error="Only a teacher can start a live lesson."), 403

        data = request.get_json(silent=True) or {}
        body = data.get("body")
        if not isinstance(body, str):
            body = ""
        if len(body.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That file is too large to share live."), 413

        wanted = clean(data.get("assignment"), 16)
        item, why = _assignment_for(db, user, wanted)
        if why:
            return jsonify(error=why), 400

        live = (db.query(accounts.LiveSession)
                  .filter_by(host_id=user.id, app=APP_NAME, ended=0)
                  .order_by(accounts.LiveSession.started_at.desc()).first())

        # A RESUME ONLY EVER REATTACHES. The editor remembers the lesson it
        # was broadcasting so a reload carries on, and used to resume by
        # calling this route like a fresh Go live — so when that lesson had
        # ended (or been swept), a teacher who merely opened the editor was
        # put on their class's screens in a brand-new lesson they never
        # started. It showed up as "sign in and I'm live". Now a resume names
        # the lesson it means, and gets that one, still open, or nothing.
        resume = clean(data.get("resume"), 16)
        if resume and (live is None or live.code != resume):
            return jsonify(resumed=False)

        if live is None:
            live = accounts.LiveSession(
                code=accounts.new_id(db, accounts.LiveSession, "code"),
                app=APP_NAME,
                host_id=user.id,
                host_name=user.display_name(),
                title=clean(data.get("title"), 200) or "Live lesson",
                body=body,
                filename=clean(data.get("filename"), 200) or "main.py",
                version=0,
                assignment_id=item.id if item else None,
            )
            db.add(live)
        else:
            live.title = clean(data.get("title"), 200) or live.title
            # Resuming after a reload must not quietly drop the assignment —
            # the class would carry on with no way to hand anything in, and
            # nothing would say so. Only an explicit choice changes it.
            if "assignment" in data:
                live.assignment_id = item.id if item else None
        live.updated_at = _live_now()
        db.commit()

        _sweep_live(db)
        return jsonify(code=live.code, version=live.version,
                       assignment=(item.slug if item else
                                   _slug_of_assignment(db, live.assignment_id)),
                       assignment_title=(item.title if item else
                                         _title_of_assignment(db, live.assignment_id)),
                       # so a teacher who reloads mid-lesson is shown that
                       # something is still out, and can take it back
                       snippet_out=bool(live.snippet),
                       # so a reload carries on from the same slide rather
                       # than sending the class back to the title
                       slide=live.slide or "",
                       url=url_for("live_page", code=live.code, _external=True))

    finally:
        db.close()


def _sweep_live(db):
    """Close sessions nobody has pushed to for hours.

    Without this the table grows a row per lesson forever, and — worse — a
    teacher who closed the tab last Tuesday still has an "open" session, so
    Go live today reuses a code the class no longer has.
    """
    cutoff = _live_now() - timedelta(hours=LIVE_STALE_HOURS)
    try:
        (db.query(accounts.LiveSession)
           .filter(accounts.LiveSession.ended == 0,
                   accounts.LiveSession.updated_at < cutoff)
           .update({"ended": 1}, synchronize_session=False))
        db.commit()
    except Exception:
        db.rollback()          # a sweep failing must never fail the lesson


@app.post("/api/live/<code>/push")
def live_push(code):
    """The teacher's current file. Called every few hundred milliseconds.

    `seq` is a stamp from the teacher's browser that only ever goes up, and
    the write is conditional on it being higher than what the row already
    has. Two pushes overtaking each other on a slow connection would
    otherwise leave the OLDER text in the row with a HIGHER version, and the
    class would sit looking at a line their teacher had already fixed.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="Not signed in."), 403

        live = _find_live(db, code)
        if live is None:
            return jsonify(error="No such live lesson."), 404
        # Only the host, checked against the row rather than against the
        # teacher list: a second teacher must not be able to type into
        # somebody else's lesson.
        if live.host_id != user.id:
            return jsonify(error="This is not your live lesson."), 403
        if live.ended:
            return jsonify(error="That live lesson has ended.", ended=True), 409

        data = request.get_json(silent=True) or {}
        body = data.get("body")
        if not isinstance(body, str):
            return jsonify(error="Nothing to send."), 400
        if len(body.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That file is too large to share live."), 413
        try:
            seq = int(data.get("seq", 0))
        except (TypeError, ValueError):
            return jsonify(error="Bad sequence number."), 400

        filename = clean(data.get("filename"), 200) or live.filename

        fields = {"body": body, "filename": filename,
                  "version": seq, "updated_at": _live_now()}
        # The project's notes ride along on every push (see LiveSession.notes).
        # Only when sent: an editor tab still running the code from before
        # this existed sends none, and must not wipe them.
        notes = data.get("notes")
        if isinstance(notes, str):
            if len(notes.encode("utf-8")) > MAX_CODE_BYTES:
                return jsonify(error="Those notes are too large to share live."), 413
            fields["notes"] = notes

        # Which slide those notes are, "3/5", or "" when they are not slides.
        # Same rule as notes: only when sent.
        slide = data.get("slide")
        if isinstance(slide, str):
            fields["slide"] = slide if re.fullmatch(r"\d{1,4}/\d{1,4}", slide) else ""

        # What the teacher's Run printed. Trimmed here rather than refused:
        # a runaway print loop is exactly when the output is huge, and a 413
        # would throw away the code that came with it, freezing the mirror
        # for as long as the loop ran. The tail is what anyone wants to read.
        output = data.get("output")
        if isinstance(output, str):
            raw = output.encode("utf-8")
            if len(raw) > LIVE_OUTPUT_BYTES:
                output = raw[-LIVE_OUTPUT_BYTES:].decode("utf-8", "ignore")
            fields["output"] = output

        # One statement, so two workers cannot interleave a read and a write.
        # `version < seq` is what drops a stale push, and it is also why this
        # cannot be an ORM assignment followed by a commit.
        changed = (db.query(accounts.LiveSession)
                     .filter(accounts.LiveSession.id == live.id,
                             accounts.LiveSession.version < seq)
                     .update(fields, synchronize_session=False))
        db.commit()
        if not changed:
            # Not an error: a push that lost the race has nothing to say, and
            # the teacher's browser should carry on rather than retry.
            return jsonify(stale=True, version=live.version)
        return jsonify(version=seq)
    finally:
        db.close()


@app.post("/api/live/<code>/send")
def live_send(code):
    """A snippet the teacher highlighted and sent, or "" to take it back.

    WHY THIS EXISTS WHEN THE MIRROR CANNOT BE COPIED. Typing the lesson is
    the exercise, so the mirror refuses copy and there is no button that
    brings the teacher's file down. But some code is not the exercise — a
    long list of data, a helper the lesson uses but does not teach — and
    making thirty people type it out is lost time. This is the teacher saying
    "this bit, you may have". What goes out is only what they highlighted,
    and it only reaches a student's editor when that student presses Insert.

    Stamped exactly like a push, through the same `version < seq` guard,
    because it has to move `version` to reach anyone: students poll against
    `version` and are answered 304 otherwise. The consequence is that a push
    and a send can overtake each other and one of them lose — app.js retries
    a losing send, and forgets what it last pushed so the file goes again.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="Not signed in."), 403
        live = _find_live(db, code)
        if live is None:
            return jsonify(error="No such live lesson."), 404
        # The host, checked against the row: another teacher must not be able
        # to put code on somebody else's class's screens.
        if live.host_id != user.id:
            return jsonify(error="This is not your live lesson."), 403
        if live.ended:
            return jsonify(error="That live lesson has ended.", ended=True), 409

        data = request.get_json(silent=True) or {}
        snippet = data.get("snippet")
        if not isinstance(snippet, str):
            return jsonify(error="Nothing to send."), 400
        if len(snippet.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That is too much to send."), 413
        try:
            seq = int(data.get("seq", 0))
        except (TypeError, ValueError):
            return jsonify(error="Bad sequence number."), 400

        changed = (db.query(accounts.LiveSession)
                     .filter(accounts.LiveSession.id == live.id,
                             accounts.LiveSession.version < seq)
                     .update({"snippet": snippet, "snippet_seq": seq,
                              "version": seq, "updated_at": _live_now()},
                             synchronize_session=False))
        db.commit()
        if not changed:
            return jsonify(stale=True, version=live.version)
        return jsonify(version=seq, sent=bool(snippet))
    finally:
        db.close()


@app.post("/api/live/<code>/stop")
def live_stop(code):
    db = SessionLocal()
    try:
        user = current_user(db)
        live = _find_live(db, code)
        if live is None:
            return jsonify(error="No such live lesson."), 404
        if user is None or live.host_id != user.id:
            return jsonify(error="This is not your live lesson."), 403
        live.ended = 1
        live.updated_at = _live_now()
        db.commit()
        return jsonify(ended=True)
    finally:
        db.close()


@app.get("/api/live/<code>")
def live_poll(code):
    """What the class asks for, once a second, all lesson.

    Answers 304 when nothing has changed, which is almost every time. Thirty
    students polling is thirty small queries a second and no payload at all
    until a key is pressed.

    No sign-in required, on purpose: a student who cannot get Google to work
    must still be able to follow the lesson.
    """
    db = SessionLocal()
    try:
        live = _find_live(db, code)
        if live is None:
            return jsonify(error="No such live lesson."), 404
        try:
            seen = int(request.args.get("v", -1))
        except (TypeError, ValueError):
            seen = -1

        if seen == live.version and not live.ended:
            return ("", 304)
        return jsonify(
            version=live.version,
            body=live.body,
            filename=live.filename,
            title=live.title,
            host=live.host_name,
            ended=bool(live.ended),
            snippet=live.snippet or "",
            snippet_seq=live.snippet_seq or 0,
            notes=live.notes or "",
            slide=live.slide or "",
            output=live.output or "",
        )
    finally:
        db.close()


@app.post("/api/live/<code>/keep")
def live_keep(code):
    """A student saving their own copy from the live page.

    THIS IS NOT /api/draft, AND THE DIFFERENCE IS THE WHOLE POINT.

    /api/draft makes a free-standing project with no assignment on it, and a
    draft with no assignment can never be turned in — the button cannot even
    appear. That is what made handing work in from a live lesson impossible.

    When the lesson has an assignment, this creates or finds the draft for
    (this student, that assignment): the very row /a/<slug> would have made.
    So a student who opened the handout link this morning and joins the
    lesson this afternoon carries on with ONE copy, and whichever way they
    came in, Turn in is there.

    With no assignment on the lesson it behaves exactly like /api/draft, so
    a lesson that is just a lesson still saves.
    """
    db = SessionLocal()
    try:
        user = current_user(db)
        if user is None:
            return jsonify(error="Sign in first, then you can save your work."), 401

        live = _find_live(db, code)
        if live is None:
            return jsonify(error="No such live lesson."), 404

        data = request.get_json(silent=True) or {}
        source = data.get("code", "")
        if not isinstance(source, str) or not source.strip():
            return jsonify(error="There's nothing to save yet."), 400
        if len(source.encode("utf-8")) > MAX_CODE_BYTES:
            return jsonify(error="That program is too large to save."), 413

        item = None
        if live.assignment_id:
            item = db.query(accounts.Assignment).filter_by(
                id=live.assignment_id).first()

        draft = None
        if item is not None:
            # One per student per assignment — there is a unique constraint
            # on exactly this pair, so looking first is what keeps the insert
            # below from colliding with the handout link.
            draft = db.query(accounts.Draft).filter_by(
                owner_id=user.id, assignment_id=item.id).first()

        if draft is None:
            # SEEDED FROM THE ASSIGNMENT, exactly as /a/<slug> seeds one. An
            # assignment can ship data files and notes; a student who joins
            # the lesson without opening the handout link first would
            # otherwise get a copy with none of them, and the program they
            # were told to run would fail on a missing file.
            draft = accounts.Draft(
                slug=accounts.new_id(db, accounts.Draft),
                owner_id=user.id,
                assignment_id=item.id if item else None,
                app=APP_NAME,
                title=(item.title if item else (live.title or "Live lesson")),
                code=source,
                files=(item.files if item is not None else "{}"),
            )
            db.add(draft)
        else:
            draft.code = source
            draft.updated_at = accounts.now()

        db.commit()
        return jsonify(
            slug=draft.slug,
            url=url_for("open_draft", slug=draft.slug),
            assignment=(item.slug if item else ""),
            assignment_title=(item.title if item else ""),
            can_turn_in=bool(item),
            # The whole project, not just the file they typed. Turning in
            # replaces a draft's files with what is posted, so a live page
            # that sent none would delete the assignment's attached data
            # files at the moment the work was handed in.
            files=draft.file_map(),
        )
    finally:
        db.close()


@app.get("/live/")
@app.get("/live")
def live_join():
    """Type a code in. The page students are sent to when they have a code."""
    db = SessionLocal()
    try:
        ctx = user_context(db)
        ctx.update(live=None, code="", joined=False, is_host=False,
                   assignment=None, submitted_at="",
                   error=request.args.get("error", ""))
        return render_template("live.html", **ctx)
    finally:
        db.close()


@app.get("/live/<code>")
def live_page(code):
    db = SessionLocal()
    try:
        live = _find_live(db, code)
        if live is None:
            return redirect(url_for("live_join", error="No lesson with that code."))
        user = current_user(db)
        item = None
        submitted_at = ""
        if live.assignment_id:
            item = db.query(accounts.Assignment).filter_by(
                id=live.assignment_id).first()
        # If they have already handed this in, the button says so rather than
        # pretending nothing happened — the same wording the editor uses.
        if item is not None and user is not None:
            done = db.query(accounts.Submission).filter_by(
                assignment_id=item.id, student_id=user.id).first()
            if done is not None:
                submitted_at = done.submitted_at.strftime("%b %d at %I:%M %p")

        # WHAT THE STUDENT'S EDITOR STARTS WITH, when their browser has nothing
        # of its own for this lesson. The same as /a/<slug> would give them:
        # their own draft of the assignment if they have one, else its starter.
        #
        # THE DRAFT IS NOT A NICETY. Saving from the live page writes into
        # that draft (see live_keep), replacing its code with the live editor.
        # Started empty, a student who did half the assignment from the link
        # this morning would type one line here, press Save, and lose the
        # morning's work without a word.
        #
        # Rendered into the page, never sent on the poll: it is the student's
        # starting point, like opening the link, not the teacher reaching into
        # their editor.
        starter = ""
        if item is not None:
            starter = item.code or ""
            if user is not None:
                mine = db.query(accounts.Draft).filter_by(
                    owner_id=user.id, assignment_id=item.id).first()
                if mine is not None:
                    starter = mine.code or ""

        ctx = user_context(db)
        ctx.update(
            live=live,
            code=live.code,
            joined=True,
            is_host=bool(user is not None and user.id == live.host_id),
            assignment=item,
            submitted_at=submitted_at,
            starter=starter,
            error="",
        )
        return render_template("live.html", **ctx)
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
