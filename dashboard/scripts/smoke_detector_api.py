#!/usr/bin/env python3
"""Exercise detector HTTP ingestion against an explicitly selected local test runtime.

This creates synthetic people, immutable events and a published configuration, and
switches the active configuration. Run the application against an isolated database.
"""

import argparse
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from api_client import Api


def local_base_url(value):
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise argparse.ArgumentTypeError("Use an explicit loopback HTTP origin, such as http://127.0.0.1:8083")
    return value.rstrip("/")


def fetch(base_url, path):
    if not path.startswith("/") or path.startswith("//"):
        raise AssertionError("The server must return a relative download path")
    try:
        response = urllib.request.urlopen(base_url + path, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def resolve_schema(specification, schema):
    while "$ref" in schema:
        reference = schema["$ref"]
        assert reference.startswith("#/"), f"Expected a local OpenAPI schema reference: {reference}"
        schema = specification
        for part in reference[2:].split("/"):
            schema = schema[part.replace("~1", "/").replace("~0", "~")]
    return schema


def verify_openapi(base_url):
    status, headers, content = fetch(base_url, "/v3/api-docs")
    assert status == 200 and "json" in headers.get("Content-Type", "")
    specification = json.loads(content)
    paths = specification["paths"]
    endpoint = "/api/v1/detector-events"
    assert "post" in paths[endpoint]
    assert "get" in paths[endpoint + "/{id}"]
    assert "get" in paths[endpoint + "/{id}/images/{imageId}"]
    request_schema = resolve_schema(
        specification,
        paths[endpoint]["post"]["requestBody"]["content"]["application/json"]["schema"],
    )
    result_schema = resolve_schema(specification, request_schema["properties"]["result"])
    required = {
        "request_id", "input_version", "status", "decision", "signal", "findings",
        "policy_version", "destination", "detector_versions",
    }
    assert required <= result_schema["properties"].keys(), "OpenAPI result must expose InspectResponse fields"
    assert required <= set(result_schema.get("required", [])), "OpenAPI must retain required producer fields"
    input_version = result_schema["properties"]["input_version"]
    assert "$ref" not in input_version, "input_version must expose its scalar union without a JsonNode object reference"
    alternatives = [resolve_schema(specification, item) for item in input_version["oneOf"]]
    assert {item.get("type") for item in alternatives} == {"integer", "string"}, alternatives
    finding = resolve_schema(specification, result_schema["properties"]["findings"]["items"])
    span = resolve_schema(specification, finding["properties"]["span"])
    assert {"start", "end", "start_utf16", "end_utf16"} <= span["properties"].keys()
    destination = resolve_schema(specification, result_schema["properties"]["destination"])
    assert "basis" in destination.get("required", []), "Nullable destination.basis is still required"
    assert set(destination["properties"]["basis"]["type"]) == {"string", "null"}
    assert "replacement" not in finding.get("required", [])
    assert set(finding["properties"]["replacement"]["type"]) == {"string", "null"}
    status, headers, content = fetch(base_url, "/swagger-ui/index.html")
    assert status == 200 and "html" in headers.get("Content-Type", "") and b"swagger-ui" in content
    return {"pathsPresent": True, "resultIsInspectResponse": True, "inputVersionTypes": ["integer", "string"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, type=local_base_url)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    print("Creating synthetic records and publishing/activating a new configuration in the selected test runtime.", file=sys.stderr)
    api = Api(args.base_url)
    api.expect("GET", "/health", 200)
    existing_versions = api.expect("GET", "/config-versions", 200)
    previous_active = next((item["id"] for item in existing_versions if item["isActive"]), None)
    suffix = uuid.uuid4().hex[:12]
    person_id = "detector-smoke-" + suffix
    api.expect("POST", "/people", 201, {"id": person_id, "name": "합성 탐지기 HTTP 검증"})
    version = api.expect("POST", "/config-versions", 201, {"name": "합성 탐지기 HTTP 검증 " + suffix})
    version = api.expect("PUT", "/config-versions/" + version["id"], 200, {
        "revision": version["revision"],
        "name": version["name"],
        "tags": [{"id": "email", "name": "합성 이메일", "color": "#123456"}],
        "policyStates": [{"id": "blocked", "name": "합성 차단", "color": "#A12345"}],
    })
    version = api.expect("POST", "/config-versions/" + version["id"] + "/publish", 200, {"revision": version["revision"]})
    api.expect("POST", "/config-versions/" + version["id"] + "/activate", 200)

    sample = Path(__file__).resolve().parents[1] / "examples" / "detector-event.json"
    payload = json.loads(sample.read_text(encoding="utf-8"))
    payload.update(source_id="detector-smoke-" + suffix, person_id=person_id, version_id=version["id"])
    payload["result"]["request_id"] = "HTTP / 한글😀 " + suffix
    payload["result"]["input_version"] = int("9" * 400)
    occurred = (datetime.now(timezone.utc) - timedelta(minutes=2)).replace(microsecond=123456)
    payload["occurred_at"] = occurred.isoformat()
    created = api.expect("POST", "/detector-events", 201, payload)
    event_id = created["id"]
    assert created["result"] == payload["result"], "Raw InspectResponse changed during storage"
    assert type(created["result"]["input_version"]) is int, "The integer input version must remain an integer"
    assert created["files"] == payload["files"]
    assert created["event"]["id"] == event_id
    assert created["event"]["eventId"] == created["event_id"]
    assert created["event"]["detections"][0]["text"] == "hong@example.com"
    assert created["event"]["detections"][0]["tags"][0]["id"] == "email"
    assert api.expect("POST", "/detector-events", 200, payload) == created
    assert api.expect("GET", "/detector-events/" + str(event_id), 200) == created
    assert api.expect("GET", "/events/" + str(event_id), 200) == created["event"]

    images = []
    assert len(created["images"]) == len(payload["images"])
    for original, metadata in zip(payload["images"], created["images"], strict=True):
        raw = base64.b64decode(original["data_base64"], validate=True)
        status, headers, downloaded = fetch(args.base_url, metadata["download_path"])
        assert status == 200 and headers.get_content_type() == "application/octet-stream"
        assert headers.get("Content-Disposition", "").startswith("attachment;")
        assert downloaded == raw, "Downloaded bytes differ from the original image"
        assert metadata["name"] == original["name"] and metadata["media_type"] == original["media_type"]
        assert metadata["size_bytes"] == len(raw)
        images.append({"id": metadata["id"], "sizeBytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})

    changed = deepcopy(payload)
    changed["result"]["policy_version"] += ".changed"
    assert api.expect("POST", "/detector-events", 409, changed)["code"] == "EVENT_CONFLICT"
    assert api.expect("GET", "/detector-events/" + str(event_id), 200) == created
    typed_payload = deepcopy(payload)
    typed_payload["result"]["input_version"] = str(payload["result"]["input_version"])
    typed_created = api.expect("POST", "/detector-events", 201, typed_payload)
    assert typed_created["event_id"] != created["event_id"]
    assert typed_created["result"] == typed_payload["result"]
    assert api.expect("POST", "/detector-events", 200, typed_payload) == typed_created

    filters = {
        "personId": person_id, "versionId": version["id"],
        "from": (occurred - timedelta(minutes=1)).isoformat(),
        "to": (occurred + timedelta(minutes=1)).isoformat(),
    }
    metrics = api.expect("GET", "/metrics", 200, query=filters)
    assert metrics["summary"] == {"eventCount": 2, "findingCount": 2, "personCount": 1, "detectedEventCount": 2}
    assert next(tag for tag in metrics["tags"] if tag["id"] == "email")["count"] == 2
    assert metrics["unmapped"]["count"] == 0
    documentation = verify_openapi(args.base_url)
    report = {
        "status": "PASS", "checkedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": args.base_url,
        "personId": person_id, "versionId": version["id"], "previousActiveVersionId": previous_active,
        "eventIds": [event_id, typed_created["id"]], "externalEventIds": [created["event_id"], typed_created["event_id"]],
        "statuses": {"created": 201, "replay": 200, "changed": 409, "detail": 200, "image": 200},
        "exactInspectResponsePreserved": True, "integerPrecisionPreserved": True,
        "typedInputVersionsHaveDistinctIdentity": True, "filesPreserved": True,
        "images": images, "metrics": metrics["summary"], "openApi": documentation,
    }
    formatted = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(formatted, encoding="utf-8")
    print(formatted, end="")


if __name__ == "__main__":
    main()
