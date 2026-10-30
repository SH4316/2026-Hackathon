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
  policy-enabled-ink: "#8c6425"
  policy-enabled-surface: "#fbf5e9"
  policy-disabled-ink: "#377765"
  policy-disabled-surface: "#edf6f2"
  policy-unknown-ink: "#5e6b81"
  policy-unknown-surface: "#eff2f7"
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
  input: "5px"
  button: "6px"
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
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
---

## Overview

**Creative North Star: "명확한 운영 기록"**

밝은 작업 환경에서 숫자와 기록을 반복해서 확인하는 관리자 도구다. 중립적인 표면과 한 가지 파란 강조색으로 탐색·조회 동작을 표시하고, 정책 상태는 작은 배지로 구분한다. 사진과 장식적 일러스트를 사용하지 않는다.

## Colors

파랑은 선택된 메뉴, 조회 버튼, 이동 링크에 사용한다. 학습 허용은 황갈색, 학습 미사용은 녹색, 설정 미확인은 청회색이다. 명시적인 미확인을 위험 확정처럼 표현하지 않는다. 정책 정보가 없는 이벤트는 별도의 중립 배지로 표시한다.

본문과 보조 문구는 해당 표면에서 최소 4.5:1 대비를 유지한다. 시각적 비활성 표현과 실제 disabled 속성을 함께 사용한다.

## Typography

한글 가변 글꼴을 npm 패키지로 자체 제공한다. 실행 중 외부 글꼴 서버에 의존하지 않는다. 제목은 짧고, 작은 보조 문구는 단위·집계 범위·시각 기준을 설명한다. 숫자는 tabular-nums를 사용하고 시스템 ID만 고정폭 글꼴로 표시한다.

## Layout

데스크톱은 고정 폭 사이드바(기본 232px)와 유연한 본문으로 구성한다. 본문 최대 너비는 1660px이며 기본 좌우 여백은 36px다. 조회 조건 → 요약 숫자 → 추이 및 분포 → 이력 순서로 읽는다. 요약 숫자 네 개는 하나의 구획 안에 두며 각 수량의 단위를 표시한다.

1280px 이하에서 필터는 세 열로 줄어든다. 1000px 이하에서는 그래프 패널을 한 열로, 요약 숫자를 두 열로 표시한다. 760px 이하에서는 메뉴를 상단 네 개의 탭 형태로 옮기고 본문 패널은 한 열로 유지한다. 모바일 필터는 두 열이며 날짜 범위는 두 열 전체를 차지한다. 넓은 데이터 표는 이름 있는 키보드 접근 가능 영역 안에서만 가로 스크롤한다.

## Elevation & Depth

흰 표면과 가는 테두리로 그룹을 구분한다. 기본 패널에는 그림자를 쓰지 않는다. 차트 툴팁에만 작은 그림자를 적용한다.

## Shapes

패널은 부드러운 모서리, 입력과 버튼은 더 작은 모서리를 사용한다. 작은 배지로 정책과 항목을 표현하고 사람의 첫 글자만 원형 아바타로 표시한다. 아이콘은 직접 작성한 일관된 선형 SVG다.

## Components

- 탐색: 현재 위치는 파란 배경과 글자 두 가지로 표시한다. 비활성 설정 페이지도 접근 가능한 메뉴로 유지한다.
- 조회 조건: 조회 버튼이나 Enter로 폼을 제출할 때 필터를 적용하고, 초기화는 즉시 기본 조건을 적용한다. 날짜는 한국 시간 기준의 포함 범위를 입력한다.
- 표: 숫자는 단위를 함께 표시한다. 사람과 이벤트의 상세 이동은 실제 링크다.
- 정책 배지: 상태 텍스트와 점 표시를 함께 사용한다. 색만으로 의미를 전달하지 않는다.
- 감시 설정: 설명은 읽을 수 있지만 fieldset과 저장 버튼은 disabled다. 설정 예시가 실제 적용되는 것처럼 표현하지 않는다.
- 피드백: 로딩, 빈 결과, 오류와 재시도, 등록 성공을 각각 표현한다. 주기적인 자동 갱신은 없다. 최초 진입과 조회 조건 변경 시 데이터를 불러오고, 새로고침 버튼으로 다시 조회한다. 갱신 시각은 마지막 조회 성공 시각을 한국 시간으로 표시하며 1280px 이하에서는 숨긴다.
- 움직임: 버튼 상태 전환과 로딩·수동 갱신 표시만 사용한다. reduced-motion 설정을 존중한다.

## Do's and Don'ts

- Do 이벤트 건수, 감지 수량, 정책 상태를 각각 이름과 단위로 구분한다.
- Do 모바일에서는 표 자체만 가로 스크롤하고 페이지 전체 너비를 늘리지 않는다.
- Do 샘플 데이터의 이름에 데모임을 표시한다.
- Don't 대화 원문이나 민감정보 값을 화면에 추가하지 않는다.
- Don't 설정 미확인과 정책 정보 없음, 학습 허용과 정책 위반을 같은 의미로 표시하지 않는다.
- Don't 설정 페이지에 실제 저장이나 활성화 동작을 추가하지 않는다.
