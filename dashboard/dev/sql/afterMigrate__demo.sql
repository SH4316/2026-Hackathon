-- Development-only Flyway callback. NEVER add this directory to production locations.
-- Every person/prompt is synthetic and explicitly marked 데모. No real sensitive data.
-- Fixed config IDs + date-specific event IDs make this safe to repeat.
-- Existing versions, names, events, detections and the selected active pointer are never replaced.
SET NAMES utf8mb4;
SET @demo_previous_sql_notes=@@sql_notes;
SET sql_notes=0;
DROP TEMPORARY TABLE IF EXISTS _demo_new_versions;
CREATE TEMPORARY TABLE _demo_new_versions (id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY);
INSERT INTO _demo_new_versions(id)
SELECT 'demo-v1' WHERE NOT EXISTS(SELECT 1 FROM config_versions WHERE id='demo-v1')
UNION ALL SELECT 'demo-v2' WHERE NOT EXISTS(SELECT 1 FROM config_versions WHERE id='demo-v2');
START TRANSACTION;
INSERT INTO config_versions(id,name,status,revision,created_at,published_at)
SELECT id,IF(id='demo-v1','데모 · 기본 분류 v1','데모 · 재구성 분류 v2'),'PUBLISHED',1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6)
FROM _demo_new_versions;
DROP TEMPORARY TABLE IF EXISTS _demo_tags;
CREATE TEMPORARY TABLE _demo_tags(id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,name VARCHAR(80),description TEXT,examples JSON,guidance TEXT,color VARCHAR(7),parent_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin,sort_order INT);
INSERT INTO _demo_tags VALUES
('source','소스코드','데모 분류: 비공개 Repository, 핵심 알고리즘','["비공개 Repository", "핵심 알고리즘"]','공개 코드와 내부 코드를 구분할 수 없음','#6684F1',NULL,0),
('source-1','비공개 Repository','실제 정보가 아닌 데모 예시','["가상 비공개 Repository 샘플"]','공개 코드와 내부 코드를 구분할 수 없음','#6684F1','source',0),
('source-2','핵심 알고리즘','실제 정보가 아닌 데모 예시','["가상 핵심 알고리즘 샘플"]','공개 코드와 내부 코드를 구분할 수 없음','#6684F1','source',1),
('design','기술 설계','데모 분류: CAD, 회로도, PCB 설계','["CAD", "회로도", "PCB 설계"]','파일 구조는 확인해도 기술적 기밀성을 판단할 수 없음','#3C9BB3',NULL,1),
('design-1','CAD','실제 정보가 아닌 데모 예시','["가상 CAD 샘플"]','파일 구조는 확인해도 기술적 기밀성을 판단할 수 없음','#3C9BB3','design',0),
('design-2','회로도','실제 정보가 아닌 데모 예시','["가상 회로도 샘플"]','파일 구조는 확인해도 기술적 기밀성을 판단할 수 없음','#3C9BB3','design',1),
('design-3','PCB 설계','실제 정보가 아닌 데모 예시','["가상 PCB 설계 샘플"]','파일 구조는 확인해도 기술적 기밀성을 판단할 수 없음','#3C9BB3','design',2),
('research','연구자료','데모 분류: 실험 결과, 연구노트','["실험 결과", "연구노트"]','일반 연구자료와 미공개 성과를 구분하기 어려움','#4B9F8A',NULL,2),
('research-1','실험 결과','실제 정보가 아닌 데모 예시','["가상 실험 결과 샘플"]','일반 연구자료와 미공개 성과를 구분하기 어려움','#4B9F8A','research',0),
('research-2','연구노트','실제 정보가 아닌 데모 예시','["가상 연구노트 샘플"]','일반 연구자료와 미공개 성과를 구분하기 어려움','#4B9F8A','research',1),
('ip','지식재산','데모 분류: 특허 출원 전 자료, 제조 비법','["특허 출원 전 자료", "제조 비법"]','출원·공개 상태와 기술 가치를 파악해야 함','#AD8649',NULL,3),
('ip-1','특허 출원 전 자료','실제 정보가 아닌 데모 예시','["가상 특허 출원 전 자료 샘플"]','출원·공개 상태와 기술 가치를 파악해야 함','#AD8649','ip',0),
('ip-2','제조 비법','실제 정보가 아닌 데모 예시','["가상 제조 비법 샘플"]','출원·공개 상태와 기술 가치를 파악해야 함','#AD8649','ip',1),
('ai','AI 자산','데모 분류: 모델 가중치, 학습 데이터셋','["모델 가중치", "학습 데이터셋"]','파일 형식만으로 비공개 여부를 알 수 없음','#8D74BD',NULL,4),
('ai-1','모델 가중치','실제 정보가 아닌 데모 예시','["가상 모델 가중치 샘플"]','파일 형식만으로 비공개 여부를 알 수 없음','#8D74BD','ai',0),
('ai-2','학습 데이터셋','실제 정보가 아닌 데모 예시','["가상 학습 데이터셋 샘플"]','파일 형식만으로 비공개 여부를 알 수 없음','#8D74BD','ai',1),
('security','보안정보','데모 분류: 취약점 분석, 공격 경로','["취약점 분석", "공격 경로"]','CVE 번호 유무와 실제 보안 위험은 별개','#C17079',NULL,5),
('security-1','취약점 분석','실제 정보가 아닌 데모 예시','["가상 취약점 분석 샘플"]','CVE 번호 유무와 실제 보안 위험은 별개','#C17079','security',0),
('security-2','공격 경로','실제 정보가 아닌 데모 예시','["가상 공격 경로 샘플"]','CVE 번호 유무와 실제 보안 위험은 별개','#C17079','security',1),
('strategy','경영전략','데모 분류: M&A, 투자·사업전략','["M&A", "투자·사업전략"]','문서의 의미와 공개 상태를 판단해야 함','#6C8BB4',NULL,6),
('strategy-1','M&A','실제 정보가 아닌 데모 예시','["가상 M&A 샘플"]','문서의 의미와 공개 상태를 판단해야 함','#6C8BB4','strategy',0),
('strategy-2','투자·사업전략','실제 정보가 아닌 데모 예시','["가상 투자·사업전략 샘플"]','문서의 의미와 공개 상태를 판단해야 함','#6C8BB4','strategy',1),
('finance','재무정보','데모 분류: 미공개 실적, 원가','["미공개 실적", "원가"]','숫자만으로 기밀 여부를 판단할 수 없음','#BD9854',NULL,7),
('finance-1','미공개 실적','실제 정보가 아닌 데모 예시','["가상 미공개 실적 샘플"]','숫자만으로 기밀 여부를 판단할 수 없음','#BD9854','finance',0),
('finance-2','원가','실제 정보가 아닌 데모 예시','["가상 원가 샘플"]','숫자만으로 기밀 여부를 판단할 수 없음','#BD9854','finance',1),
('sales','영업정보','데모 분류: 고객명단, 거래단가, 영업전략','["고객명단", "거래단가", "영업전략"]','업무 맥락과 데이터 소유권이 중요','#57A7A0',NULL,8),
('sales-1','고객명단','실제 정보가 아닌 데모 예시','["가상 고객명단 샘플"]','업무 맥락과 데이터 소유권이 중요','#57A7A0','sales',0),
('sales-2','거래단가','실제 정보가 아닌 데모 예시','["가상 거래단가 샘플"]','업무 맥락과 데이터 소유권이 중요','#57A7A0','sales',1),
('sales-3','영업전략','실제 정보가 아닌 데모 예시','["가상 영업전략 샘플"]','업무 맥락과 데이터 소유권이 중요','#57A7A0','sales',2),
('legal','법무정보','데모 분류: 소송전략, 계약 협상','["소송전략", "계약 협상"]','계약 또는 법률상 비밀 여부를 판단해야 함','#9C87B9',NULL,9),
('legal-1','소송전략','실제 정보가 아닌 데모 예시','["가상 소송전략 샘플"]','계약 또는 법률상 비밀 여부를 판단해야 함','#9C87B9','legal',0),
('legal-2','계약 협상','실제 정보가 아닌 데모 예시','["가상 계약 협상 샘플"]','계약 또는 법률상 비밀 여부를 판단해야 함','#9C87B9','legal',1),
('hr','인사정보','데모 분류: 인사평가, 채용 심사','["인사평가", "채용 심사"]','이름·급여 형식만으로 민감성을 확정하기 어려움','#B7789F',NULL,10),
('hr-1','인사평가','실제 정보가 아닌 데모 예시','["가상 인사평가 샘플"]','이름·급여 형식만으로 민감성을 확정하기 어려움','#B7789F','hr',0),
('hr-2','채용 심사','실제 정보가 아닌 데모 예시','["가상 채용 심사 샘플"]','이름·급여 형식만으로 민감성을 확정하기 어려움','#B7789F','hr',1),
('operations','내부 운영정보','데모 분류: 회의록, 운영 매뉴얼','["회의록", "운영 매뉴얼"]','공개 가능한 자료와 내부자료의 구분이 필요','#7A99A2',NULL,11),
('operations-1','회의록','실제 정보가 아닌 데모 예시','["가상 회의록 샘플"]','공개 가능한 자료와 내부자료의 구분이 필요','#7A99A2','operations',0),
('operations-2','운영 매뉴얼','실제 정보가 아닌 데모 예시','["가상 운영 매뉴얼 샘플"]','공개 가능한 자료와 내부자료의 구분이 필요','#7A99A2','operations',1),
('protected','국가·산업 보호기술','데모 분류: 국가핵심기술, 전략기술','["국가핵심기술", "전략기술"]','법령상 지정·통제 범위와 실제 기술 내용을 비교해야 함','#B78B6B',NULL,12),
('protected-1','국가핵심기술','실제 정보가 아닌 데모 예시','["가상 국가핵심기술 샘플"]','법령상 지정·통제 범위와 실제 기술 내용을 비교해야 함','#B78B6B','protected',0),
('protected-2','전략기술','실제 정보가 아닌 데모 예시','["가상 전략기술 샘플"]','법령상 지정·통제 범위와 실제 기술 내용을 비교해야 함','#B78B6B','protected',1),
('entrusted','고객 위탁자료','데모 분류: 외부 고객의 기밀 데이터','["외부 고객의 기밀 데이터"]','계약과 데이터 출처를 파악해야 함','#729A6F',NULL,13),
('entrusted-1','외부 고객의 기밀 데이터','실제 정보가 아닌 데모 예시','["가상 외부 고객의 기밀 데이터 샘플"]','계약과 데이터 출처를 파악해야 함','#729A6F','entrusted',0),
('pii','개인정보','데모 분류: 이름, 전화번호, 이메일','["이름", "전화번호", "이메일"]','가상의 예시입니다. 식별 가능성과 처리 목적을 함께 확인하세요.','#D27669',NULL,14),
('pii-1','이름','실제 정보가 아닌 데모 예시','["김하늘"]','가상의 예시입니다. 식별 가능성과 처리 목적을 함께 확인하세요.','#D27669','pii',0),
('pii-2','전화번호','실제 정보가 아닌 데모 예시','["010-0000-0000"]','가상의 예시입니다. 식별 가능성과 처리 목적을 함께 확인하세요.','#D27669','pii',1),
('pii-3','이메일','실제 정보가 아닌 데모 예시','["demo.person@example.invalid"]','가상의 예시입니다. 식별 가능성과 처리 목적을 함께 확인하세요.','#D27669','pii',2);
INSERT INTO config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)
SELECT v.id,t.id,t.name,t.description,t.examples,t.guidance,t.color,
 CASE WHEN v.id='demo-v2' AND t.parent_id IS NULL AND t.id IN ('source','design','research','ip','ai','security','protected') THEN 'technology'
      WHEN v.id='demo-v2' AND t.parent_id IS NULL AND t.id<>'pii' THEN 'business'
      ELSE t.parent_id END,t.sort_order
FROM _demo_new_versions v CROSS JOIN _demo_tags t;
INSERT INTO config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)
SELECT id,'technology','기술정보','데모 v2의 사용자 정의 묶음',JSON_ARRAY('기술 관련 분류'),'부모 태그도 직접 감지할 수 있습니다.','#6684F1',NULL,0 FROM _demo_new_versions WHERE id='demo-v2'
;
INSERT INTO config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)
SELECT id,'business','업무정보','데모 v2의 사용자 정의 묶음',JSON_ARRAY('업무 관련 분류'),'태그 ID는 버전 사이에서도 유지됩니다.','#57A7A0',NULL,1 FROM _demo_new_versions WHERE id='demo-v2';
INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)
WITH RECURSIVE hierarchy AS (
 SELECT t.version_id,t.id ancestor_id,t.id descendant_id FROM config_version_tags t JOIN _demo_new_versions v ON v.id=t.version_id
 UNION ALL SELECT h.version_id,h.ancestor_id,t.id FROM hierarchy h JOIN config_version_tags t ON t.version_id=h.version_id AND t.parent_id=h.descendant_id
) SELECT version_id,ancestor_id,descendant_id FROM hierarchy;
INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)
SELECT v.id,p.id,p.name,p.description,p.color,p.sort_order FROM _demo_new_versions v CROSS JOIN (
 SELECT 'training-disabled' id,'학습 미사용' name,'데모: 학습에 사용하지 않는 것으로 확인한 상태' description,'#4B9F8A' color,0 sort_order
 UNION ALL SELECT 'training-allowed','학습 사용','데모: 학습 사용이 허용된 상태','#C17079',1
 UNION ALL SELECT 'unconfirmed','확인 필요','데모: 별도 확인이 필요한 상태','#BD9854',2
) p;
UPDATE active_config SET version_id='demo-v1' WHERE singleton_id=1 AND version_id IS NULL;
INSERT IGNORE INTO people(id,name)
SELECT p.id,p.name FROM (
 SELECT 'demo-person-01' id,'데모 · 김지민' name UNION ALL SELECT 'demo-person-02','데모 · 이서준'
 UNION ALL SELECT 'demo-person-03','데모 · 박하은' UNION ALL SELECT 'demo-person-04','데모 · 최도윤'
 UNION ALL SELECT 'demo-person-05','데모 · 정시우' UNION ALL SELECT 'demo-person-06','데모 · 윤서아'
) p WHERE NOT EXISTS(SELECT 1 FROM people existing WHERE existing.id=p.id);
DROP TEMPORARY TABLE IF EXISTS _demo_samples;
CREATE TEMPORARY TABLE _demo_samples(sample_no INT PRIMARY KEY,tag_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin,parent_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin,text_value VARCHAR(1000));
INSERT INTO _demo_samples VALUES
(0,'source-1','source','가상 비공개 Repository 샘플'),
(1,'source-2','source','가상 핵심 알고리즘 샘플'),
(2,'design-1','design','가상 CAD 샘플'),
(3,'design-2','design','가상 회로도 샘플'),
(4,'design-3','design','가상 PCB 설계 샘플'),
(5,'research-1','research','가상 실험 결과 샘플'),
(6,'research-2','research','가상 연구노트 샘플'),
(7,'ip-1','ip','가상 특허 출원 전 자료 샘플'),
(8,'ip-2','ip','가상 제조 비법 샘플'),
(9,'ai-1','ai','가상 모델 가중치 샘플'),
(10,'ai-2','ai','가상 학습 데이터셋 샘플'),
(11,'security-1','security','가상 취약점 분석 샘플'),
(12,'security-2','security','가상 공격 경로 샘플'),
(13,'strategy-1','strategy','가상 M&A 샘플'),
(14,'strategy-2','strategy','가상 투자·사업전략 샘플'),
(15,'finance-1','finance','가상 미공개 실적 샘플'),
(16,'finance-2','finance','가상 원가 샘플'),
(17,'sales-1','sales','가상 고객명단 샘플'),
(18,'sales-2','sales','가상 거래단가 샘플'),
(19,'sales-3','sales','가상 영업전략 샘플'),
(20,'legal-1','legal','가상 소송전략 샘플'),
(21,'legal-2','legal','가상 계약 협상 샘플'),
(22,'hr-1','hr','가상 인사평가 샘플'),
(23,'hr-2','hr','가상 채용 심사 샘플'),
(24,'operations-1','operations','가상 회의록 샘플'),
(25,'operations-2','operations','가상 운영 매뉴얼 샘플'),
(26,'protected-1','protected','가상 국가핵심기술 샘플'),
(27,'protected-2','protected','가상 전략기술 샘플'),
(28,'entrusted-1','entrusted','가상 외부 고객의 기밀 데이터 샘플'),
(29,'pii-1','pii','김하늘'),
(30,'pii-2','pii','010-0000-0000'),
(31,'pii-3','pii','demo.person@example.invalid');
DROP TEMPORARY TABLE IF EXISTS _demo_events;
CREATE TEMPORARY TABLE _demo_events AS
WITH RECURSIVE days AS (SELECT 1 age UNION ALL SELECT age+1 FROM days WHERE age<30),
 numbers AS (SELECT 0 n UNION ALL SELECT n+1 FROM numbers WHERE n<9),
 dates AS (SELECT DATE(UTC_TIMESTAMP()+INTERVAL 9 HOUR)-INTERVAL age DAY local_date FROM days),
 samples AS (SELECT d.local_date,n.n,TO_DAYS(d.local_date)*10+n.n serial FROM dates d CROSS JOIN numbers n WHERE n.n<4+MOD(TO_DAYS(d.local_date)*3,7))
SELECT CONCAT('demo-',DATE_FORMAT(s.local_date,'%Y%m%d'),'-',LPAD(s.n,2,'0')) event_key,
 CONCAT('demo-person-',LPAD(1+MOD(s.serial,6),2,'0')) person_key,
 IF(MOD(s.serial,3)=0,'demo-v2','demo-v1') config_id,
 CONCAT('데모 전용 가상 자료 · ',x.text_value,' 검토 요청. 가명 김하늘에게 전달하고 김하늘의 확인을 받으세요. 모든 값은 합성 예시입니다.') prompt_value,
 TIMESTAMP(s.local_date,MAKETIME(7+MOD(s.serial*5,16),MOD(s.serial*13,60),0))-INTERVAL 9 HOUR occurred,
 ELT(1+MOD(s.serial,4),'chatgpt','claude','gemini','internal-ai') service_value,
 ELT(1+MOD(s.serial,4),'demo-gpt','demo-sonnet','demo-flash','demo-local') model_value,
 ELT(1+MOD(s.serial,4),'training-disabled','training-allowed','unconfirmed',NULL) policy_id,
 MOD(s.serial,6)<>0 has_detection,MOD(s.serial,4)=0 repeated_name,x.tag_id,x.parent_id,x.text_value
FROM samples s JOIN _demo_samples x ON x.sample_no=MOD(s.serial,32);
INSERT IGNORE INTO security_events(source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)
SELECT 'demo-sql-v2',s.event_key,s.person_key,s.config_id,s.prompt_value,s.occurred,s.occurred,s.service_value,s.model_value,s.policy_id
FROM _demo_events s
WHERE NOT EXISTS(SELECT 1 FROM security_events existing WHERE existing.source_id='demo-sql-v2' AND existing.event_id=s.event_key)
 AND EXISTS(SELECT 1 FROM config_version_tags t WHERE t.version_id=s.config_id AND t.id=s.tag_id)
 AND EXISTS(SELECT 1 FROM config_version_tags t WHERE t.version_id=s.config_id AND t.id='pii-1')
 AND (s.policy_id IS NULL OR EXISTS(SELECT 1 FROM config_version_policies p WHERE p.version_id=s.config_id AND p.id=s.policy_id));
INSERT IGNORE INTO detections(event_id,start_offset,end_offset,text)
SELECT e.id,CHAR_LENGTH('데모 전용 가상 자료 · '),CHAR_LENGTH('데모 전용 가상 자료 · ')+CHAR_LENGTH(s.text_value),s.text_value
FROM _demo_events s JOIN security_events e ON e.source_id='demo-sql-v2' AND e.event_id=s.event_key
WHERE s.has_detection AND e.prompt=s.prompt_value
 AND NOT EXISTS(SELECT 1 FROM detections existing WHERE existing.event_id=e.id AND existing.start_offset=CHAR_LENGTH('데모 전용 가상 자료 · '));
INSERT IGNORE INTO detection_tags(detection_id,version_id,tag_id,captured_name,captured_color)
SELECT d.id,e.version_id,t.id,t.name,t.color FROM _demo_events s JOIN security_events e ON e.source_id='demo-sql-v2' AND e.event_id=s.event_key
 JOIN detections d ON d.event_id=e.id AND d.start_offset=CHAR_LENGTH('데모 전용 가상 자료 · ')
 JOIN config_version_tags t ON t.version_id=e.version_id AND t.id=s.tag_id
WHERE s.has_detection AND NOT EXISTS(SELECT 1 FROM detection_tags existing WHERE existing.detection_id=d.id AND existing.tag_id=s.tag_id);
INSERT IGNORE INTO detection_tags(detection_id,version_id,tag_id,captured_name,captured_color)
SELECT d.id,e.version_id,t.id,t.name,t.color FROM _demo_events s JOIN security_events e ON e.source_id='demo-sql-v2' AND e.event_id=s.event_key
 JOIN detections d ON d.event_id=e.id AND d.start_offset=CHAR_LENGTH('데모 전용 가상 자료 · ')
 JOIN config_version_tags t ON t.version_id=e.version_id AND t.id=s.parent_id
WHERE s.has_detection AND NOT EXISTS(SELECT 1 FROM detection_tags existing WHERE existing.detection_id=d.id AND existing.tag_id=s.parent_id);
-- Two equal pieces of text at different ranges remain two detections. Each range has two tags.
INSERT IGNORE INTO detections(event_id,start_offset,end_offset,text)
SELECT e.id,LOCATE('가명 김하늘',e.prompt)+CHAR_LENGTH('가명 ')-1,LOCATE('가명 김하늘',e.prompt)+CHAR_LENGTH('가명 ')+CHAR_LENGTH('김하늘')-1,'김하늘'
FROM _demo_events s JOIN security_events e ON e.source_id='demo-sql-v2' AND e.event_id=s.event_key WHERE s.has_detection AND s.repeated_name
 AND NOT EXISTS(SELECT 1 FROM detections existing WHERE existing.event_id=e.id AND existing.start_offset=LOCATE('가명 김하늘',e.prompt)+CHAR_LENGTH('가명 ')-1);
INSERT IGNORE INTO detections(event_id,start_offset,end_offset,text)
SELECT e.id,LOCATE('김하늘의 확인',e.prompt)-1,LOCATE('김하늘의 확인',e.prompt)+CHAR_LENGTH('김하늘')-1,'김하늘'
FROM _demo_events s JOIN security_events e ON e.source_id='demo-sql-v2' AND e.event_id=s.event_key WHERE s.has_detection AND s.repeated_name
 AND NOT EXISTS(SELECT 1 FROM detections existing WHERE existing.event_id=e.id AND existing.start_offset=LOCATE('김하늘의 확인',e.prompt)-1);
INSERT IGNORE INTO detection_tags(detection_id,version_id,tag_id,captured_name,captured_color)
SELECT d.id,e.version_id,t.id,t.name,t.color FROM _demo_events s JOIN security_events e ON e.source_id='demo-sql-v2' AND e.event_id=s.event_key
 JOIN detections d ON d.event_id=e.id AND d.text='김하늘'
 JOIN config_version_tags t ON t.version_id=e.version_id AND t.id IN ('pii','pii-1')
WHERE s.has_detection AND s.repeated_name
 AND NOT EXISTS(SELECT 1 FROM detection_tags existing WHERE existing.detection_id=d.id AND existing.tag_id=t.id);
COMMIT;
DROP TEMPORARY TABLE _demo_events;
DROP TEMPORARY TABLE _demo_samples;
DROP TEMPORARY TABLE _demo_tags;
DROP TEMPORARY TABLE _demo_new_versions;
SET sql_notes=@demo_previous_sql_notes;
