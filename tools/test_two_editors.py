"""Run both editors against one database and prove they can't touch each other.

    python3 tools/test_two_editors.py

Why this exists. PyIDE and WebIDE share four tables — users, assignments,
drafts, submissions — so that one sign-in is one person across both. What keeps
them apart is a single `app` column and a filter on every query. Miss the filter
on one route and nothing looks wrong: the dashboards still behave, because they
were never the route you missed.

That is exactly how it went wrong in September 2026. Six of PyIDE's assignment
lookups had no `app` filter, so a WebIDE assignment could be opened, edited,
archived and — the one that cost real work — *deleted* from PyIDE. The
dashboards filtered correctly the whole time, which is precisely why it took a
lost project to notice.

So this file checks every route that takes an assignment slug, in both
directions. Add a route that looks one up, add it here.

It needs both folders side by side:

    somewhere/
      pyide/
      webide/
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PYIDE = os.path.dirname(HERE)
WEBIDE = os.path.join(os.path.dirname(PYIDE), "webide")

if not os.path.isdir(WEBIDE):
    sys.exit("expected webide/ next to pyide/, found nothing at " + WEBIDE)

DB = os.path.join(tempfile.mkdtemp(), "both.db")
os.environ["DATABASE_URL"] = "sqlite:///" + DB
os.environ["TEACHER_EMAILS"] = "teacher@example.org"
os.environ["SECRET_KEY"] = "k" * 32
os.environ.pop("ALLOWED_EMAIL_DOMAINS", None)

sys.path.insert(0, WEBIDE)
import app as W                                              # noqa: E402
import accounts                                              # noqa: E402

sys.path.pop(0)
del sys.modules["app"]
sys.path.insert(0, PYIDE)
import app as P                                              # noqa: E402


def make_teacher():
    db = W.SessionLocal()
    try:
        user = accounts.User(google_sub="s1",
                             email="teacher@example.org", name="Teacher")
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


TEACHER = make_teacher()


def client(module):
    c = module.app.test_client()
    with c.session_transaction() as s:
        s["uid"] = TEACHER
    return c


web, py = client(W), client(P)

web_slug = web.post("/api/assignment",
                    json={"files": {"index.html": "<h1>hi</h1>"},
                          "title": "WEB assignment"}).get_json()["slug"]
py_slug = py.post("/api/assignment",
                  json={"code": "print(1)",
                        "title": "PY assignment"}).get_json()["slug"]

results = []


def check(label, condition):
    results.append(condition)
    print("  %-4s %s" % ("ok" if condition else "FAIL", label))


def cannot_reach(editor, slug, other_title, other):
    """Every route that takes an assignment slug must refuse a foreign one."""
    check("not listed on the dashboard",
          other_title not in editor.get("/teacher").get_data(as_text=True))
    check("detail page refuses",
          editor.get("/teacher/" + slug).status_code == 404)
    check("edit page refuses",
          editor.get("/teacher/" + slug + "/edit").status_code == 404)
    check("update refuses",
          editor.post("/api/assignment/" + slug,
                      json={"code": "x", "files": {}}).status_code == 404)
    check("archive refuses",
          editor.post("/api/assignment/" + slug + "/archive").status_code == 404)
    check("DELETE refuses",
          editor.delete("/api/assignment/" + slug).status_code == 404)
    check("the handout link refuses",
          editor.get("/a/" + slug).status_code == 404)
    check("turning in refuses",
          editor.post("/api/submit", json={"assignment": slug}).status_code
          in (400, 403, 404))
    check("it is still there afterwards",
          other_title in other.get("/teacher").get_data(as_text=True))


print("PyIDE must not reach WebIDE's assignment:")
cannot_reach(py, web_slug, "WEB assignment", web)

print("\nWebIDE must not reach PyIDE's assignment:")
cannot_reach(web, py_slug, "PY assignment", py)

print("\nEach editor still works on its own:")
# Where it goes matters, not just that it goes: this client is signed in as the
# author, and the author must land on the assignment rather than on a copy of
# it. See tools/test_assignment_flow.py for why.
check("webide opens its own link, to the assignment",
      web.get("/a/" + web_slug).headers.get("Location", "")
         .endswith("/teacher/" + web_slug + "/edit"))
check("pyide opens its own link, to the assignment",
      py.get("/a/" + py_slug).headers.get("Location", "")
         .endswith("/teacher/" + py_slug + "/edit"))
check("webide edits its own",
      web.get("/teacher/" + web_slug + "/edit").status_code == 200)
check("pyide edits its own",
      py.get("/teacher/" + py_slug + "/edit").status_code == 200)
check("webide lists its own",
      "WEB assignment" in web.get("/teacher").get_data(as_text=True))
check("pyide lists its own",
      "PY assignment" in py.get("/teacher").get_data(as_text=True))

print("\nSaved projects stay in their own editor:")
web.post("/api/draft", json={"files": {"index.html": "x"}, "title": "WEB proj"})
py.post("/api/draft", json={"code": "print(2)", "title": "PY proj"})
web_list = web.get("/api/my/projects").get_data(as_text=True)
py_list = py.get("/api/my/projects").get_data(as_text=True)
check("webide lists only its own", "WEB proj" in web_list and "PY proj" not in web_list)
check("pyide lists only its own", "PY proj" in py_list and "WEB proj" not in py_list)

print()
if all(results):
    print("ALL PASSED (%d checks)" % len(results))
else:
    print("%d of %d FAILED" % (results.count(False), len(results)))
sys.exit(0 if all(results) else 1)
