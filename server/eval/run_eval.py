"""규칙 탐지 정확도 평가(Kaggle "The Learning Agency Lab - PII Data Detection" 형식).

데이터(토큰별 BIO 라벨)를 글자 구간으로 바꾸고, 서버 파이프라인의 판정과 비교한다.

    python eval/run_eval.py --data <kaggle_train.json> [--split dev|holdout|all] [--errors 20]

평가 기준
- 예측: 조치가 allow 가 아닌 탐지 구간(사용자에게 경고·치환·차단으로 이어지는 것).
- 정답 구간과 겹치는 예측이 하나라도 있으면 그 정답은 탐지(TP), 없으면 누락(FN).
- 어떤 정답 구간과도 겹치지 않는 예측은 오탐(FP).
- 오답률 = (FP + FN) / (TP + FP + FN). 정밀도·재현율이 모두 높아야 낮아진다.
- 규칙 평가 범위(오답률 대상): EMAIL, PHONE_NUM, ID_NUM, STREET_ADDRESS — 형식으로 판단 가능한 유형.
- 문맥 유형(재현율만 보고): URL_PERSONAL, USERNAME, NAME_STUDENT.
  학생 이름은 인용된 저자·유명인 이름과, 개인 URL·아이디는 참고 링크·일반 단어와 문맥으로만 구별된다
  (이 데이터의 개인 URL 대부분은 Faker 로 바꾼 임의 도메인이라 형식만으로는 참고 URL 과 구별되지 않는다).
  이런 정답과 겹친 예측은 정탐이며 오탐으로 세지 않는다.
- 오탐은 모든 개인정보 탐지기의 예측을 센다(문서 기밀 표식처럼 개인정보가 아닌 탐지기는 따로 보고).
- 분할: 문서 번호 % 10 < 7 은 dev(규칙 조정용), 나머지는 holdout(최종 보고용).
- 데이터는 저장소에 넣지 않는다(라이선스·용량). 원문은 출력하지 않고 오류 사례도 구간 주변만 짧게 보여 준다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER))

from app.audit.events import AuditStore  # noqa: E402
from app.config import Settings  # noqa: E402
from app.policy.engine import Policy  # noqa: E402
from app.schemas import Action  # noqa: E402
from app.services.pipeline import Pipeline  # noqa: E402

# 형식으로 판단 가능한 유형(규칙 목표: 오답률 5% 미만)
RULE_SCOPE = ["EMAIL", "PHONE_NUM", "ID_NUM", "STREET_ADDRESS"]
# 문맥으로만 판단 가능한 유형(로컬 모델 대상). 규칙은 확실한 일부(프로필 URL·@핸들)만 잡고 재현율만 보고한다.
CONTEXT_SCOPE = ["URL_PERSONAL", "USERNAME", "NAME_STUDENT"]
# 개인정보가 아닌 탐지(문서 기밀 표식 등). 데이터셋 라벨 범위 밖이라 오탐에서 빼고 따로 센다.
NON_PII_DETECTORS = {"confidential_marker"}


def gold_spans(doc: dict) -> list[tuple[str, int, int]]:
    """토큰 BIO 라벨 → (유형, 시작, 끝) 글자 구간. 토큰+공백으로 full_text 위치를 계산한다."""
    out, pos, cur = [], 0, None
    for tok, ws, lab in zip(doc["tokens"], doc["trailing_whitespace"], doc["labels"]):
        start, end = pos, pos + len(tok)
        pos = end + (1 if ws else 0)
        if lab.startswith("B-") or (lab.startswith("I-") and (cur is None or cur[0] != lab[2:])):
            if cur:
                out.append(tuple(cur))
            cur = [lab[2:], start, end]
        elif lab.startswith("I-"):
            cur[2] = end
        else:
            if cur:
                out.append(tuple(cur))
            cur = None
    if cur:
        out.append(tuple(cur))
    return out


def in_split(doc: dict, split: str) -> bool:
    return split == "all" or (doc["document"] % 10 < 7) == (split == "dev")


async def evaluate(docs: list[dict], show_errors: int) -> dict:
    settings = Settings(auth_disabled=True, policy_path=SERVER / "policies/default.yaml")
    pipeline = Pipeline(settings, Policy.load(settings.policy_path), AuditStore(Path(":memory:")),
                        today=lambda: date(2026, 11, 1))
    tier = pipeline.policy.destinations.tiers[pipeline.policy.destinations.default_tier]

    tp, fn = Counter(), Counter()
    fp = Counter()                 # 예측 유형별 오탐
    detected_by = defaultdict(Counter)  # 정답 유형 → 잡은 예측 유형
    errors = defaultdict(list)
    doc_cm = Counter()  # 프롬프트(문서) 단위: 형식 기반 개인정보가 있는 문서를 잡았는지
    for doc in docs:
        text = doc["full_text"]
        gold = gold_spans(doc)
        a = await pipeline.analyze(text, tier)
        preds = [(m.primary.type, m.primary.start, m.primary.end) for m in a.merged
                 if pipeline.policy.action_for(m.primary.type, tier) is not Action.ALLOW]
        for g_type, gs, ge in gold:
            hit = [p for p in preds if p[1] < ge and gs < p[2]]
            if hit:
                tp[g_type] += 1
                detected_by[g_type][hit[0][0]] += 1
            else:
                fn[g_type] += 1
                errors[f"FN {g_type}"].append(text[max(0, gs - 40):ge + 40])
        has_fmt = any(t in RULE_SCOPE for t, _, _ in gold)
        flagged = any(p[0] not in NON_PII_DETECTORS for p in preds)
        if has_fmt:
            doc_cm["tp" if flagged else "fn"] += 1
        elif flagged and not gold:
            doc_cm["fp"] += 1   # 개인정보가 전혀 없는 문서를 경고·차단
        elif not gold:
            doc_cm["tn"] += 1
        else:
            doc_cm["context_only"] += 1  # 이름·개인 URL 등 문맥 유형만 있는 문서(규칙 평가 제외)
        for p_type, ps, pe in preds:
            if not any(ps < ge and gs < pe for _, gs, ge in gold):
                key = f"non_pii:{p_type}" if p_type in NON_PII_DETECTORS else p_type
                fp[key] += 1
                errors[f"FP {key}"].append(text[max(0, ps - 40):pe + 40])

    def summary(scope):
        t, f_n = sum(tp[k] for k in scope), sum(fn[k] for k in scope)
        return t, f_n

    t_rule, fn_rule = summary(RULE_SCOPE)
    fp_total = sum(n for k, n in fp.items() if not k.startswith("non_pii:"))
    report = {
        "docs": len(docs),
        "per_type": {k: {"tp": tp[k], "fn": fn[k], "recall": round(tp[k] / max(1, tp[k] + fn[k]), 4),
                         "detected_as": dict(detected_by[k])}
                     for k in RULE_SCOPE + CONTEXT_SCOPE},
        "false_positives": dict(fp.most_common()),
        "rule_scope": {
            "tp": t_rule, "fn": fn_rule, "fp": fp_total,
            "precision": round(t_rule / max(1, t_rule + fp_total), 4),
            "recall": round(t_rule / max(1, t_rule + fn_rule), 4),
            "error_rate": round((fp_total + fn_rule) / max(1, t_rule + fp_total + fn_rule), 4),
        },
    }
    n = doc_cm["tp"] + doc_cm["fn"] + doc_cm["fp"] + doc_cm["tn"]
    report["document_level"] = {
        **{k: doc_cm[k] for k in ("tp", "fn", "fp", "tn", "context_only")},
        "error_rate": round((doc_cm["fp"] + doc_cm["fn"]) / max(1, n), 4),
        "miss_rate": round(doc_cm["fn"] / max(1, doc_cm["tp"] + doc_cm["fn"]), 4),
        "false_alarm_rate": round(doc_cm["fp"] / max(1, doc_cm["fp"] + doc_cm["tn"]), 4),
    }
    if show_errors:
        report["examples"] = {k: [" ".join(s.split())[:160] for s in v[:show_errors]] for k, v in errors.items()}
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--split", choices=["dev", "holdout", "all"], default="dev")
    ap.add_argument("--errors", type=int, default=0, help="유형별 오류 사례 출력 개수")
    ap.add_argument("--json", type=Path, help="결과 JSON 저장 경로")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    docs = [d for d in json.loads(args.data.read_text(encoding="utf-8")) if "labels" in d]
    docs = [d for d in docs if in_split(d, args.split)]
    report = asyncio.run(evaluate(docs, args.errors))
    report["split"] = args.split
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    examples = report.pop("examples", None)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if examples:
        for k, v in sorted(examples.items()):
            print(f"\n## {k}")
            for s in v:
                print("  -", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
