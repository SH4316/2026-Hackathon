"""제공사 데이터 정책 페이지 변경 감지.

공식 페이지를 가져와 본문 텍스트로 정리하고 저장된 스냅샷과 비교한다.
등급을 자동으로 바꾸지 않는다. 변경·실패·재확인 기한을 보고서로 만들고,
GitHub Actions 가 그 보고서로 PR(스냅샷 변경) 또는 이슈를 연다.

    python tools/policy_watch/watch.py --report report.md
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
SERVER = HERE.parents[1]
USER_AGENT = "Mozilla/5.0 (compatible; prompt-guard-policy-watch/0.1)"
MIN_TEXT_CHARS = 500          # 이보다 짧으면 JS 렌더링·차단 페이지로 보고 실패 처리
MAX_DIFF_LINES = 80
DUE_SOON_DAYS = 14

_SKIP_TAGS = {"script", "style", "noscript", "svg", "nav", "header", "footer", "form", "button"}
_BLOCK_TAGS = {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "section",
               "article", "table", "ul", "ol", "dd", "dt", "td", "th"}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str, ignore_patterns: list[str] | None = None) -> str:
    p = _TextExtractor()
    p.feed(html)
    lines = (re.sub(r"\s+", " ", ln).strip() for ln in "".join(p.parts).splitlines())
    text = "\n".join(ln for ln in lines if ln)
    for pat in ignore_patterns or []:
        text = re.sub(pat, "", text, flags=re.MULTILINE)
    return text.strip() + "\n"


@dataclass
class Source:
    id: str
    provider: str
    url: str
    ignore: list[str] = field(default_factory=list)
    manual: bool = False


@dataclass
class Result:
    source: Source
    status: str                # unchanged | changed | new | failed | manual
    detail: str = ""
    diff: str = ""


def load_sources(path: Path) -> list[Source]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    common = raw.get("ignore") or []
    return [Source(id=s["id"], provider=s["provider"], url=s["url"],
                   ignore=common + s.get("ignore", []), manual=bool(s.get("manual", False)))
            for s in raw["sources"]]


def fetch(url: str, timeout: float = 30, attempts: int = 3) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept-Language": "en-US,en;q=0.8"})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                charset = resp.headers.get_content_charset() or "utf-8"
                return resp.read().decode(charset, errors="replace")
        except urllib.error.HTTPError as exc:
            # 봇 차단(403)·속도 제한·일시 오류는 간격을 두고 재시도
            if attempt == attempts or exc.code not in (403, 429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts:
                raise
        time.sleep(5 * attempt)
    raise AssertionError("unreachable")


def check(source: Source, snapshots: Path, fetcher=fetch) -> Result:
    if source.manual:
        return Result(source, "manual")
    try:
        text = html_to_text(fetcher(source.url), source.ignore)
    except urllib.error.HTTPError as exc:
        return Result(source, "failed", f"HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return Result(source, "failed", type(exc).__name__)
    if len(text) < MIN_TEXT_CHARS:
        return Result(source, "failed", f"본문 {len(text)}자(JS 렌더링 또는 차단 의심)")

    snap = snapshots / f"{source.id}.txt"
    old = snap.read_text(encoding="utf-8") if snap.exists() else None
    if old == text:
        return Result(source, "unchanged")
    snap.parent.mkdir(parents=True, exist_ok=True)
    snap.write_text(text, encoding="utf-8", newline="\n")
    if old is None:
        return Result(source, "new", "초기 스냅샷")
    diff = list(difflib.unified_diff(old.splitlines(), text.splitlines(), "before", "after",
                                     lineterm="", n=1))
    shown = "\n".join(diff[:MAX_DIFF_LINES])
    if len(diff) > MAX_DIFF_LINES:
        shown += f"\n... ({len(diff) - MAX_DIFF_LINES}줄 생략, 전체는 PR 파일 변경 참고)"
    return Result(source, "changed", hashlib.sha256(text.encode()).hexdigest()[:12], shown)


def review_due(destinations: Path, today: date) -> list[tuple[str, date, int]]:
    """재확인 기한이 지났거나 임박한 제공사: (provider, 기한, 남은 일수)."""
    raw = yaml.safe_load(destinations.read_text(encoding="utf-8"))
    days = int(raw.get("stale_after_days", 90))
    out = []
    for provider, spec in (raw.get("profiles") or {}).items():
        due = spec["verified_at"] + timedelta(days=days)
        left = (due - today).days
        if left <= DUE_SOON_DAYS:
            out.append((provider, due, left))
    return sorted(out, key=lambda x: x[2])


def render(results: list[Result], due: list[tuple[str, date, int]], today: date) -> str:
    changed = [r for r in results if r.status == "changed"]
    new = [r for r in results if r.status == "new"]
    failed = [r for r in results if r.status == "failed"]
    manual = [r for r in results if r.status == "manual"]
    lines = [f"# 제공사 정책 변경 감지 ({today.isoformat()})", "",
             f"확인 {len(results)}건 · 변경 {len(changed)} · 신규 {len(new)} · 실패 {len(failed)}", "",
             "> 등급은 자동으로 바뀌지 않습니다. 변경 내용을 읽고 `server/policies/destinations.yaml` 의",
             "> 등급·근거와 해당 제공사 `verified_at`, `default.yaml` 의 `version` 을 함께 갱신하세요.",
             "> 등급을 낮추는 변경은 원문 근거를 PR 에 인용하고 두 명 이상 검토합니다.", ""]
    if changed:
        lines += ["## 변경됨", ""]
        for r in changed:
            lines += [f"### {r.source.provider} · `{r.source.id}`", r.source.url, "",
                      "```diff", r.diff, "```", ""]
    if new:
        lines += ["## 신규 스냅샷(비교 기준 생성)", ""]
        lines += [f"- {r.source.provider} · `{r.source.id}` — {r.source.url}" for r in new] + [""]
    if failed:
        lines += ["## 가져오기 실패(수동 확인 필요)", ""]
        lines += [f"- {r.source.provider} · `{r.source.id}` — {r.detail} — {r.source.url}"
                  for r in failed] + [""]
    if manual:
        lines += ["## 수동 확인 대상(자동 수집 불가)", ""]
        lines += [f"- {r.source.provider} · `{r.source.id}` — {r.source.url}" for r in manual] + [""]
    if due:
        lines += ["## 재확인 기한", "",
                  "기한이 지나면 서버가 해당 제공사를 기본 등급 이상으로 강화합니다.", ""]
        lines += [f"- {p}: {d.isoformat()} ({'지남' if left < 0 else f'{left}일 남음'})"
                  for p, d, left in due] + [""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", type=Path, default=HERE / "sources.yaml")
    ap.add_argument("--snapshots", type=Path, default=HERE / "snapshots")
    ap.add_argument("--destinations", type=Path, default=SERVER / "policies/destinations.yaml")
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--only", help="쉼표로 구분한 provider 만 확인")
    args = ap.parse_args(argv)
    sys.stderr.reconfigure(encoding="utf-8")

    today = date.today()
    sources = load_sources(args.sources)
    if args.only:
        wanted = set(args.only.split(","))
        sources = [s for s in sources if s.provider in wanted]
    results = [check(s, args.snapshots) for s in sources]
    due = review_due(args.destinations, today)
    args.report.write_text(render(results, due, today), encoding="utf-8")

    counts = {k: sum(r.status == k for r in results) for k in ("changed", "new", "failed")}
    for r in results:
        print(f"{r.status:9} {r.source.id:32} {r.detail}", file=sys.stderr)
    if out := os.getenv("GITHUB_OUTPUT"):
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"snapshots_changed={'true' if counts['changed'] or counts['new'] else 'false'}\n")
            f.write(f"needs_attention={'true' if counts['failed'] or due else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
