from datetime import date
from pathlib import Path

from policy_watch.watch import Source, check, html_to_text, load_sources, render, review_due

from tests.conftest import ROOT

PAGE = "<html><head><script>x()</script></head><body><nav>menu</nav><h1>Privacy</h1><p>{}</p></body></html>"
BODY = "We do not train on API data. " * 30


def test_html_to_text_strips_scripts_and_nav():
    text = html_to_text(PAGE.format("Hello"))
    assert text == "Privacy\nHello\n"


def test_ignore_patterns_remove_volatile_ids():
    html = "<p>This is the Trace Id: abc123</p><p>Body</p>"
    assert html_to_text(html, [r"^This is the Trace Id: [0-9a-f]+$"]).strip() == "Body"


def test_new_then_unchanged_then_changed(tmp_path: Path):
    src = Source("p", "openai", "https://example.invalid")
    assert check(src, tmp_path, lambda _: PAGE.format(BODY)).status == "new"
    assert check(src, tmp_path, lambda _: PAGE.format(BODY)).status == "unchanged"
    r = check(src, tmp_path, lambda _: PAGE.format(BODY + " We now train on API data."))
    assert r.status == "changed" and "+" in r.diff


def test_short_page_is_failure_not_snapshot(tmp_path: Path):
    src = Source("p", "meta", "https://example.invalid")
    r = check(src, tmp_path, lambda _: "<div id=root></div>")
    assert r.status == "failed" and not (tmp_path / "p.txt").exists()


def test_manual_source_is_not_fetched(tmp_path: Path):
    def boom(_):
        raise AssertionError("must not fetch")
    assert check(Source("p", "meta", "u", manual=True), tmp_path, boom).status == "manual"


def test_sources_reference_known_providers():
    import yaml
    providers = set(yaml.safe_load((ROOT / "policies/destinations.yaml").read_text(encoding="utf-8"))
                    ["profiles"])
    sources = load_sources(ROOT / "tools/policy_watch/sources.yaml")
    assert {s.provider for s in sources} <= providers
    assert len({s.id for s in sources}) == len(sources)


def test_review_due_and_report():
    due = review_due(ROOT / "policies/destinations.yaml", date(2027, 1, 25))
    assert due and all(left <= 14 for _, _, left in due)
    report = render([], due, date(2027, 1, 25))
    assert "재확인 기한" in report
