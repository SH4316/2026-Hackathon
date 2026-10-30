#!/usr/bin/env python3
"""Check that the executable JAR serves SPA entry points, assets and genuine API/404s."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import urllib.error
import urllib.request
import zipfile


def fetch(base, path):
    try:
        response = urllib.request.urlopen(base + path, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers.get("Content-Type", ""), response.read()


def main():
    parser = argparse.ArgumentParser(description="실행 JAR의 SPA/정적 파일/API 경계를 확인합니다.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8081")
    parser.add_argument("--jar", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    routes = ["/", "/events", "/events/1", "/people", "/people/demo-person", "/settings/metrics",
              "/settings/jev", "/settings/monitoring", "/saved-searches", "/saved-searches/demo-snapshot"]
    html = None
    for route in routes:
        status, content_type, body = fetch(base, route)
        assert status == 200 and "text/html" in content_type and b'id="root"' in body, f"SPA route failed: {route}"
        html = body.decode()
    assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html)
    assert any(asset.endswith(".js") for asset in assets), "frontend JavaScript asset missing"
    assert any(asset.endswith(".css") for asset in assets), "frontend CSS asset missing"
    for asset in assets:
        status, content_type, body = fetch(base, asset)
        assert status == 200 and body and "text/html" not in content_type, f"asset failed: {asset}"
    for path in ["/assets/does-not-exist.js", "/api/v1/does-not-exist", "/arbitrary-path", "/swagger-ui/missing.js"]:
        status, _, body = fetch(base, path)
        assert status == 404 and b'id="root"' not in body, f"missing resource received SPA fallback: {path}"
    status, content_type, body = fetch(base, "/api/v1/health")
    assert status == 200 and "application/json" in content_type and json.loads(body) == {"status": "UP"}
    for path in ["/swagger-ui.html", "/swagger-ui/index.html"]:
        status, content_type, body = fetch(base, path)
        assert status == 200 and "text/html" in content_type and b"swagger-ui" in body
        assert b'id="root"' not in body, "Swagger received SPA HTML"
    status, content_type, body = fetch(base, "/v3/api-docs")
    assert status == 200 and "json" in content_type
    specification = json.loads(body)
    assert specification["servers"][0]["url"] == "/"
    for path in ["/api/v1/config-versions", "/api/v1/classifier-config", "/api/v1/events",
                 "/api/v1/config-versions/{id}/tags/{tagId}",
                 "/api/v1/config-versions/{versionId}/jev-prompts",
                 "/api/v1/config-versions/{versionId}/jev-prompts/{promptId}",
                 "/api/v1/metrics", "/api/v1/people", "/api/v1/saved-searches"]:
        assert path in specification["paths"], f"OpenAPI route absent: {path}"
    jar_hash = None
    if args.jar:
        with zipfile.ZipFile(args.jar) as archive:
            assert "BOOT-INF/classes/static/index.html" in archive.namelist()
            assert not any("afterMigrate__demo.sql" in name for name in archive.namelist()), "development seed leaked into JAR"
            for asset in assets:
                assert "BOOT-INF/classes/static" + asset in archive.namelist(), f"asset missing from JAR: {asset}"
        jar_hash = hashlib.sha256(args.jar.read_bytes()).hexdigest()
    report = {"status": "PASS", "checkedAt": datetime.now(timezone.utc).isoformat(),
              "baseUrl": base, "spaRoutes": routes, "assets": assets,
              "missingResourcesReturn404": True, "apiReturnsJson": True,
              "swaggerUiServed": True, "openApiRelativeServer": True, "devSqlExcludedFromJar": True,
              "jarSha256": jar_hash}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
