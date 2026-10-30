// 서버 응답 코드값 → 화면 문구
var PG = (globalThis.PG = globalThis.PG || {});

PG.TYPE_LABELS = {
  rrn: "주민등록번호",
  phone: "전화번호",
  email: "이메일 주소",
  passport: "여권번호",
  driver_license: "운전면허번호",
  credit_card: "신용카드 번호",
  bank_account: "계좌번호",
  aws_access_key_id: "AWS Access Key",
  github_token: "GitHub 토큰",
  jwt: "JWT 토큰",
  private_key: "개인키(PEM)",
  password: "비밀번호",
  secret_config_value: "설정 파일의 비밀값",
  url_with_credentials: "인증정보가 포함된 URL",
  internal_ip: "내부 IP 주소",
  internal_cidr: "내부 IP 대역",
  internal_domain: "내부 도메인",
  ip_address: "IP 주소",
  cidr: "IP 대역",
  mac_address: "MAC 주소",
  url: "URL",
  cve: "CVE 식별자",
  unpublished_research: "미공개 연구 결과(후보)",
  trade_secret: "영업비밀(후보)",
  internal_project: "내부 프로젝트 정보(후보)",
  sensitive_personal: "민감 개인정보(후보)",
  third_party_record: "제3자 원본 데이터(후보)",
};

PG.ACTION_LABELS = {
  block: "전송 불가",
  mask: "치환 필요",
  warn: "확인 필요",
  allow: "참고",
};

PG.CONFIDENCE_LABELS = { high: "탐지 신뢰도 높음", medium: "탐지 신뢰도 중간", low: "탐지 신뢰도 낮음" };

PG.TIER_LABELS = { standard: "표준", elevated: "강화", restricted: "제한" };

PG.PROVIDER_LABELS = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (ChatGPT)",
  google: "Google (Gemini)",
  microsoft: "Microsoft (Copilot)",
  deepseek: "DeepSeek",
  moonshot: "Moonshot (Kimi)",
  mistral: "Mistral",
  perplexity: "Perplexity",
  xai: "xAI (Grok)",
  alibaba: "Alibaba (Qwen)",
  meta: "Meta AI",
  unknown: "알 수 없음",
};

PG.NOTICE_LABELS = {
  destination_unknown: "전송 대상 AI를 알 수 없어 강화 기준을 적용했습니다.",
  destination_channel_unknown: "접근 경로를 알 수 없어 강화 기준을 적용했습니다.",
  destination_channel_unverified: "조직 계약이 확인되지 않은 경로라 강화 기준을 적용했습니다.",
  destination_policy_stale: "제공사 정책 근거가 오래되어 강화 기준을 적용했습니다.",
  model_check_failed: "문맥 검사(로컬 모델)를 완료하지 못했습니다.",
  model_check_required_but_disabled: "정책상 필요한 문맥 검사(로컬 모델)가 꺼져 있습니다.",
};

PG.ERROR_LABELS = {
  network: "검사 서버에 연결할 수 없습니다.",
  timeout: "검사 서버 응답 시간이 초과되었습니다.",
  http_401: "검사 서버 인증에 실패했습니다. 확장프로그램 설정의 API 키를 확인하세요.",
  http_413: "입력이 너무 길어 검사할 수 없습니다.",
  http_422: "검사 요청 형식이 올바르지 않습니다.",
};

PG.errorLabel = (code) =>
  PG.ERROR_LABELS[code] || `검사 서버 오류가 발생했습니다(${code}).`;
