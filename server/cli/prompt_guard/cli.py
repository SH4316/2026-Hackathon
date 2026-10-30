"""prompt-guard: 공통 검사 API를 쓰는 독립 검사 CLI(초안).

- 원문은 셸 인자가 아니라 대화형 입력 또는 stdin 으로만 받는다.
- 사람용 경고는 stderr, 자동화용 JSON 은 stdout.
- 원문은 다시 출력하지 않는다. sanitize 는 정제문만 출력한다.
- 이 CLI 는 외부 AI 로 전송하지 않는다. 다른 도구가 결과를 무시하고 보내는 것은 막지 못한다.

종료 코드(팀 합의 전 제안): 0 통과, 2 확인 필요, 3 차단, 4 검사·연결 오류
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

EXIT_OK, EXIT_CONFIRM, EXIT_BLOCK, EXIT_ERROR = 0, 2, 3, 4


def _read_text(use_stdin: bool) -> str:
    if sys.stdin.isatty():
        if use_stdin:
            raise SystemExit("--stdin 을 쓰려면 파이프로 입력을 넘기세요.")
        eof = "Ctrl+Z, Enter" if os.name == "nt" else "Ctrl+D"
        print(f"검사할 텍스트를 입력하세요. 끝내려면 {eof}.", file=sys.stderr)
        return sys.stdin.read()
    # 파이프 입력은 UTF-8 로 해석한다(Windows 기본 cp949 로 깨지는 것 방지).
    # PowerShell 파이프가 붙이는 BOM 은 제거한다.
    return sys.stdin.buffer.read().decode("utf-8-sig")


def _call(endpoint: str, text: str, server: str, api_key: str | None, timeout: float) -> dict:
    body = json.dumps({
        "request_id": str(uuid.uuid4()),
        "input_version": 1,
        "text": text,
        "context": {"client_type": "cli"},
    }).encode("utf-8")
    req = urllib.request.Request(f"{server.rstrip('/')}/v1/{endpoint}", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    if api_key:
        req.add_header("X-API-Key", api_key)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def exit_code_for(result: dict) -> int:
    if result.get("status") != "complete":
        return EXIT_ERROR if result.get("status") == "error" else EXIT_CONFIRM
    return {"allow": EXIT_OK, "warn": EXIT_CONFIRM, "block": EXIT_BLOCK}.get(
        result.get("decision"), EXIT_ERROR)


def _report(result: dict, findings_key: str) -> None:
    signal = {"green": "통과", "yellow": "확인 필요", "red": "차단", "gray": "검사 미완료(전송 보류)"}
    print(f"[prompt-guard] {signal.get(result.get('signal'), '?')} "
          f"(decision={result.get('decision')}, status={result.get('status')}, "
          f"policy={result.get('policy_version')})", file=sys.stderr)
    for f in result.get(findings_key, []):
        print(f"  - {f['type']} [{f['action']}] {f['reason']} @ {f['span']['start']}-{f['span']['end']}",
              file=sys.stderr)
    for n in result.get("notices", []):
        print(f"  ! {n}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="prompt-guard")
    p.add_argument("command", choices=["inspect", "sanitize"])
    p.add_argument("--stdin", action="store_true", help="stdin 에서 텍스트를 읽는다")
    p.add_argument("--json", action="store_true", help="결과 JSON 을 stdout 에 출력")
    p.add_argument("--server", default=os.getenv("PG_SERVER_URL", "http://127.0.0.1:8000"))
    p.add_argument("--timeout", type=float, default=float(os.getenv("PG_CLI_TIMEOUT_S", "30")))
    args = p.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")

    try:
        text = _read_text(args.stdin)
    except UnicodeDecodeError:
        print("[prompt-guard] 입력이 UTF-8 이 아닙니다. 전송을 보류하세요.", file=sys.stderr)
        return EXIT_ERROR
    try:
        result = _call(args.command, text, args.server, os.getenv("PG_API_KEY"), args.timeout)
    except urllib.error.HTTPError as exc:
        print(f"[prompt-guard] 검사 실패: HTTP {exc.code}. 전송을 보류하세요.", file=sys.stderr)
        return EXIT_ERROR
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        # 서버 오류 시 원래 AI 명령으로 폴백하지 않는다.
        print(f"[prompt-guard] 검사 실패: {type(exc).__name__}. 전송을 보류하세요.", file=sys.stderr)
        return EXIT_ERROR

    if args.command == "inspect":
        _report(result, "findings")
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
    else:
        _report(result, "remaining_findings")
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        elif result.get("sanitized_text") is not None:
            sys.stdout.write(result["sanitized_text"])
    return exit_code_for(result)


if __name__ == "__main__":
    sys.exit(main())
