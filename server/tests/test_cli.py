from prompt_guard.cli import EXIT_BLOCK, EXIT_CONFIRM, EXIT_ERROR, EXIT_OK, exit_code_for


def test_exit_codes():
    assert exit_code_for({"status": "complete", "decision": "allow"}) == EXIT_OK
    assert exit_code_for({"status": "complete", "decision": "warn"}) == EXIT_CONFIRM
    assert exit_code_for({"status": "complete", "decision": "block"}) == EXIT_BLOCK
    assert exit_code_for({"status": "error", "decision": "warn"}) == EXIT_ERROR
    assert exit_code_for({"status": "incomplete", "decision": "warn"}) == EXIT_CONFIRM
