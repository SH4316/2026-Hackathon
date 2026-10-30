"""Small standard-library client shared by the local demo and smoke scripts."""

import json
import urllib.error
import urllib.parse
import urllib.request


class Api:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/") + "/api/v1"

    def request(self, method, path, payload=None, query=None):
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(
            url,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method=method,
        )
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            content = response.read().decode()
            return response.status, json.loads(content) if content else None

    def expect(self, method, path, status, payload=None, query=None):
        actual, body = self.request(method, path, payload, query)
        expected = (status,) if isinstance(status, int) else status
        if actual not in expected:
            raise AssertionError(f"{method} {path}: expected {expected}, got {actual}: {body}")
        return body
