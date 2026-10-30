#!/usr/bin/env python3
"""Explicit, idempotent demo seeding. Never runs automatically at startup."""

import argparse
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from api_client import Api


def main():
    parser = argparse.ArgumentParser(description="이름에 '데모'가 표시된 샘플 사용자와 이벤트를 등록합니다.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = parser.parse_args()
    api = Api(args.base_url)
    people = [
        ("demo-person-01", "데모 · 김지민"),
        ("demo-person-02", "데모 · 이서준"),
        ("demo-person-03", "데모 · 박하은"),
        ("demo-person-04", "데모 · 최도윤"),
    ]
    for person_id, name in people:
        api.expect("POST", "/people", (201, 409), {"id": person_id, "name": name})
    timezone = ZoneInfo("Asia/Seoul")
    today = datetime.now(timezone).date()
    policies = ["TRAINING_ALLOWED", "TRAINING_DISABLED", "UNKNOWN", None]
    categories = ["PERSONAL_DATA", "CREDENTIAL", "CONFIDENTIAL"]
    services = ["chatgpt", "claude", "gemini"]
    created = 0
    existing = 0
    # Completed Seoul calendar days keep every event timestamp stable across reruns.
    for age in range(6, 0, -1):
        date = today - timedelta(days=age)
        for index in range(8):
            choice = date.toordinal() * 8 + index
            policy = policies[choice % len(policies)]
            findings = [{"category": categories[choice % 3], "quantity": 1 + choice % 7}]
            if choice % 4 == 0:
                findings.append({"category": categories[(choice + 1) % 3], "quantity": 1 + choice % 3})
            event = {
                "sourceId": "demo-seed-v1",
                "eventId": f"demo-{date.isoformat()}-{index:02}",
                "personId": people[index % len(people)][0],
                "occurredAt": datetime.combine(date, time(9 + index, 10), timezone).isoformat(),
                "service": services[choice % len(services)],
                "model": ["gpt-4.1", "claude-sonnet", "gemini-flash"][choice % 3],
                "findings": findings,
            }
            if policy is not None:
                event["policyState"] = policy
            status, body = api.request("POST", "/events", event)
            if status not in (200, 201):
                raise AssertionError(f"Demo event registration failed ({status}): {body}")
            created += status == 201
            existing += status == 200
    print(f"데모 사용자 4명 확인, 이벤트 {created}개 등록 / {existing}개 기존 항목 확인")


if __name__ == "__main__":
    main()
