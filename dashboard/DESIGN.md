---
name: AI 보안 관제
description: 정책 상태, 감지 수량, 개인별 기록을 명확하게 구분하는 한국어 관리자 화면
colors:
  primary: "#365fc5"
  primary-hover: "#274ca9"
  primary-surface: "#edf2ff"
  canvas: "#f6f8fb"
  surface: "#ffffff"
  ink: "#243148"
  secondary-ink: "#5e6c82"
  border: "#e4e9f0"
  active-ink: "#2f6f58"
  active-surface: "#eaf5ef"
  draft-ink: "#876021"
  draft-surface: "#faf3e7"
  published-ink: "#46649a"
  published-surface: "#edf2fb"
  nav-surface: "#edf2fc"
  tag-ink: "#495b76"
  tag-surface: "#f3f5fa"
  prompt-highlight: "#e0eafa"
  prompt-ink: "#233f77"
typography:
  headline:
    fontFamily: "Noto Sans KR Variable, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Noto Sans KR Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "Noto Sans KR Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Noto Sans KR Variable, sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  mark: "2px"
  badge: "4px"
  input: "5px"
  button: "6px"
  navigation: "7px"
  content: "8px"
  panel: "12px"
spacing:
  compact: "8px"
  control: "12px"
  section: "22px"
  panel: "24px"
  page: "36px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "9px 13px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#465570"
    rounded: "{rounded.button}"
    padding: "9px 13px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "#3d4b64"
    rounded: "{rounded.input}"
    padding: "7px 9px"
    height: "35px"
  navigation-active:
    backgroundColor: "{colors.nav-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.navigation}"
    padding: "11px 14px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  tag:
    backgroundColor: "{colors.tag-surface}"
    textColor: "{colors.tag-ink}"
    rounded: "{rounded.badge}"
    padding: "3px 6px"
  version-active:
    backgroundColor: "{colors.active-surface}"
    textColor: "{colors.active-ink}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  version-published:
    backgroundColor: "{colors.published-surface}"
    textColor: "{colors.published-ink}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  version-draft:
    backgroundColor: "{colors.draft-surface}"
    textColor: "{colors.draft-ink}"
    rounded: "{rounded.badge}"
    padding: "3px 7px"
  prompt-mark:
    backgroundColor: "{colors.prompt-highlight}"
    textColor: "{colors.prompt-ink}"
    rounded: "{rounded.mark}"
    padding: "1px 0"
  tree-row:
    textColor: "{colors.ink}"
    padding: "0 20px 0 18px"
---

## Overview

**Creative North Star: "명확한 운영 기록"**

밝은 작업 환경에서 숫자와 기록을 반복해서 확인하는 관리자 도구다. 중립적인 표면과 한 가지 파란 강조색으로 탐색·조회 동작을 표시하고, 정책 상태는 작은 배지로 구분한다. 사진과 장식적 일러스트를 사용하지 않는다.

2026-10-30 탐지 사용 여부 확장은 현재 main의 SafePrompt 어두운 셸과 기존 런타임 색 토큰을 따른다. 두 설정 화면에서 남아 있던 밝은 폼 표면과 어두운 셸의 혼합으로 제목·보조 문구의 대비가 깨진 선행 차이를 해당 화면에 한정해 바로잡는다. 위의 밝은 작업 환경 설명과 frontmatter·디자인 sidecar는 이전 체계의 기록이며 현재 구현과 차이가 있다. 이번 확장은 새 시각 체계를 정하지 않고 그 토큰·전역 문서 체계를 그대로 보존한다.

## Colors

파랑은 선택된 메뉴, 조회 버튼, 이동 링크와 기본 시계열에 사용한다. 태그와 정책 상태의 색상은 사용자가 정의하며 색만으로 의미를 전달하지 않는다. 활성 버전은 녹색, 초안은 황갈색, 발행 상태는 청색 배지로 구분한다. 정책 정보 없음은 별도의 중립 배지다.

본문과 보조 문구는 해당 표면에서 최소 4.5:1 대비를 유지한다. 실제 조작할 수 없는 컨트롤은 시각적 비활성 표현과 disabled 속성을 함께 사용한다. 탐지에 사용하지 않는 태그·Jev 판단은 “사용 안 함” 텍스트 배지로 구분하며 해당 항목의 설정 입력은 계속 편집할 수 있다. 두 설정 화면의 표면·본문·보조 문구는 현재 main의 기존 런타임 색 토큰을 사용하며 기본 동작·선택 글자·링크의 대비는 해당 화면에 한정해 보정한다.

## Typography

한글 가변 글꼴을 npm 패키지로 자체 제공한다. 실행 중 외부 글꼴 서버에 의존하지 않는다. 제목은 짧고, 작은 보조 문구는 단위·집계 범위·시각 기준을 설명한다. 숫자는 tabular-nums를 사용하고 시스템 ID만 고정폭 글꼴로 표시한다.

## Layout

데스크톱은 고정 폭 사이드바(기본 232px)와 유연한 본문으로 구성한다. 본문 최대 너비는 1660px이며 기본 좌우 여백은 36px다. 전체 현황은 기간·버전 선택 → 요약 숫자 → 시계열·서비스 분포 → 트리·정책 분포 순서로 읽는다. 상세 검색과 Prompt 표는 탐지 이력 화면에 둔다. 요약 숫자 네 개는 하나의 구획 안에 두며 각 수량의 단위를 표시한다.

1000px 이하에서는 그래프 패널을 한 열로, 요약 숫자를 두 열로 표시한다. 760px 이하에서는 메뉴 여섯 개를 상단의 3열 그리드 두 행으로 옮긴다. 메트릭 편집기의 트리와 상세 폼, Jev 설정의 판단 목록과 편집 폼은 세로로 배치한다. 상세 필터는 모바일에서 두 열이며 날짜 범위와 원문 검색은 두 열 전체를 차지한다. 넓은 데이터 표는 이름 있는 키보드 접근 가능 영역 안에서만 가로 스크롤한다.

## Elevation & Depth

흰 표면과 가는 테두리로 그룹을 구분한다. 패널과 차트 툴팁에는 그림자를 쓰지 않는다. 선택 상태는 옅은 배경과 글자색으로 표시한다. 현재 두 설정 화면의 국소 확장은 밝은 폼 대신 어두운 셸과 같은 기존 카드·보조 표면 토큰을 적용하고 가는 테두리로 구획을 유지한다.

## Shapes

패널은 부드러운 모서리, 입력과 버튼은 더 작은 모서리를 사용한다. 작은 배지로 정책과 항목을 표현하고 사람의 첫 글자만 원형 아바타로 표시한다. 아이콘은 직접 작성한 일관된 선형 SVG다.

## Components

- 탐색: 현재 위치는 파란 배경과 글자 두 가지로 표시한다. 메뉴는 여섯 개이며 감시 연동은 제거한다. 기존 `/settings/monitoring` 주소는 쿼리 문자열을 보존해 `/settings/metrics`로 이동한다.
- 조회 조건: 조회 버튼이나 Enter로 폼을 제출할 때 필터를 적용하고, 초기화는 즉시 기본 조건을 적용한다. 날짜는 한국 시간 기준의 포함 범위를 입력한다.
- 표: 숫자는 단위를 함께 표시한다. 사람과 이벤트의 상세 이동은 실제 링크다.
- 태그와 정책: 태그 칩과 분포 막대는 사용자 정의 색을 이름·수량과 함께 표시한다. 정책 배지는 중립 표면 위에 상태 텍스트와 점을 함께 표시하며, 정책 정보 없음은 별도 문구로 표시한다.
- 메트릭 설정: 태그 트리·버전 이름·정책은 초안에서 편집하며 발행 후 고정한다. 태그 이름·색·설명·예시·판단 참고사항·Jev 임계값·Python 정규식·사용 여부는 발행 후에도 현재 선택한 버전에서 편집한다. 발행 화면에서는 구조·정책 컨트롤을 잠그고 세부 정보 입력과 적용 범위 안내를 유지한다. 세부 정보 저장은 선택한 태그만 저장하고 다른 태그·트리·정책의 미저장 입력을 보존한다. 새 태그는 초안 저장에 포함한다. 저장되지 않은 변경과 활성 상태를 별도로 표시한다.
- Jev 설정: 버전 선택과 적용 범위 안내 아래에 좁은 판단 목록과 넓은 편집 폼을 둔다. 선택된 판단은 기존 파란 선택 표현을 사용한다. 이름·다중행 프롬프트 다음에 검색 가능한 결과 태그 목록을 두며 각 행의 체크박스·태그 이름·ID·세부 정보 링크와 점수 임계값을 연결한다. 임계값의 미설정·공유 범위를 안내하고 잘못된 값은 입력 옆에 표시하며 저장을 막는다. 판단 사용 여부도 같은 저장에 포함하며 발행 후에도 편집 입력과 저장 동작을 유지한다.
- 탐지 사용 여부: 태그 상세와 Jev 판단 폼의 시작에 이름·범위 설명·“사용 중/사용 안 함” 텍스트를 갖춘 스위치를 하나씩 둔다. 네이티브 체크박스의 switch 역할과 키보드 포커스를 유지하고 작은 스위치는 최소 44px 높이의 레이블 영역에 둔다. 변경은 기존 저장 동작이 성공할 때 적용하며 저장 중에는 스위치를 잠근다. 사용하지 않는 태그·판단·결과 태그는 목록에서 “사용 안 함”으로 표시한다. 꺼도 입력과 결과 선택은 유지하고 부모·자식 상태는 독립적이다.
- Prompt 상세: 원문을 그대로 표시하고 감지 위치를 강조한다. 겹치는 영역은 Unicode 코드 포인트 경계로 나누며 HTML을 실행하지 않는다.
- 저장된 검색: 고정 스냅샷과 현재 데이터 재조회를 명확히 구분한다.
- 메트릭 트리: 부모와 자식의 감지 영역은 겹칠 수 있으므로 합산형 원형·면적 그래프를 쓰지 않고 독립 막대와 트리 행을 사용한다.
- 피드백: 로딩, 빈 결과, 오류와 재시도, 등록 성공을 각각 표현한다. 주기적인 자동 갱신은 없다. 최초 진입과 조회 조건 변경 시 데이터를 불러오고, 새로고침 버튼으로 다시 조회한다. 갱신 시각은 마지막 조회 성공 시각을 한국 시간으로 표시하며 1280px 이하에서는 숨긴다.
- 움직임: 버튼 상태 전환과 로딩·수동 갱신 표시만 사용한다. reduced-motion 설정을 존중한다.

## Do's and Don'ts

- Do 이벤트 건수, 감지 수량, 정책 상태를 각각 이름과 단위로 구분한다.
- Do 모바일에서는 표 자체만 가로 스크롤하고 페이지 전체 너비를 늘리지 않는다.
- Do 샘플 데이터의 이름에 데모임을 표시한다.
- Don't Prompt 원문을 HTML로 실행하거나 감지 위치를 변경하는 정규화를 적용하지 않는다.
- Don't 사용자 정의 정책 이름이나 색상에서 위험도를 추측하지 않는다.
- Don't 발행된 트리의 태그 ID·구성·부모·순서, 버전 이름과 정책을 직접 수정하거나 태그 세부 정보 변경을 다른 버전에 적용하지 않는다.
- Don't 새 설정 저장과 활성화를 같은 동작으로 처리하지 않는다.
