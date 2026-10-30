from app.detection.custom import CustomRuleDetector
from app.registry.schema import CustomRule

RULE = CustomRule(id="marker", kind="keywords", label="기밀 표식", token="MARK",
                  keywords=["Confidential", "대외비", "BM-7"])


def spans(text):
    return [text[c.start:c.end] for c in CustomRuleDetector([RULE]).detect(text)]


def test_english_keyword_needs_word_boundary():
    # 평가 데이터에서 "confidentially/confidentiality" 오탐 41건 → 영단어 경계 적용
    assert spans("We confidentially spoke; confidentiality matters") == []
    assert spans("Proprietary and Confidential.") == ["Confidential"]


def test_korean_keyword_matches_with_particles():
    assert spans("대외비는 공유 금지, 대외비문서") == ["대외비", "대외비"]


def test_keyword_ending_with_digit_needs_boundary():
    assert spans("BM-7a 와 BM-77 은 아님, BM-7 만") == ["BM-7"]
