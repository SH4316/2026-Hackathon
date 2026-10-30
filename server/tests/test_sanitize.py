from app.sanitize.replacer import Replacement, apply, assign_tokens


def test_consistent_tokens_and_reverse_apply():
    text = "a@x.io, b@x.io, a@x.io"
    items = [Replacement(0, 6, "email", "EMAIL"), Replacement(8, 14, "email", "EMAIL"),
             Replacement(16, 22, "email", "EMAIL")]
    out = apply(text, assign_tokens(text, items))
    assert out == "[EMAIL_1], [EMAIL_2], [EMAIL_1]"
