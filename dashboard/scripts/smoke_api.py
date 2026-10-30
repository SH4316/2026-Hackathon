#!/usr/bin/env python3
"""V2 HTTP integration checks. Use an isolated test database: this creates immutable records."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import uuid

from api_client import Api


def main():
    parser = argparse.ArgumentParser(description="분리된 테스트 DB에서 V2 API 계약을 검증합니다.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8083")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    api = Api(args.base_url)
    suffix = uuid.uuid4().hex[:12]
    person = "v2-smoke-" + suffix
    checks = []
    api.expect("GET", "/health", 200)
    initial = api.expect("GET", "/config-versions", 200)
    if not initial:
        error = api.expect("GET", "/classifier-config", 404)
        assert error["code"] == "NO_ACTIVE_VERSION"
        empty = api.expect("GET", "/metrics", 200)
        assert empty["versionId"] is None and empty["tags"] == []
        assert empty["summary"] == dict(eventCount=0, findingCount=0, personCount=0, detectedEventCount=0)
        api.expect("POST", "/saved-searches", 409, {"name":"버전 없는 저장", "filters":{}})
        checks.append("fresh normal database has no config, active version, tags or events; snapshots require published view")
    api.expect("POST", "/people", 201, {"id":person,"name":"데모 검증 · 가상 사용자"})
    api.expect("POST", "/people", 409, {"id":person,"name":"중복"})
    api.expect("POST", "/people", 201, {"id":person+"-zero","name":"데모 검증 · 이벤트 없는 사용자"})
    tags = [dict(id="group",name="사용자 기술",parentId=None,description="",examples=[],guidance="",color="#6684F1",order=0),
            dict(id="name",name="가상 이름",parentId="group",description="",examples=["김하늘"],guidance="가상 예시",color="#57A7A0",order=0),
            dict(id="email",name="가상 이메일",parentId="group",description="",examples=[],guidance="",color="#BD9854",order=1),
            dict(id="other",name="업무 분류",parentId=None,description="",examples=[],guidance="",color="#9C87B9",order=1)]
    policies = [dict(id="custom-policy",name="직접 정의한 상태",description="데모",color="#4B9F8A",order=0)]
    v1 = api.expect("POST", "/config-versions", 201, {"name":"데모 검증 v1 " + suffix})
    def update(version, newtags, newpolicies=policies):
        return api.expect("PUT", "/config-versions/"+version["id"], 200,
                          dict(revision=version["revision"],name=version["name"],tags=newtags,policyStates=newpolicies))
    oldrev=v1["revision"]
    v1=update(v1,tags)
    api.expect("PUT", "/config-versions/"+v1["id"],409,
               dict(revision=oldrev,name=v1["name"],tags=tags,policyStates=policies))
    v1=api.expect("POST","/config-versions/"+v1["id"]+"/publish",200,{"revision":v1["revision"]})
    api.expect("POST","/config-versions/"+v1["id"]+"/activate",200)
    assert api.expect("GET","/classifier-config",200)["id"]==v1["id"]
    api.expect("DELETE","/config-versions/"+v1["id"],409)
    api.expect("PUT","/config-versions/"+v1["id"],409,
               dict(revision=v1["revision"],name=v1["name"],tags=tags,policyStates=policies))
    checks.append("custom tag tree/policy catalog, revision conflicts, publish immutability and singleton activation")
    prompt="데모 😀 김하늘 demo.person@example.invalid 100%_literal"
    start=prompt.index("김하늘"); email=prompt.index("demo.person")
    instant=(datetime.now(timezone.utc)-timedelta(hours=2)).replace(microsecond=123456)
    base=dict(sourceId="v2-smoke-"+suffix,eventId="same",personId=person,versionId=v1["id"],prompt=prompt,
              occurredAt=instant.isoformat(),service="CHATGPT",model="demo-model",policyStateId="custom-policy",
              detections=[dict(start=start,end=start+3,text="김하늘",tagIds=["name"]),
                          dict(start=start,end=start+3,text="김하늘",tagIds=["group","name"]),
                          dict(start=email,end=email+len("demo.person@example.invalid"),text="demo.person@example.invalid",tagIds=["email"])])
    with ThreadPoolExecutor(max_workers=12) as executor:
        responses=list(executor.map(lambda _:api.request("POST","/events",base),range(12)))
    statuses=[status for status,_ in responses]
    assert statuses.count(201)==1 and statuses.count(200)==11, statuses
    ids={body["id"] for _,body in responses}; assert len(ids)==1
    event=responses[0][1]; assert event["findingCount"]==2 and len(event["detections"])==2
    assert event["occurredAt"].endswith("123456Z") and event["service"]=="chatgpt"
    assert {t["id"] for t in event["detections"][0]["tags"]}=={"name","group"}
    reordered={**base,"service":"chatgpt","detections":list(reversed(base["detections"]))}
    assert api.expect("POST","/events",200,reordered)["id"]==event["id"]
    api.expect("POST","/events",409,{**base,"prompt":prompt+" 변경"})
    zero=api.expect("POST","/events",201,{**base,"eventId":"zero","prompt":"데모 감지 없는 요청","detections":[],"policyStateId":None})
    assert zero["findingCount"]==0
    omitted={**base,"eventId":"omitted-defaults","prompt":"데모 기본값","detections":[]}
    for field in ["occurredAt","service","model","policyStateId"]:omitted.pop(field,None)
    defaulted=api.expect("POST","/events",201,omitted)
    assert defaulted["service"]=="unspecified" and defaulted["model"] is None
    assert api.expect("POST","/events",200,omitted)["id"]==defaulted["id"]
    checks.append("12 concurrent idempotent requests, code-point emoji spans, duplicate-range union, canonical replay, microseconds and omitted defaults")
    filters={"personId":person,"versionId":v1["id"],"from":(instant-timedelta(minutes=1)).isoformat(),"to":(instant+timedelta(minutes=1)).isoformat()}
    metrics=api.expect("GET","/metrics",200,query=filters)
    assert metrics["summary"]==dict(eventCount=2,findingCount=2,personCount=1,detectedEventCount=1),metrics
    group=next(t for t in metrics["tags"] if t["id"]=="group")
    assert group["count"]==2 and group["eventCount"]==1
    assert api.expect("GET","/metrics",200,query={**filters,"tagId":"name"})["summary"]["findingCount"]==1
    assert api.expect("GET","/metrics",200,query={**filters,"hasDetections":"false"})["summary"]["eventCount"]==1
    assert api.expect("GET","/events",200,query={**filters,"q":"100%_literal"})["totalElements"]==1
    assert api.expect("GET","/events",200,query={**filters,"to":instant.isoformat()})["totalElements"]==0
    people=api.expect("GET","/people",200,query={**filters,"personQuery":person,"q":"100%_literal"})
    assert people["totalElements"]==1 and people["items"][0]["eventCount"]==1
    korean_people=api.expect("GET","/people",200,query={**filters,"personQuery":"가상 사용자"})
    assert korean_people["totalElements"]==1 and korean_people["items"][0]["id"]==person
    zero_registry=api.expect("GET","/people",200,query={**filters,"personId":person+"-zero","personQuery":person+"-zero","q":"100%_literal","service":"chatgpt"})
    assert zero_registry["totalElements"]==1 and zero_registry["items"][0]["eventCount"]==0
    assert zero_registry["items"][0]["findingCount"]==0 and zero_registry["items"][0]["lastEventAt"] is None
    hourly=api.expect("GET","/metrics",200,query={**filters,"interval":"hour"})
    assert hourly["series"] and all("T" in p["bucket"] for p in hourly["series"])
    snapshot=api.expect("POST","/saved-searches",201,{"name":"데모 고정 검색 "+suffix,"filters":filters})
    assert snapshot["eventCount"]==2 and snapshot["findingCount"]==2
    relative=api.expect("POST","/saved-searches",201,{"name":"데모 기본 기간 고정 "+suffix,"filters":{"personId":person}})
    assert relative["versionId"]==v1["id"] and relative["filters"]["from"] and relative["filters"]["to"]
    snapshot_before=api.expect("GET","/saved-searches/"+snapshot["id"]+"/metrics",200)
    assert api.expect("GET","/saved-searches/"+snapshot["id"]+"/events",200,query={"size":1})["totalElements"]==2
    checks.append("distinct span/tree counts, literal prompt search vs personQuery, registered zero-event people retained, zero detections, exclusive end, hour buckets and whole-result snapshot")
    v2=api.expect("POST","/config-versions",201,{"name":"데모 검증 v2 "+suffix,"baseVersionId":v1["id"]})
    changed=[{**t,"name":"새 버전 이름","parentId":"other"} if t["id"]=="name" else t for t in tags if t["id"]!="email"]
    v2=update(v2,changed,[])
    v2=api.expect("POST","/config-versions/"+v2["id"]+"/publish",200,{"revision":v2["revision"]})
    api.expect("POST","/config-versions/"+v2["id"]+"/activate",200)
    projected=api.expect("GET","/metrics",200,query={**filters,"versionId":v2["id"]})
    assert projected["summary"]==metrics["summary"],projected
    assert projected["unmapped"]==dict(count=1,eventCount=1)
    assert next(t for t in projected["tags"] if t["id"]=="other")["count"]==1
    assert projected["policies"][0]["mapped"] is False and projected["policies"][0]["name"]=="직접 정의한 상태"
    assert api.expect("GET","/events",200,query={**filters,"versionId":v2["id"]})["totalElements"]==2
    original=api.expect("GET","/events/"+str(event["id"]),200)
    assert any(t["name"]=="가상 이름" for d in original["detections"] for t in d["tags"])
    api.expect("POST","/events",200,base)
    api.expect("POST","/events",409,{**base,"eventId":"stale-version"})
    api.expect("POST","/events",201,{**base,"versionId":v2["id"],"policyStateId":None,"eventId":"new-after-snapshot","detections":[]})
    assert api.expect("GET","/saved-searches/"+snapshot["id"]+"/metrics",200)==snapshot_before
    assert api.expect("GET","/saved-searches/"+snapshot["id"]+"/events",200)["totalElements"]==2
    saved=api.expect("GET","/saved-searches/"+snapshot["id"],200)
    assert saved["versionId"]==v1["id"] and saved["filters"]["from"] and saved["filters"]["to"]
    assert sum(v["isActive"] for v in api.expect("GET","/config-versions",200))==1
    checks.append("published version projects all historical events, moved IDs/unmapped tags and policies, captured labels, stale rejection and immutable snapshot after ingestion/activation")
    invalid={**base,"versionId":v2["id"],"policyStateId":None,"eventId":"bad-span","detections":[dict(start=0,end=1,text="SECRET-PROMPT",tagIds=["name"])]}
    errors=[]
    api.expect("POST","/events",400,{**invalid,"eventId":"prompt-code-point-limit","prompt":"x"*200001,"detections":[]})
    api.expect("POST","/events",413,{**invalid,"eventId":"body-byte-limit","prompt":"가"*180000,"detections":[]})
    api.expect("POST","/events",400,{**invalid,"eventId":"too-many-detections","detections":[dict(start=start,end=start+3,text="김하늘",tagIds=["name"])]*1001})
    for body,status in [(invalid,400),({**invalid,"eventId":"bad-tag","detections":[dict(start=start,end=start+3,text="김하늘",tagIds=["missing"])]},422),
                        ({**invalid,"eventId":"missing-person","personId":"missing","detections":[]},422)]:
        error=api.expect("POST","/events",status,body)
        assert isinstance(error.get("code"),str) and isinstance(error.get("message"),str)
        assert any("가" <= char <= "힣" for char in error["message"]), error
        assert "SECRET-PROMPT" not in json.dumps(error) and "stack" not in json.dumps(error).lower()
        errors.append(error["code"])
    api.expect("GET","/metrics",400,query={**filters,"tagId":"name","unmapped":"true"})
    api.expect("GET","/metrics",400,query={**filters,"interval":"hour","from":(instant-timedelta(days=32)).isoformat()})
    draft=api.expect("POST","/config-versions",201,{"name":"삭제할 초안"})
    cycle=[{**tags[0],"parentId":"name"},tags[1]]
    api.expect("PUT","/config-versions/"+draft["id"],400,dict(revision=draft["revision"],name=draft["name"],tags=cycle,policyStates=[]))
    api.expect("DELETE","/config-versions/"+draft["id"],204)
    api.expect("DELETE","/saved-searches/"+relative["id"],204)
    api.expect("DELETE","/saved-searches/"+snapshot["id"],204)
    api.expect("GET","/events/"+str(event["id"]),200)
    checks.append("Korean safe errors for invalid Unicode ranges/tags/person, code-point/body/detection limits, conflicting filters, hourly range limit, cyclic tree and non-destructive saved-search deletion")
    report=dict(status="PASS",checkedAt=datetime.now(timezone.utc).isoformat(),baseUrl=args.base_url,personId=person,
                versions=[v1["id"],v2["id"]],concurrentStatuses={str(x):statuses.count(x) for x in set(statuses)},errorCodes=errors,checks=checks)
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
