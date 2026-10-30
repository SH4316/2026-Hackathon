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
  server_unavailable_local_check: "서버에 연결되지 않아 기기 내 AI와 기본 규칙으로 검사했습니다. 서버의 사용자 규칙은 적용되지 않습니다.",
  local_ai_pii_without_location: "기기 내 AI가 개인정보 가능성을 감지했습니다. 위치를 찾는 모델이 아니므로 해당 내용은 직접 확인·수정해 주세요.",
  local_ai_not_ready: "AI 모델을 준비하고 있습니다. 팝업에서 진행 상태를 확인하세요.",
  local_ai_timeout: "기기 내 AI 검사 시간이 초과되었습니다. 내용을 줄이거나 모델을 다시 준비해 주세요.",
  local_ai_failed: "기기 내 AI 검사를 완료하지 못했습니다. 다시 검사해 주세요.",
  local_ai_load_failed: "AI 모델을 불러오지 못했습니다. 팝업에서 모델 준비를 다시 시도해 주세요.",
  local_ai_superseded: "새 검사 요청이 있어 이전 검사를 취소했습니다.",
  local_ai_input_too_long: "AI가 처리할 수 있는 입력 길이를 초과했습니다. 내용을 나누어 검사해 주세요.",
  local_ai_busy: "AI 검사 요청이 많습니다. 잠시 후 다시 시도하세요.",
  local_ai_integrity: "다운로드한 모델을 확인하지 못했습니다. 모델 준비를 다시 시도하세요.",
  local_ai_output: "AI 결과를 확인하지 못했습니다. 다시 검사하세요.",
  local_ai_encoding: "AI 입력을 변환하지 못했습니다. 다시 검사하세요.",
  local_ai_download: "모델 다운로드에 실패했습니다. 인터넷 연결을 확인하고 다시 시도하세요.",
  destination_unknown: "전송 대상 AI를 알 수 없어 강화 기준을 적용했습니다.",
  destination_channel_unknown: "접근 경로를 알 수 없어 강화 기준을 적용했습니다.",
  destination_channel_unverified: "조직 계약이 확인되지 않은 경로라 강화 기준을 적용했습니다.",
  destination_policy_stale: "제공사 정책 근거가 오래되어 강화 기준을 적용했습니다.",
  model_check_failed: "문맥 검사(로컬 모델)를 완료하지 못했습니다.",
  model_check_required_but_disabled: "정책상 필요한 문맥 검사(로컬 모델)가 꺼져 있습니다.",
};

PG.ERROR_LABELS = {
  ...PG.NOTICE_LABELS,
  no_inspector: "검사 방식이 모두 꺼져 있습니다. 서버 검사 또는 기기 내 AI 검사를 켜 주세요.",
  settings_changed: "검사 설정이 바뀌었습니다. 새 설정으로 다시 검사해 주세요.",
  inspection_failed: "검사를 완료하지 못했습니다. 설정을 확인하고 다시 검사해 주세요.",
  invalid_inspection: "검사 응답 형식이 올바르지 않습니다. 서버 상태를 확인해 주세요.",
  network: "검사 서버에 연결할 수 없습니다.",
  timeout: "검사 서버 응답 시간이 초과되었습니다.",
  http_401: "검사 서버 인증에 실패했습니다. 확장프로그램 설정의 API 키를 확인하세요.",
  http_413: "입력이 너무 길어 검사할 수 없습니다.",
  http_422: "검사 요청 형식이 올바르지 않습니다.",
};

PG.errorLabel = (code) =>
  PG.ERROR_LABELS[code] || `검사 서버 오류가 발생했습니다(${code}).`;
