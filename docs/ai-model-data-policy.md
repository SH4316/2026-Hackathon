# AI 모델별 데이터 정책 정리

조회일: 2026-10-30. 제공사 공식 페이지에서 확인된 내용만 적었습니다. 확인되지 않은 칸은 `-`입니다. 자료끼리 어긋나는 곳은 둘 다 적고 `[충돌]`로 표시했습니다. 데이터 정책은 제공사와 접근 경로(소비자 앱, API, 클라우드)별 문서이며, 문서에 모델이 따로 언급되지 않은 경우 모델별 차이는 적지 않았습니다.

## 1. 모델 → 제공사 색인

| # | 모델 | 제공사 | 모델에 직접 언급된 내용 |
|---|---|---|---|
| 1 | Claude Opus 5.5 | [Anthropic](#anthropic) | Covered Models 문서에 Opus는 언급되지 않음 |
| 2 | Claude Fable 5.1 | [Anthropic](#anthropic) | Covered Model: 프롬프트·출력 30일 보존 필수, 승인 없이는 ZDR 불가 |
| 3 | Claude Haiku 5.5 | [Anthropic](#anthropic) | 모델 단독 언급 없음 |
| 4 | GPT-6.1 Sol | [OpenAI](#openai) | 데이터 레지던시: 미국·EU만 |
| 5 | GPT-6 Astra | [OpenAI](#openai) | Fast 모드는 EU 레지던시 없음, Ultrafast는 미국 레지던시와 글로벌 처리만 |
| 6 | GPT-6 Luna | [OpenAI](#openai) | EU 레지던시(Standard, Flex, Batch) 지원, `/v1/decisions`에 쓸 수 있는 유일한 모델 |
| 7 | Gemini 3.1 Pro | [Google](#google) | 모델 단독 언급 없음 |
| 8 | Muse (Wonder Full) | [Meta](#meta-muse) | 공식 Muse 문서는 못 찾음 |
| 9 | Grok 4.20 | [xAI](#xai) | 모델 단독 언급 없음 |
| 10 | DeepSeek V4 Pro | [DeepSeek](#deepseek) | 모델 단독 언급 없음 |
| 11 | Kimi K3 | [Moonshot](#moonshot-kimi) | 모델 단독 언급 없음 |
| 12 | Mistral Large 4 | [Mistral](#mistral) | 모델 단독 언급 없음 |
| 13 | Command R+ (08-2024) | [Cohere](#cohere) | 모델 단독 언급 없음 |
| 14 | Nova 2 Lite | [Amazon](#amazon-nova) | Nova 전체에 대한 문서만 있음 |
| 15 | Nova Premier | [Amazon](#amazon-nova) | Nova 전체에 대한 문서만 있음 |
| 16 | Sonar Pro | [Perplexity](#perplexity) | 모델 단독 언급 없음 |
| 17 | Sonar Reasoning Pro | [Perplexity](#perplexity) | 모델 단독 언급 없음 |
| 18 | Copilot | [Microsoft](#microsoft-copilot) | 모델이 아닌 제품 |
| 19 | Qwen | [Alibaba](#alibaba-qwen) | 버전 미확인 |
| 20 | Llama | [Meta](#meta-llama) | 버전 미확인 |

## 2. 제공사별 정리

### Anthropic

| 항목 | 내용 |
|---|---|
| Data usage / handling | API: 보존된 데이터는 명시적 허가 없이 학습에 쓰지 않음. 대화 내용은 기본적으로 보존하지 않으며 예외는 Covered Models |
| Retention | 소비자: 삭제한 대화는 30일 내 백엔드 삭제, 학습 ON이면 비식별화 데이터 최대 5년, OFF면 30일(Claude Code 문서). 안전성 플래그 입출력 최대 2년, 분류 점수 최대 7년. 상업용 Claude Code: 30일. Covered Models: 30일 |
| Training | 소비자: 설정이 ON일 때 학습에 사용. 상업용(Team, Enterprise, API, 제3자 플랫폼): 학습 안 함. 예외는 고객이 제공하기로 한 경우(Development Partner Program) |
| Opt-in / Opt-out | 소비자는 설정에서 선택(opt-out 후에도 이미 학습에 들어간 데이터는 제거되지 않음), Incognito 대화는 학습 제외. Development Partner Program은 조직 관리자가 명시적으로 opt-in, 1st-party API만 해당 |
| ZDR | 조직 단위로 계정팀이 활성화, 표준 Enterprise 플랜에는 미포함. Covered Models는 Anthropic의 명시적 승인이 없으면 ZDR 불가. 기능별 적격 여부 표가 있고, 예를 들어 code execution tool은 ZDR이 아님(컨테이너 데이터 최대 30일) |
| Privacy Policy | 2026-06-08 게시, 2026-07-08 시행(페이지 메타데이터는 2026-09-10으로 불일치). 입출력은 계정 설정에서 거부하지 않으면 학습에 사용, 거부 후에도 안전성 플래그·직접 신고 데이터는 사용될 수 있음 |
| ToS / Commercial Terms | 고객이 입력물 권리 보유·출력물 소유. "Anthropic may not train models on Customer Content from Services". 보존 기간은 정하지 않음. 시행일 2025-06-17 |
| DPA | 고객이 컨트롤러, Anthropic이 프로세서. 종료 후 30일 내 반환·삭제, 침해는 인지 후 48시간 내 통지, 하위처리자 추가는 15일 내 이의 가능, AES-256·TLS 1.2+ |
| Data residency | `inference_geo`로 추론을 미국에 고정(Claude 4.6 이상 모델, 4.5 이하는 400 오류, 요금 1.1배). `workspace_geo`는 저장 위치, 생성 시 지정, 변경 불가, 현재 "us"만 가능. Bedrock·Google Cloud는 엔드포인트·리전으로 결정 |
| Trust Center | trust.anthropic.com (본문은 읽지 못함) |

### OpenAI

| 항목 | 내용 |
|---|---|
| Data usage / handling | API 데이터는 명시적 opt-in 없이는 학습에 쓰지 않음(엔드포인트별 표에서 학습 모두 "No"). 비즈니스 데이터도 기본적으로 학습 안 함. 이용정책: 개인정보 보호 장치와 명확한 검토 절차를 마련한 상태에서 정책 준수 여부를 모니터링하고 집행 |
| Retention | 남용 모니터링 로그 기본 최대 30일. `/v1/responses`는 `store`가 true면 30일, `/v1/files`·`/v1/batches`는 삭제 전까지, 프롬프트 캐시는 24시간 후 만료. Assistants 객체는 삭제 후 30일 |
| Training | API는 사용 안 함(opt-in 시에만). ChatGPT 소비자 학습 정책은 페이지 접근이 거부(403)되어 읽지 못함. 이용정책(2026-11-20 시행)은 OpenAI가 사용자 데이터로 학습하는 규칙이 아니라, 사용자가 OpenAI 모델·결과물로 다른 모델을 학습시키는 것에 대한 제한임(아래 Usage Policy 행 참고) |
| Opt-in / Opt-out | API는 opt-in 방식. 소비자 opt-out 방법은 읽지 못함 |
| ZDR | 사전 승인 필요. 고객 콘텐츠를 남용 모니터링 로그에서 제외하고 `store`를 강제로 false로 함. Modified Abuse Monitoring(MAM)도 별도 승인. 특정 모델을 개별 고객에게 ZDR·MAM 불가로 지정할 권리를 OpenAI가 보유 |
| Privacy Policy | 개인정보처리방침 본문은 검색에서 나오지 않음. 소비자 이용약관(2026-01-01 시행)이 개인정보처리방침을 별도 문서로 참조 |
| ToS / Commercial Terms | OpenAI Services Agreement(2026-01-01 시행): API, ChatGPT Enterprise·Business 등 비즈니스·개발자 서비스에 적용. 5.3항에서 DPA를 참조 |
| DPA | 검색에서 나온 것은 2024-02 버전(OpenAI는 프로세서이며 데이터를 판매하지 않음, 충돌 시 DPA 우선). 최신 버전 확인 필요 |
| Data residency | 프로젝트 단위 설정. 미국·EU(EEA+스위스)는 저장·처리 모두 가능. 호주·캐나다·일본·인도·싱가포르·한국·영국은 저장만 가능. EU는 MAM 또는 ZDR 필요. 2026-03-05 이후 출시 모델의 레지던시 엔드포인트는 10% 가산 |
| Trust Center | Trust Portal(trust.openai.com) 안내(본문은 읽지 못함). 엔터프라이즈 페이지는 SOC 2 감사 완료, AES-256·TLS 1.2+ 암호화를 언급 |
| Usage Policy (이용정책) | 시행일 2026-11-20(2026-10-21 개정 공지, 이전 버전은 2025-10-29). 이번 개정은 모델 학습 제한, 아동·청소년 보호 조치, 중대한 영향을 미치는 사용 요건을 명확히 했고, 기존 국가 안보 원칙을 반영하며 국가 안보·법 집행 목적 사용과 모델 액세스 중개자에 대한 승인 요건을 명시 |
| Usage Policy: 모델 학습 및 개발 | OpenAI 모델이나 서비스를 대체하거나 대안으로 쓰기 위한 모델의 학습 자료·신호를 만들거나 준비·선택·제공하는 데 OpenAI 모델·결과물을 쓰는 것을 금지. 해당 행위: 학습 데이터·학습 과제·평가 기준·강화학습 환경 생성·준비, 레이블·점수·순위·선호도·보상·수정 같은 피드백 제공, 학습 데이터·과제·수행 궤적의 선택·필터링·검증. 무단 액세스, 리버스 엔지니어링, 보호 장치 우회로 보호된 추론 과정을 추출하는 시도도 금지. 결과 모델을 직접 학습시키지 않아도, 타인을 위해 하거나 대리인을 통해 하는 경우, 제품 사용·평가 중 생성된 결과물이 나중에 그런 목적에 쓰이는 경우 모두 적용. 이 제한을 지키는 범위에서 연구, 소프트웨어 개발, 모델 평가·벤치마킹, 제품 개발에는 사용 가능. 서비스 계약 등 OpenAI와의 계약이 명시적으로 허용하는 사용은 금지하지 않음 |
| Usage Policy: 개인정보 | 본인 허가 없이 개인적·민감한 정보를 수집·모니터링·프로파일링·배포하는 행위 금지. 금지 목적: 정보 주체의 동의 없는 안면 인식 데이터베이스, 공공장소 실시간 원격 생체인식, 동의 없이 개인의 유사성(사실적 이미지·목소리) 이용, 사회적 행동·개인적 특성·생체 데이터 기반 평가·분류(사회적 점수, 프로파일링, 민감한 특성 추론 포함), 의료·안전상 이유 외 직장·교육 환경에서의 감정 추론, 개인적 특성·프로파일링에만 의존한 범죄 가능성 평가 |
| Usage Policy: 사람의 검토 | 민감한 분야(중요 기반 시설, 교육, 주택, 고용, 금융·신용, 보험, 법률, 의학, 필수 정부 서비스, 제품 안전 요소, 국가 안보·정보 활동·법 집행, 이주)에서 사람의 검토 없이 중대한 영향을 미치는 조치를 자동화하는 행위 금지 |
| Usage Policy: 승인된 사용 | 국가 안보·정보 활동·법 집행 목적 사용은 OpenAI 승인이 필요하며 인간의 판단과 책임성 유지, 국내 대규모 감시 금지 등 OpenAI 원칙을 따라야 함. 제3자가 OpenAI 모델에 직접 액세스하게 하는 모델 액세스 중개 플랫폼은 사전 검토·승인 필요(애플리케이션 기능 구현을 위한 단순 통합에는 해당하지 않음). 예외는 서면 조건으로 사례별 허용 |

### Google

| 항목 | 내용 |
|---|---|
| Data usage / handling | Gemini API 유료: 프롬프트·응답을 제품 개선에 쓰지 않음. 무료(Unpaid): 제품·ML 기술 개선에 사용, 사람이 검토할 수 있음(계정·API 키·프로젝트 연결은 제거 후) |
| Retention | 유료 API는 남용 감시용으로 "limited period" 로그 보관(기간 미명시). Gemini 앱: Gemini Apps Activity 기본 18개월 후 자동 삭제(3, 36개월 또는 무기한으로 변경 가능), 사람이 검토한 대화는 최대 3년, 임시 채팅·Keep Activity OFF 채팅은 72시간. Search 그라운딩 보관 기간은 [충돌]: API 약관은 30일, ZDR 문서는 로그 최대 3일(Maps는 30일) |
| Training | 앱: Keep Activity가 켜져 있으면 생성형 AI 모델 학습에 사용, 꺼져 있으면 피드백 제출 시 외에는 사용 안 함, 임시 채팅은 학습 안 함. API는 위 참고 |
| Opt-in / Opt-out | 앱은 Keep Activity 설정으로 제어. EEA·스위스·영국 사용자는 무료 서비스에도 유료 데이터 조건 적용 |
| ZDR | Developer API는 ZDR 문서가 있으나 보장형 ZDR·엔터프라이즈 DPA가 필요하면 Vertex AI를 쓰라고 안내. Interactions API는 기본적으로 상태를 저장(`store`를 false로 설정해야 함) |
| Privacy Policy | - |
| ToS / Commercial Terms | Gemini API Additional Terms. Google Cloud 약관은 Google Cloud terms 디렉터리에서 제품별로 제공 |
| DPA | Cloud Data Processing Addendum (Customers): Google과 고객 간 Agreement에 편입되는 부속서. 이전 명칭은 Google Cloud Platform·Looker(original)·Google SecOps·Google Skills for Organizations에서는 "Data Processing and Security Terms", Google Workspace·Cloud Identity에서는 "Data Processing Amendment", Mandiant Consulting·Managed Services에서는 "Data Processing Addendum". 구성: General Terms, Appendix 1(처리 대상과 세부 내용), Appendix 2(보안 조치), Appendix 3(개별 개인정보 보호법), Appendix 4(개별 제품). 마지막 수정일 2026-10-30, 직전 버전은 2026-06-08. 붙여넣은 내용에는 조항 본문이 펼쳐지지 않아 구체적인 조건(삭제, 하위처리자, 이전, 침해 통지 등)은 확인하지 못함. Workspace 프라이버시 허브는 이 부속서 6항을 삭제 규정으로 참조 |
| Data residency | 유료 Developer API 데이터는 Google 시설이 있는 어느 국가에든 일시 저장·캐시될 수 있음. Vertex: 지역·멀티리전 엔드포인트에서는 지정 위치 유지, 글로벌 엔드포인트는 어느 리전에서든 처리 가능 |
| Trust Center | Google Cloud "Trust and security" 페이지(Google Cloud 사이트 메뉴에 있음). 본문은 읽지 못했고 Gemini 정책과의 연결 내용은 확인하지 못함 |

### Meta (Muse)

| 항목 | 내용 |
|---|---|
| Data usage / handling | 학습 데이터에 공개 데이터, 라이선스 데이터, Meta 제품·서비스 정보(공개 게시물, AI 기능과의 상호작용 포함)를 쓴다고 밝힘. 비공개 게시물과 가족·친구 간 비공개 메시지 내용은 학습에 쓰지 않는다고 함 |
| Retention | - |
| Training | - (Muse 전용 공식 문서 없음. 위 Data usage 참고) |
| Opt-in / Opt-out | 계정 전반의 학습 opt-out은 검색 결과에 없음. 제품별 통제만 확인: Quest는 음성 녹음 저장을 끄면 개선에 쓰지 않음, AI 글라스는 opt-in한 경우에만 추가 데이터 사용. Messenger·Instagram·WhatsApp에서 AI 대화 내용을 삭제하는 명령이 있음 |
| ZDR | - |
| Privacy Policy | Muse 전용 문서는 찾지 못함. 확인된 것은 Meta Platforms Technologies 보충 개인정보처리방침과 AI Disclosures |
| ToS / Commercial Terms | - |
| DPA | - |
| Data residency | - |
| Trust Center | - |

### xAI

검색된 페이지들이 회사를 "SpaceXSI"로 표기합니다.

| 항목 | 내용 |
|---|---|
| Data usage / handling | API 입출력은 명시적 허가 없이 학습에 쓰지 않음. 고객이 입력·출력을 소유 |
| Retention | 엔터프라이즈 FAQ: 입출력은 30일 내 자동 삭제(예외 있음). 이 FAQ는 가장 오래된 자료라 다른 문서와 차이가 있을 수 있음 |
| Training | API는 학습 안 함. 소비자 Grok은 공식 문서를 읽지 못함 |
| Opt-in / Opt-out | - |
| ZDR | ZDR 옵션이 있으며, 사용 시 처리 완료 후 사용자 콘텐츠를 보존하지 않음 |
| Privacy Policy | 소비자용 방침이 별도로 있음. X 플랫폼에서의 Grok 사용은 X의 정책을 따름 |
| ToS / Commercial Terms | Enterprise와 Consumer 약관이 분리됨 |
| DPA | Enterprise Terms에 편입. 보안 부록: 저장 AES-256, 전송 TLS 1.3 |
| Data residency | - |
| Trust Center | 공개되지 않고, NDA를 체결한 고객에게 제공. SOC 2 Type 2 준수라고 안내 |

### DeepSeek

| 항목 | 내용 |
|---|---|
| Data usage / handling | 개인 데이터를 서비스 운영에 필요한 동안 보관하고, 법적 의무·정당한 이익·법적 청구 방어를 위해서도 보관. Open Platform 개발자는 컨트롤러이며 자체 방침을 공개해야 하고, DeepSeek 방침은 개발자 앱의 최종 사용자에게 적용되지 않음 |
| Retention | 계정과 연결된 입력·결제 데이터는 계정이 존속하는 동안 보관. 계정 삭제 후에도 법령상 필요한 데이터는 보관할 수 있음. 고정 기간 없음 |
| Training | 암호화·엄격한 비식별화·개인 식별 불가능화 후 입출력을 서비스 개선에 사용할 수 있음 |
| Opt-in / Opt-out | "Improve the model for everyone"를 끄면 opt-out |
| ZDR | - |
| Privacy Policy | 있음(영문본 확인) |
| ToS / Commercial Terms | Terms of Use와 Open Platform Terms가 분리됨 |
| DPA | - |
| Data residency | 개인 데이터를 중국(PRC) 내에서 처리·저장한다고 명시. 다른 버전은 거주 국가 밖의 서버에 저장된다고 적어 [충돌] |
| Trust Center | - |

### Moonshot (Kimi)

| 항목 | 내용 |
|---|---|
| Data usage / handling | Open Platform 방침은 목적에 "기반 기술과 머신러닝 모델·알고리즘의 학습과 개선"을 포함. Open Platform 서비스 계약은 고객 데이터와 최종 사용자 개인정보를 구분하고 개발자가 최종 사용자 개인정보 책임을 짐 |
| Retention | - |
| Training | [충돌] API 도움말 센터는 API로 제출한 입력과 출력을 학습에 쓰지 않는다고 하고, Open Platform 방침은 학습을 목적에 포함. Business Services 약관은 고객이 명시적으로 허가하거나 법이 요구하지 않는 한 기본적으로 학습하지 않는다고 함. 소비자 방침(2025-07-07 갱신)은 학습·최적화를 처리 목적으로 명시 |
| Opt-in / Opt-out | 소비자는 계정 단위 opt-out만 가능(대화·파일 단위는 미지원), 신원 확인 후 30일 이내 완료. 고객센터 요청 방식도 안내됨 |
| ZDR | - |
| Privacy Policy | 소비자 방침(NOVASCENT PRIVATE LIMITED)과 Open Platform 방침(MOONSHOT AI PTE. LTD., 2025-04-30 갱신)이 분리됨 |
| ToS / Commercial Terms | 소비자 이용약관과 Open Platform 이용약관이 분리됨 |
| DPA | - |
| Data residency | [충돌] Open Platform 방침은 서버가 싱가포르에 있다고 하고, 소비자용 도움말은 중국 본토 서버라고 안내 |
| Trust Center | - |

### Mistral

| 항목 | 내용 |
|---|---|
| Data usage / handling | API: 출력 생성에 필요한 기간 동안 입출력을 보관하고, 이후 남용 모니터링을 위해 30일 롤링 보관. ZDR을 켜면 제외 |
| Retention | API 30일 롤링(ZDR 활성 시 제외). Vibe(Le Chat)는 계정이나 대화를 삭제할 때까지 보관 |
| Training | [충돌] Commercial Terms는 Mistral에 고객 데이터·출력을 모델 학습에 쓸 라이선스를 부여. DPA는 고객이 opt-out하지 않은 한 학습을 컨트롤러 목적으로 열거. EEA 소비자 약관은 입력·출력에 나타나는 제3자 콘텐츠를 학습에 쓰지 않는다고 함 |
| Opt-in / Opt-out | Le Chat 무료·Pro·Student는 입출력이 기본적으로 학습에 쓰이며 opt-out 가능, Team·Enterprise는 기본적으로 opt-out 상태. 학습 opt-out에 ZDR은 필요 없음 |
| ZDR | 유료 플랜의 지원되는 stateless API 호출에서 가능 |
| Privacy Policy | 있음 |
| ToS / Commercial Terms | Commercial Terms of Service, EEA 소비자 약관, Microsoft 채널용 약관이 따로 있음. Microsoft 채널은 ZDR이며 EU/EFTA 고객 데이터 처리는 EU/EFTA 내 시스템으로 한정 |
| DPA | 2026-07-27 시행. Mistral은 프로세서이고, EEA 밖 이전에는 EU SCCs를 사용 |
| Data residency | 기본 EU 호스팅, US API 엔드포인트를 명시적으로 쓰면 미국 호스팅. 일부 기능은 트러스트 센터의 하위처리자 탭에 나온 EU 밖 위치로 데이터를 보낼 수 있고, 엔터프라이즈는 조직 단위로 일부 기능을 끌 수 있음 |
| Trust Center | trust.mistral.ai (하위처리자 목록과 기술·조직적 조치 호스팅, 본문은 읽지 못함) |

### Cohere

| 항목 | 내용 |
|---|---|
| Data usage / handling | 개인정보처리방침은 엔터프라이즈 계약하의 고객 입출력을 제외하고, 그 데이터는 엔터프라이즈 계약과 해당되는 경우 DPA가 규율 |
| Retention | SaaS 플랫폼에서 기록된 프롬프트·생성물은 30일 후 자동 삭제(법적·계약상 필요하거나 약관 위반 가능성으로 플래그된 경우 제외) |
| Training | 학습 목적 데이터는 계약에 따라 별도 보관될 수 있다고 명시. 기본값은 찾지 못함 |
| Opt-in / Opt-out | 대시보드 Data Controls 설정에서 제어 |
| ZDR | 프롬프트와 생성물을 기록하지 않음. 추가 약정을 할 수 있는 엔터프라이즈 고객에게만 허용되며, 사용량 데이터는 ZDR이어도 수신 |
| Privacy Policy | 있음 |
| ToS / Commercial Terms | Terms of Use(체험 사용자), SaaS Agreement(상업 고객), Client License Agreement |
| DPA | EU SCCs(2021-06-04 승인본)를 편입. SaaS 고객은 privacy@cohere.com에 요청, 사본은 NDA 체결 필요 |
| Data residency | - |
| Trust Center | ISO 27001, ISO 42001, SOC 2 Type II 보고서와 하위처리자 목록 호스팅 |

### Amazon (Nova)

| 항목 | 내용 |
|---|---|
| Data usage / handling | Bedrock의 입출력은 Nova, Titan, 제3자 모델 학습에 쓰지 않으며 모델 제공사와 공유하지 않음. 고객 동의가 없는 한 프롬프트·출력을 학습에 쓰지 않음 |
| Retention | [충돌] Nova 문서는 Bedrock이 프롬프트와 완료 결과를 저장·로깅하지 않는다고 하고, CloudWatch 문서는 일부 모델에서 남용 탐지를 위해 입출력을 최대 30일 보관한다고 함. 이 보관은 서비스 개선·학습과 별개라고 명시 |
| Training | 위 Data usage 참고 |
| Opt-in / Opt-out | - |
| ZDR | - |
| Privacy Policy | - |
| ToS / Commercial Terms | Bedrock 제3자 모델 서비스 약관 페이지 |
| DPA | Global AWS DPA가 계정에 업로드된 개인 데이터 처리 약정을 규정한다고 AWS 블로그가 설명. DPA 본문은 찾지 못함 |
| Data residency | Bedrock이 처리하는 고객 콘텐츠는 암호화되어 사용 중인 AWS 리전에 저장됨. Nova 전용 레지던시 조항은 찾지 못함 |
| Trust Center | - |

### Perplexity

| 항목 | 내용 |
|---|---|
| Data usage / handling | 엔터프라이즈 데이터는 Perplexity 모델 학습·파인튜닝에 쓰지 않고, 제3자 AI 제공사와의 계약도 그 데이터 학습을 금지 |
| Retention | 엔터프라이즈 세션 첨부 파일은 7일 후 삭제(세션 자체는 별도), 50석 이상이거나 Enterprise Max 1석 이상이면 세션 보존 기간을 직접 설정 가능 |
| Training | 엔터프라이즈는 학습 제외. 소비자 플랜은 공식 문서를 읽지 못함 |
| Opt-in / Opt-out | - |
| ZDR | [충돌] API FAQ는 기본 0일 보존·학습 안 함이라고 하고, 최신 Privacy & Security 페이지는 서면 계약에 따른 계정 단위 설정으로 적격 고객에게만 제공된다고 하며 설정되지 않았다면 적용된다고 가정하지 말라고 함. ZDR 계정은 ZDR을 지원하는 모델만 사용 가능 |
| Privacy Policy | 본문은 검색에서 나오지 않음. Data Collection 도움말만 확인 |
| ToS / Commercial Terms | - |
| DPA | 데이터 처리 등 컴플라이언스 문서는 Trust Center를 통해 제공된다고 안내 |
| Data residency | - |
| Trust Center | SOC 2 Type II 보고서, 2025 HIPAA gap 평가, CAIQlite 평가를 Trust Center에서 제공 |

### Microsoft (Copilot)

| 항목 | 내용 |
|---|---|
| Data usage / handling | 개인 Microsoft 계정은 Microsoft Services Agreement와 Copilot 이용약관을 따르고, 개인 데이터는 Microsoft 개인정보 보호정책이 적용. 기업: Microsoft는 Windows Server 제품과 인터넷 기반 기능에서 별도 명시가 없으면 개인 데이터의 컨트롤러이며, 이 경우 DPA가 적용되지 않음. Bing 검색 서비스, Web IQ, Microsoft Foundry의 Grounding with Bing Search는 DPA 적용 대상이 아니며 Grounding with Bing은 고객 데이터가 고객의 컴플라이언스·Geo 경계 밖으로 흐름 |
| Retention | [충돌] Privacy FAQ는 대화를 기본 18개월 보관, 업로드 파일도 최대 18개월이라고 함. 개인용 개인정보 페이지는 대화 18개월, 업로드 파일 30일. 새 Copilot 앱은 2026-08에 적용되었고 해당 관리 문서는 이전 버전만 다룬다고 명시. Product Terms: Dragon Copilot 무료 체험은 구독 만료·종료 후 90일 보존, Azure AI Services의 비활성 구성·커스텀 모델(호출·수정·유효 키·고객 로그인이 90일 없음)은 Microsoft 재량으로 온라인 서비스처럼 취급, Dynamics 365 Business Central·Finance(덴마크)의 회계 자료는 회계연도 종료 후 5년 보존하며 고객이 삭제 불가 |
| Training | 로그인한 개인 사용자는 대화의 학습 사용을 opt-out할 수 있음. 조직 Entra ID 로그인, 18세 미만, 일부 시장 사용자는 제외. Dynamics 365·Power Platform: 테넌트 관리자가 opt-in하지 않는 한 고객 데이터를 학습에 쓰지 않음. Product Terms의 Dragon Copilot 조항은 고객이 Microsoft에 AI/ML 모델 학습·개발 목적으로 고객 데이터를 (사람 검토 포함) 처리하도록 지시하는 것으로 정의하고, 동의하지 않으면 Dragon Copilot을 쓰지 말라고 명시. 건강정보는 45 C.F.R. §164.514(b)에 따라 비식별화할 수 있고 비식별 데이터는 기밀 정보에서 제외 |
| Opt-in / Opt-out | 개인 사용자 opt-out(Privacy controls 페이지). 기업은 테넌트 관리자 opt-in |
| ZDR | - |
| Privacy Policy | Microsoft Privacy Statement |
| ToS / Commercial Terms | Microsoft Services Agreement와 Copilot 이용약관(개인 계정) |
| DPA | Microsoft Products and Services Data Protection Addendum: Product Terms 사이트의 부속서이며 이전의 Online Services Terms를 대체. 최신 영문판은 2026-05-22, 2020-01까지 이전 판이 보관됨. Microsoft Online Subscription Agreement, Microsoft Customer Agreement, 볼륨 라이선스 계약이 DPA를 편입. 다른 라이선스 조건과 충돌하면 DPA가 우선. GDPR 28조 처리자 의무를 다루는 "European Union General Data Protection Regulation Terms" 첨부 포함. DPA 본문(삭제, 하위처리자, 침해 통지, 감사 등)은 다운로드 문서(DOCX)에 있어 읽지 못함 |
| Data residency | Core Online Services의 저장 위치: Office 365는 Exchange, SharePoint, OneDrive, Teams, Copilot 상호작용 콘텐츠 등 지정 데이터를 해당 Geo 안에만 저장(Microsoft 365 Copilot·Copilot Chat은 별도 데이터 레지던시 조건 적용). Dynamics 365, Power Platform, Intune, Defender, Windows 365는 지정 Geo에 저장하되 트러스트 센터 예외 있음. Azure Core Services는 고객이 설정한 Geo에 따르고 일부 서비스는 백업을 다른 곳에 저장. Dragon Copilot은 테넌트 위치에 따라 달라짐(예: 아일랜드·벨기에 테넌트는 프랑스, 오스트리아·네덜란드 테넌트는 독일에 저장). EU Data Boundary: EU·EFTA 내 데이터센터로 한정하되 Microsoft 직원의 원격 접근, 고객이 시작한 전송, 보안 위협 방어, 디렉터리 복제, 네트워크 전송, 가명 처리된 서비스 품질 데이터 등 일부 전송 예외 있음 |
| Trust Center | Security Copilot FAQ는 Microsoft Trust Center를, Dynamics 365 FAQ는 Service Trust Portal을 안내. Security Copilot은 HIPAA용 BAA 적용. Product Terms: Core Online Services(Azure Core Services와 Defender Experts는 예외)는 SSAE 18 SOC 1 Type II, SOC 2 Type II 보고서 보유. DPA의 ISO 27001·27002·27018 준수 진술은 Azure FXT Edge Filer, SQL Server, Visual Studio Subscriptions에는 적용되지 않음 |

### Alibaba (Qwen)

| 항목 | 내용 |
|---|---|
| Data usage / handling | Model Studio(API): 입출력을 모델 학습·최적화에 쓰지 않음. 소비자 Qwen Chat: 비식별화된 사용자 콘텐츠와 피드백을 AI 모델 학습·개선에 쓸 수 있음 |
| Retention | Model Studio 추론 호출의 프롬프트·응답은 기본 최대 30일(법적·보안 필요 시 연장). 대화 저장·파일 같은 상태 데이터는 삭제 전까지 |
| Training | 위 참고. Qwen 이용약관은 피드백(좋아요·싫어요)을 회사가 임의의 방식으로 쓸 수 있고, 피드백과 연결된 대화는 보관한다고 명시 |
| Opt-in / Opt-out | - |
| ZDR | 엔터프라이즈 고객 대상, 계정 매니저와의 요구 평가를 거쳐 제공. Model Studio 제품 페이지에도 ZDR 표기가 있으나 계약 확인 필요 |
| Privacy Policy | Qwen Privacy Policy(qwen.ai 버전의 시행일 2026-09-07로 보임, 구버전 캐시 존재), Model Studio 개인정보 고지, Alibaba Cloud 국제 사이트 방침 |
| ToS / Commercial Terms | Qwen Terms of Service, Alibaba Cloud International Product Terms of Service |
| DPA | Alibaba Cloud는 고객의 문서화된 지시에 따르는 프로세서. EEA용 DPA도 별도로 있음 |
| Data residency | - |
| Trust Center | Alibaba Cloud Trust Center FAQ |

### Meta (Llama)

| 항목 | 내용 |
|---|---|
| Data usage / handling | (사용자 제공 내용, 공식 문서에 명시된 것은 아님) 모델 가중치를 내려받아 자체 인프라나 로컬 환경에 자체 호스팅하면 Meta는 프롬프트, 결과물 등 어떤 데이터도 수집하거나 전송받지 않음. 이유: Llama는 API 서비스가 아닌 오픈 가중치 형태로 완전히 오프라인 구동이 가능하고, 모델 내부에 Meta로 데이터를 보내는 원격 측정(Telemetry) 기능이 없어 기술적으로 수집이 불가능함. Llama 라이선스와 Acceptable Use Policy에는 사용 금지 목적만 명시되어 있고 자체 호스팅 모델의 데이터 수집 조항 자체가 없음 |
| Retention | - |
| Training | - |
| Opt-in / Opt-out | - |
| ZDR | - |
| Privacy Policy | - |
| ToS / Commercial Terms | Llama 라이선스와 Acceptable Use Policy. Llama 3 라이선스는 Llama 3와 그 파생물을 제외한 다른 LLM 개선에 자료나 출력을 쓰는 것을 금지 |
| DPA | - |
| Data residency | - |
| Trust Center | - |
