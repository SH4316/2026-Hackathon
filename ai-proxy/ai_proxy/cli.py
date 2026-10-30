"""ai-proxy: 공통 검사 API를 쓰는 검사 CLI와 AI API 역방향 프록시.

- 원문은 셸 인자가 아니라 대화형 입력 또는 stdin 으로만 받는다.
- 사람용 경고는 stderr, 자동화용 JSON 은 stdout.
- 원문은 다시 출력하지 않는다. sanitize 는 정제문만 출력한다.
- inspect/sanitize 는 외부 AI 로 전송하지 않는다. serve 는 검사 후 전송한다.

종료 코드: 0 통과, 2 확인 필요, 3 차단, 4 검사·연결 오류
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


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # 실수로 넘긴 원문을 argparse 의 unknown-argument 오류에 다시 쓰지 않는다.
        self.print_usage(sys.stderr)
        self.exit(EXIT_CONFIRM, "[ai-proxy] 인자가 올바르지 않습니다. --help 를 확인하세요.\n")


def _read_text(use_stdin: bool) -> str:
    if sys.stdin.isatty():
        if use_stdin:
            raise ValueError("--stdin 을 쓰려면 파이프로 입력을 넘기세요.")
        eof = "Ctrl+Z, Enter" if os.name == "nt" else "Ctrl+D"
        print(f"검사할 텍스트를 입력하세요. 끝내려면 {eof}.", file=sys.stderr)
        return sys.stdin.read()
    # 파이프 입력은 UTF-8 로 해석한다(Windows 기본 cp949 로 깨지는 것 방지).
    # PowerShell 파이프가 붙이는 BOM 은 제거한다.
    return sys.stdin.buffer.read().decode("utf-8-sig")


def _call(endpoint: str, text: str, server: str, api_key: str | None, timeout: float,
          destination: dict | None = None) -> dict:
    context: dict = {"client_type": "ai_proxy", "stage": "submit", "send_action": "normal"}
    if destination:
        context["destination"] = destination
    body = json.dumps({
        "request_id": str(uuid.uuid4()),
        "input_version": 1,
        "text": text,
        "context": context,
    }).encode("utf-8")
    req = urllib.request.Request(f"{server.rstrip('/')}/v1/{endpoint}", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    if api_key:
        req.add_header("X-API-Key", api_key)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        result = json.loads(resp.read())
        if not isinstance(result, dict):
            raise ValueError()
        return result


def exit_code_for(result: dict) -> int:
    if result.get("status") != "complete":
        return EXIT_ERROR if result.get("status") == "error" else EXIT_CONFIRM
    return {"allow": EXIT_OK, "warn": EXIT_CONFIRM, "block": EXIT_BLOCK}.get(
        result.get("decision"), EXIT_ERROR)


def _report(result: dict, findings_key: str) -> None:
    signal = {"green": "통과", "yellow": "확인 필요", "red": "차단", "gray": "검사 미완료(전송 보류)"}
    print(f"[ai-proxy] {signal.get(result.get('signal'), '?')} "
          f"(decision={result.get('decision')}, status={result.get('status')}, "
          f"policy={result.get('policy_version')})", file=sys.stderr)
    for f in result.get(findings_key, []):
        print(f"  - {f['type']} [{f['action']}] {f['reason']} @ {f['span']['start']}-{f['span']['end']}",
              file=sys.stderr)
    for n in result.get("notices", []):
        print(f"  ! {n}", file=sys.stderr)


def _listen(value: str) -> tuple[str, int]:
    try:
        host, port = value.rsplit(":", 1)
        host = host.removeprefix("[").removesuffix("]")
        if not host or not 0 < int(port) <= 65535:
            raise ValueError()
        return host, int(port)
    except ValueError:
        raise argparse.ArgumentTypeError("--listen 은 호스트:포트 형식이어야 합니다.") from None


def _serve(args) -> int:
    import uvicorn

    from ai_proxy.proxy import ProxyApp, ProxyConfig

    try:
        config = ProxyConfig(upstream=args.upstream, server=args.server,
                             api_key=os.getenv("PG_API_KEY"), on_warn=args.on_warn,
                             passthrough=args.passthrough, max_body_bytes=args.max_body_bytes,
                             inspect_timeout=args.timeout, upstream_timeout=args.upstream_timeout)
        host, port = args.listen
        print("[ai-proxy] 검사 프록시를 시작합니다.", file=sys.stderr)
        uvicorn.run(ProxyApp(config), host=host, port=port, access_log=False,
                    proxy_headers=False, server_header=False, log_level="warning")
        return EXIT_OK
    except (ValueError, OSError):
        print("[ai-proxy] 프록시 설정 또는 바인딩을 확인하세요.", file=sys.stderr)
        return EXIT_ERROR
    except SystemExit as exc:
        return EXIT_OK if exc.code == 0 else EXIT_ERROR


def main(argv: list[str] | None = None) -> int:
    p = _ArgumentParser(prog="ai-proxy")
    commands = p.add_subparsers(dest="command", required=True)
    for name in ("inspect", "sanitize", "serve"):
        cmd = commands.add_parser(name)
        cmd.add_argument("--server", default=os.getenv("PG_SERVER_URL", "http://127.0.0.1:8000"))
        cmd.add_argument("--timeout", type=float, default=os.getenv("PG_CLI_TIMEOUT_S", "30"))
        if name != "serve":
            cmd.add_argument("--stdin", action="store_true", help="stdin 에서 텍스트를 읽는다")
            cmd.add_argument("--json", action="store_true", help="결과 JSON 을 stdout 에 출력")
            cmd.add_argument("--provider", help="전송할 AI 제공사(예: openai, anthropic)")
            cmd.add_argument("--channel", help="접근 경로(consumer, enterprise, api 등)")
    cmd.add_argument("--listen", type=_listen, default=("127.0.0.1", 8787))
    cmd.add_argument("--upstream", default="https://api.openai.com")
    cmd.add_argument("--on-warn", choices=("allow", "block"), default="allow")
    cmd.add_argument("--passthrough", action="store_true", help="미지원 경로도 검사 없이 전달")
    cmd.add_argument("--max-body-bytes", type=int, default=1024 * 1024)
    cmd.add_argument("--upstream-timeout", type=float, default=300)
    args = p.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    if args.command == "serve":
        return _serve(args)
    if not 0 < args.timeout < float("inf"):
        print("[ai-proxy] 시간 제한은 양수여야 합니다.", file=sys.stderr)
        return EXIT_ERROR

    try:
        text = _read_text(args.stdin)
    except (UnicodeDecodeError, ValueError):
        print("[ai-proxy] 입력을 UTF-8 stdin 으로 넘기세요. 전송을 보류하세요.", file=sys.stderr)
        return EXIT_ERROR
    try:
        destination = {k: v for k, v in (("provider", args.provider), ("channel", args.channel)) if v}
        result = _call(args.command, text, args.server, os.getenv("PG_API_KEY"), args.timeout,
                       destination or None)
    except urllib.error.HTTPError as exc:
        print(f"[ai-proxy] 검사 실패: HTTP {exc.code}. 전송을 보류하세요.", file=sys.stderr)
        return EXIT_ERROR
    except (urllib.error.URLError, OSError, ValueError) as exc:
        # 서버 오류 시 원래 AI 명령으로 폴백하지 않는다.
        print(f"[ai-proxy] 검사 실패: {type(exc).__name__}. 전송을 보류하세요.", file=sys.stderr)
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
