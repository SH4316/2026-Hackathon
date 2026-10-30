import io
import json
import sys

import pytest

from ai_proxy import cli
from ai_proxy.cli import EXIT_BLOCK, EXIT_CONFIRM, EXIT_ERROR, EXIT_OK, exit_code_for


def test_exit_codes():
    assert exit_code_for({"status": "complete", "decision": "allow"}) == EXIT_OK
    assert exit_code_for({"status": "complete", "decision": "warn"}) == EXIT_CONFIRM
    assert exit_code_for({"status": "complete", "decision": "block"}) == EXIT_BLOCK
    assert exit_code_for({"status": "error", "decision": "warn"}) == EXIT_ERROR
    assert exit_code_for({"status": "incomplete", "decision": "warn"}) == EXIT_CONFIRM
    assert exit_code_for({"status": "complete", "decision": "unknown"}) == EXIT_ERROR


@pytest.mark.parametrize("command", ["inspect", "sanitize"])
def test_original_text_is_not_a_cli_argument(command, capsys):
    with pytest.raises(SystemExit) as error:
        cli.main([command, "synthetic-original-text"])
    assert error.value.code == EXIT_CONFIRM
    assert "synthetic-original-text" not in capsys.readouterr().err


def test_call_uses_ai_proxy_context_and_only_guard_key(monkeypatch):
    seen = []

    def urlopen(request, timeout):
        seen.append((request, timeout))
        return io.BytesIO(b'{"status":"complete","decision":"allow"}')

    monkeypatch.setattr(cli.urllib.request, "urlopen", urlopen)
    cli._call("inspect", "합성 입력", "http://127.0.0.1:8000/", "synthetic-guard", 5,
              {"provider": "openai", "channel": "api"})
    request, timeout = seen[0]
    assert request.full_url == "http://127.0.0.1:8000/v1/inspect"
    assert request.get_header("X-api-key") == "synthetic-guard"
    assert json.loads(request.data)["context"] == {
        "client_type": "ai_proxy", "stage": "submit", "send_action": "normal",
        "destination": {"provider": "openai", "channel": "api"}}


@pytest.mark.parametrize("signal,decision,code", [("green", "allow", 0), ("yellow", "warn", 2), ("red", "block", 3)])
def test_inspect_keeps_exit_codes_and_stderr(monkeypatch, capsys, signal, decision, code):
    monkeypatch.setattr(cli, "_read_text", lambda _: "합성 원문")
    monkeypatch.setattr(cli, "_call", lambda *a: {"signal": signal, "status": "complete", "decision": decision})
    assert cli.main(["inspect"]) == code
    output = capsys.readouterr()
    assert output.out == ""
    assert "[ai-proxy]" in output.err
    assert "합성 원문" not in output.err


def test_sanitize_outputs_only_sanitized_text(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_read_text", lambda _: "합성 원문")
    monkeypatch.setattr(cli, "_call", lambda *a: {"signal": "green", "status": "complete", "decision": "allow",
                                                "sanitized_text": "[SECRET_1]"})
    assert cli.main(["sanitize"]) == EXIT_OK
    output = capsys.readouterr()
    assert output.out == "[SECRET_1]"
    assert "합성 원문" not in output.err


def test_inspector_error_never_echoes_exception_or_original(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_read_text", lambda _: "합성 원문")

    def fail(*args):
        raise cli.urllib.error.URLError("synthetic-private-error")

    monkeypatch.setattr(cli, "_call", fail)
    assert cli.main(["inspect"]) == EXIT_ERROR
    output = capsys.readouterr()
    assert output.out == ""
    assert "합성 원문" not in output.err and "synthetic-private-error" not in output.err


def test_utf8_bom_stdin_is_supported(monkeypatch):
    stream = io.TextIOWrapper(io.BytesIO("\ufeff합성 입력".encode()), encoding="utf-8")
    monkeypatch.setattr(sys, "stdin", stream)
    assert cli._read_text(True) == "합성 입력"
