"""제공사 요청의 텍스트 위치를 보존하고 요청 전체의 치환을 되돌려 적용한다."""

from __future__ import annotations

from bisect import bisect_left
from collections import deque
from dataclasses import dataclass
from difflib import SequenceMatcher


class InvalidContent(ValueError):
    pass


@dataclass
class Fragment:
    parent: dict | list
    key: str | int
    text: str


class TextRequest:
    def __init__(self, body: dict, path: str) -> None:
        self.fragments: list[Fragment] = []
        if path == "/v1/responses":
            self._optional_text(body, "instructions")
            if "input" not in body:
                raise InvalidContent()
            if isinstance(body["input"], str):
                self._text(body, "input")
            elif isinstance(body["input"], list):
                self._messages(body["input"], responses=True)
            else:
                raise InvalidContent()
        else:
            if path == "/v1/messages" and "system" in body:
                self._content(body, "system")
            if not isinstance(body.get("messages"), list):
                raise InvalidContent()
            self._messages(body["messages"])

    def _text(self, parent: dict | list, key: str | int) -> None:
        text = parent[key]
        if not isinstance(text, str):
            raise InvalidContent()
        self.fragments.append(Fragment(parent, key, text))

    def _optional_text(self, parent: dict, key: str) -> None:
        if key in parent and parent[key] is not None:
            self._text(parent, key)

    def _strings(self, value: dict | list) -> None:
        # 도구 입력은 JSON 구조를 유지하면서 문자열 값만 검사한다.
        for key in (range(len(value)) if isinstance(value, list) else value):
            if isinstance(value[key], str):
                self._text(value, key)
            elif isinstance(value[key], (dict, list)):
                self._strings(value[key])

    def _content(self, parent: dict, key: str) -> None:
        content = parent[key]
        if isinstance(content, str):
            self._text(parent, key)
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    raise InvalidContent()
                kind = part.get("type")
                if kind in ("text", "input_text", "output_text"):
                    self._text(part, "text")
                elif kind == "refusal":
                    self._text(part, "refusal")
                elif kind == "tool_result" and "content" in part:
                    self._content(part, "content")
                elif kind in ("tool_use", "server_tool_use"):
                    if not isinstance(part.get("input"), dict):
                        raise InvalidContent()
                    self._strings(part["input"])
                # 이미지·오디오·서명된 thinking 등 비텍스트 블록은 그대로 둔다.
        elif content is not None:
            raise InvalidContent()

    def _messages(self, messages: list, responses: bool = False) -> None:
        for message in messages:
            if not isinstance(message, dict):
                raise InvalidContent()
            if "content" in message:
                self._content(message, "content")
            self._optional_text(message, "refusal")
            if responses:
                self._optional_text(message, "arguments")
                if "output" in message:
                    self._content(message, "output")
                # custom_tool_call 의 input 은 일반 문자열이다.
                self._optional_text(message, "input")
            for call in message.get("tool_calls") or []:
                self._text(call["function"], "arguments")
            if message.get("function_call") is not None:
                self._text(message["function_call"], "arguments")

    @property
    def text(self) -> str:
        return "\n".join(fragment.parent[fragment.key] for fragment in self.fragments)

    @staticmethod
    def _located_edits(original: str, sanitized: str, findings: list, changes: list) -> list | None:
        # API 의 검출 구간과 토큰을 먼저 사용한다. 반복 문자열에서도 역할 경계를 보존한다.
        try:
            tokens: dict[str, deque[str]] = {}
            for change in changes:
                tokens.setdefault(change["type"], deque()).append(change["token"])
            assigned, edits = {}, []
            for finding in sorted(findings, key=lambda item: item["span"]["start"]):
                if finding["action"] not in ("mask", "warn"):
                    continue
                start, end = finding["span"]["start"], finding["span"]["end"]
                if (type(start) is not int or type(end) is not int
                        or not 0 <= start < end <= len(original) or (edits and start < edits[-1][1])):
                    return None
                key = (finding["type"], original[start:end])
                if key not in assigned:
                    assigned[key] = tokens[finding["type"]].popleft()
                edits.append((start, end, assigned[key]))
            parts, cursor = [], 0
            for start, end, token in edits:
                parts.extend((original[cursor:start], token))
                cursor = end
            parts.append(original[cursor:])
            expected = "".join(parts)
            return edits if expected == sanitized else None
        except (KeyError, TypeError, IndexError):
            return None

    def replace(self, sanitized: str, findings: list | tuple = (), changes: list | tuple = ()) -> None:
        original = self.text
        if not self.fragments:
            if sanitized:
                raise InvalidContent()
            return
        if len(self.fragments) == 1:
            fragment = self.fragments[0]
            fragment.parent[fragment.key] = sanitized
            return
        edits = self._located_edits(original, sanitized, findings, changes)
        if edits is None:
            # 구간 정보가 없는 호환 서버는 변한 부분만 비교한다. 큰 모호한 diff 는 차단한다.
            prefix = 0
            limit = min(len(original), len(sanitized))
            while prefix < limit and original[prefix] == sanitized[prefix]:
                prefix += 1
            suffix = 0
            while suffix < limit - prefix and original[-suffix - 1] == sanitized[-suffix - 1]:
                suffix += 1
            old_end, new_end = len(original) - suffix, len(sanitized) - suffix
            old_middle, new_middle = original[prefix:old_end], sanitized[prefix:new_end]
            if len(old_middle) * len(new_middle) > 16_000_000:
                raise InvalidContent()
            edits = [(prefix + start, prefix + end, new_middle[new_start:new_end])
                     for tag, start, end, new_start, new_end in SequenceMatcher(
                         None, old_middle, new_middle, autojunk=False).get_opcodes() if tag != "equal"]
        starts, ends = [], []
        offset = 0
        for fragment in self.fragments:
            starts.append(offset)
            offset += len(fragment.text)
            ends.append(offset)
            offset += 1  # 검사에만 쓰는 조각 사이 줄바꿈.
        pieces: list[list[str]] = [[] for _ in self.fragments]
        operations, cursor = [], 0
        for start, end, token in edits:
            operations.append(("equal", cursor, start, ""))
            operations.append(("replace", start, end, token))
            cursor = end
        operations.append(("equal", cursor, len(original), ""))
        for tag, start, end, token in operations:
            index = min(bisect_left(ends, start), len(ends) - 1)
            if tag == "equal":
                while index < len(ends) and starts[index] < end:
                    left, right = max(start, starts[index]), min(end, ends[index])
                    if left < right:
                        pieces[index].append(original[left:right])
                    index += 1
            elif tag in ("insert", "replace"):
                # 여러 조각에 걸친 치환은 첫 조각에 토큰을 넣고 나머지 원문을 지운다.
                pieces[index].append(token)
        for fragment, parts in zip(self.fragments, pieces):
            fragment.parent[fragment.key] = "".join(parts)
