#!/usr/bin/env python3
"""Real HTTP integration checks. Adds explicitly named smoke data; never deletes data."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import uuid
from zoneinfo import ZoneInfo

from api_client import Api


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description="로컬 API와 실제 DB 연결을 검증합니다. 테스트 전용 DB 권장.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--report", type=Path, help="검증 결과 JSON 저장 경로")
    args = parser.parse_args()
    api = Api(args.base_url)
    checks = []
    token = uuid.uuid4().hex[:12]
    person_id = f"smoke-{token}"
    zero_id = f"smoke-zero-{token}"
    source_id = f"smoke-{token}"
    now = datetime.now(timezone.utc).replace(microsecond=123456)
    seoul = ZoneInfo("Asia/Seoul")
    day = now.astimezone(seoul).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=2)
    start = day.isoformat()
    end = (day + timedelta(days=2)).isoformat()
    filters = {"personId": person_id, "from": start, "to": end}

    require(api.expect("GET", "/health", 200) == {"status": "UP"}, "health response")
    api.expect("POST", "/people", 201, {"id": person_id, "name": f"데모 검증 {token} 100%"})
    api.expect("POST", "/people", 201, {"id": zero_id, "name": f"데모 검증 미발생 {token}"})
    api.expect("POST", "/people", 409, {"id": person_id, "name": "데모 중복"})
    checks.append("health, person registration and duplicate rejection")

    def event(key, offset, service, policy, findings):
        result = {"sourceId": source_id, "eventId": key, "personId": person_id,
                  "occurredAt": (day + timedelta(hours=offset)).isoformat(),
                  "service": service, "findings": findings}
        if policy is not None:
            result["policyState"] = policy
        return result

    payload = event("a", 0, "chatgpt", "TRAINING_ALLOWED", [
        {"category": "PERSONAL_DATA", "quantity": 2}, {"category": "CREDENTIAL", "quantity": 1}])
    with ThreadPoolExecutor(max_workers=12) as pool:
        duplicates = list(pool.map(lambda _: api.request("POST", "/events", payload), range(12)))
    require(sum(status == 201 for status, _ in duplicates) == 1, "one concurrent insert must return 201")
    require(all(status in (200, 201) for status, _ in duplicates), "concurrent duplicates must be accepted")
    ids = {body["id"] for _, body in duplicates}
    require(len(ids) == 1, "concurrent duplicates must share one event id")
    first_id = next(iter(ids))
    canonical = dict(payload, service="CHATGPT", findings=list(reversed(payload["findings"])),
                     occurredAt=day.astimezone(timezone.utc).isoformat())
    require(api.expect("POST", "/events", 200, canonical)["id"] == first_id, "canonical duplicate")
    api.expect("POST", "/events", 409, dict(payload, model="conflict"))
    checks.append("12 concurrent duplicate requests, canonical replay and conflict")

    api.expect("POST", "/events", 201, event("b", 1, "claude", "TRAINING_DISABLED", [{"category": "CREDENTIAL", "quantity": 3}]))
    api.expect("POST", "/events", 201, event("c", 24, "gemini", None, [{"category": "CONFIDENTIAL", "quantity": 4}]))
    api.expect("POST", "/events", 201, event("d", 25, "custom-service", "UNKNOWN", []))
    metrics = api.expect("GET", "/metrics", 200, query=filters)
    require(metrics["summary"] == {"eventCount": 4, "findingCount": 10, "personCount": 1, "unknownPolicyCount": 1}, "unfiltered metric totals")
    require(len(metrics["daily"]) == 2 and metrics["daily"][0]["eventCount"] == 2 and metrics["daily"][1]["findingCount"] == 4, "Seoul calendar buckets")
    require(sum(item["eventCount"] for item in metrics["policies"]) == 3, "null policy excluded from policy chart")
    selected = api.expect("GET", "/metrics", 200, query=dict(filters, category="CREDENTIAL"))
    require(selected["summary"]["eventCount"] == 2 and selected["summary"]["findingCount"] == 4, "category selects events and category quantities")
    require(sum(item["count"] for item in selected["categories"]) == 4, "unselected categories have zero totals")
    require(len(selected["categories"]) == 3 and len(selected["policies"]) == 3, "all enum buckets returned")
    allowed = api.expect("GET", "/metrics", 200, query=dict(filters, policyState="TRAINING_ALLOWED"))
    require(allowed["summary"]["eventCount"] == 1 and allowed["summary"]["findingCount"] == 3, "policy filter")
    custom = api.expect("GET", "/events", 200, query=dict(filters, service="custom-service"))
    require(custom["totalElements"] == 1 and custom["items"][0]["findingCount"] == 0, "additional service and policy-only event")
    boundary = api.expect("GET", "/events", 200, query=dict(filters, to=(day + timedelta(days=1)).isoformat()))
    require(boundary["totalElements"] == 2, "exclusive end boundary")
    empty = api.expect("GET", "/metrics", 200, query=dict(filters, service="empty-service"))
    require(all(row["eventCount"] == 0 and row["findingCount"] == 0 for row in empty["daily"]), "zero-filled daily buckets")
    checks.append("metrics, category/policy/service filters, UTC offsets, Seoul buckets and [from,to) bounds")

    page0 = api.expect("GET", "/events", 200, query=dict(filters, size=2, page=0))
    page1 = api.expect("GET", "/events", 200, query=dict(filters, size=2, page=1))
    require(page0["totalElements"] == 4 and page0["totalPages"] == 2, "pagination totals")
    require([row["eventId"] for row in page0["items"] + page1["items"]] == ["d", "c", "b", "a"], "newest-first pages")
    person = api.expect("GET", f"/people/{person_id}", 200, query=filters)
    require(person["eventCount"] == 4 and person["findingCount"] == 10, "person aggregate")
    zero = api.expect("GET", "/people", 200, query=dict(filters, personId=zero_id))
    require(zero["totalElements"] == 1 and zero["items"][0]["eventCount"] == 0, "registered people with zero events")
    literal = api.expect("GET", "/people", 200, query={"q": f"{token} 100%"})
    require(literal["totalElements"] == 1, "literal person search")
    require(api.expect("GET", f"/events/{first_id}", 200)["sourceId"] == source_id, "event detail")
    checks.append("event/person details, pagination, literal search and zero-event people")

    bad_payloads = [dict(payload, eventId="bad-unknown", rawPrompt="smoke-invalid-field"),
                    dict(payload, eventId="bad-person", personId="missing-person"),
                    dict(payload, eventId="bad-future", occurredAt=(now + timedelta(minutes=10)).isoformat()),
                    dict(payload, eventId="bad-offset", occurredAt="2026-01-01T10:00:00"),
                    dict(payload, eventId="bad-findings", findings=[{"category": "CREDENTIAL", "quantity": 0}]),
                    dict(payload, eventId="bad-duplicate", findings=[{"category": "CREDENTIAL", "quantity": 1}] * 2),
                    dict(payload, eventId="bad-empty", policyState=None, findings=[])]
    for index, bad in enumerate(bad_payloads):
        body = api.expect("POST", "/events", 422 if index == 1 else 400, bad)
        require("code" in body and "message" in body and "smoke-invalid-field" not in json.dumps(body), "safe error shape")
    for query in ({"category": "WRONG"}, {"policyState": "WRONG"}, {"size": 101}, {"page": -1},
                  {"service": "bad.service"}, {"from": "2026-01-01T00:00:00"},
                  {"from": end, "to": start},
                  {"from": start, "to": (day + timedelta(days=367)).isoformat()}):
        api.expect("GET", "/events", 400, query=query)
    api.expect("GET", "/events/9223372036854775807", 404)
    api.expect("GET", "/people/missing-person", 404)
    checks.append("invalid payloads/filters, unknown fields, future timestamps and 404 errors")

    report = {"status": "PASS", "checkedAt": datetime.now(timezone.utc).isoformat(),
              "baseUrl": args.base_url, "sourceId": source_id, "personId": person_id,
              "eventId": first_id, "checks": checks}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
