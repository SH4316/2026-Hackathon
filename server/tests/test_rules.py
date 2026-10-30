import pytest

from app.detection.rules import RuleDetector

# 모두 합성 값이다. 실제 비밀·개인정보를 넣지 않는다.
CASES = [
    ("연락처 010-1234-5678", "phone"),
    ("메일 hong.gildong@example.com 로", "email"),
    ("주민번호 900101-1234567", "rrn"),
    ("주민번호 900101 1234567", "rrn"),  # 공백 구분자(과거 검증기 예외로 500)
    ("카드 4111 1111 1111 1111", "credit_card"),
    ("key AKIAIOSFODNN7EXAMPLE", "aws_access_key_id"),
    ("ghp_" + "a" * 36, "github_token"),
    ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "jwt"),
    ("-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----", "private_key"),
    ("password: hunter22", "password"),
    ("서버 192.168.0.10 접속", "internal_ip"),
    ("대역 10.0.0.0/8", "internal_cidr"),
    ("공인 8.8.8.8", "ip_address"),
    ("aa:bb:cc:dd:ee:ff", "mac_address"),
    ("CVE-2024-12345 패치", "cve"),
    ("https://user:pw@git.example.com/repo", "url_with_credentials"),
    ("계좌번호: 110-123-456789", "bank_account"),
    ("fe80::1 링크로컬", "internal_ip"),
    # 개인정보 평가(Kaggle PII) 후 추가한 규칙
    ("Mobile: (820)913-3241x894", "phone"),
    ("call 410.526.1667 today", "phone"),
    ("WhatsApp +44 20 7946 0958", "phone"),
    ("Roll No. : 932353568953", "id_number"),
    ("Group id  :   027693", "id_number"),
    ("학번: 2024123456", "id_number"),
    ("PERSON 1: David 943063077874", "id_number"),
    ("591 Smith Centers Apt. 656, Joshuamouth, RI 95963", "street_address"),
    ("서울특별시 종로구 세종대로 110", "street_address"),
    ("https://www.linkedin.com/in/mmartinez", "url_personal"),
    ("username: fdixon", "username"),
]


@pytest.mark.parametrize("text,expected", CASES)
def test_detects(text, expected):
    types = {c.type for c in RuleDetector().detect(text)}
    assert expected in types


@pytest.mark.parametrize("text", [
    "회의는 12:30:45 에 시작합니다.",
    "결과는 표 3에서 0.912 와 1.204 였다.",
    "for i in range(10): print(i)",
    "주민번호 아님 991399-1234567",       # 잘못된 날짜
    "카드 아님 4111 1111 1111 1112",      # Luhn 불일치
    "날짜 20240229 기준",                  # 8자리 날짜는 식별번호 아님
    "버전 +1 2 3",                          # 국제번호 자릿수 부족
    "ID: ABCDEFG",                          # 키워드 뒤 값에 숫자 4개 미만
    "90 Thousand Sq. Kilometers",           # 면적 표현은 주소 아님
    "경로 3 으로 가세요",                    # 시·군·구 없는 '…로 숫자'
    "professor @Darden University",         # @언급은 아이디로 보지 않음
])
def test_no_false_positive(text):
    assert RuleDetector().detect(text) == []


def test_offsets_are_exact():
    text = "😀 메일 a@b.io"
    [c] = RuleDetector().detect(text)
    assert text[c.start:c.end] == "a@b.io"
