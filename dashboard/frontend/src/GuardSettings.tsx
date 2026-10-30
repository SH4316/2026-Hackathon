import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { EnabledSetting as UsageSetting } from "./EnabledSetting";
import { formatDateTime } from "./format";
import { ModelWarning } from "./GuardBanner";
import {
  codePoints,
  guardApi,
  guardRequest,
  validateRule,
  type Enrollment,
  type GuardClient,
  type GuardJudgment,
  type GuardModules,
  type GuardOrg,
  type GuardResponse,
  type GuardRule,
  type GuardRuleset,
  type GuardRuntime,
  type GuardType,
  type ModelMode,
} from "./guard";
import { useResource } from "./hooks";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageTitle,
  Panel,
  Pagination,
  RefreshButton,
} from "./ui";

const tabs = [
  ["status", "상태"],
  ["rules", "사용자 규칙"],
  ["jev", "Jev 판단 기준"],
  ["org", "조직 설정"],
  ["clients", "사용자 연결"],
] as const;
const lines = (text: string) => text.split("\n").filter((line) => line.trim());
const freshType = (): GuardType => ({
  id: "",
  label: "",
  category: "custom",
  severity: "high",
  action: "mask",
  token: "CUSTOM",
  enabled: true,
});
const freshRule = (): GuardRule => ({
  ...freshType(),
  kind: "keywords",
  keywords: [],
  pattern: null,
  case_sensitive: false,
  reason: "",
  distribute: true,
});
const freshJudgment = (): GuardJudgment => ({
  ...freshType(),
  criteria: "",
  examples: [],
  counter_examples: [],
});

function EnabledSetting({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <UsageSetting
      label={label}
      description="저장하면 검사 서버에 적용됩니다."
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
function Field({
  title,
  children,
  help,
}: {
  title: string;
  children: ReactNode;
  help?: string;
}) {
  return (
    <label className="guard-field">
      <span>{title}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
function Submit({
  pending,
  children = "저장",
}: {
  pending: boolean;
  children?: ReactNode;
}) {
  return (
    <button className="button button-primary" disabled={pending}>
      {pending ? "처리 중…" : children}
    </button>
  );
}
function TestResult({ result }: { result: unknown }) {
  return result == null ? null : (
    <div role="status" className="guard-test-result">
      <h3>시험 결과</h3>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </div>
  );
}
export function GuardSettings() {
  const [params, setParams] = useSearchParams();
  const tab = tabs.some(([id]) => id === params.get("tab"))
    ? params.get("tab")!
    : "status";
  const resource = useResource(async (signal) => {
    const [runtime, rules] = await Promise.all([
      guardApi.runtime(signal),
      guardApi.ruleset(signal),
    ]);
    return { runtime: runtime.data, rules };
  }, []);
  const [rules, setRules] = useState<GuardResponse<GuardRuleset> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (resource.data) setRules(resource.data.rules);
  }, [resource.data]);
  async function run(
    action: () => Promise<void>,
    message = "설정을 저장했습니다.",
  ) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  async function update(path: string, body?: unknown, method = "PUT") {
    if (!rules) return;
    const response = await guardRequest<GuardRuleset>(path, {
      method,
      body,
      etag: rules.etag ?? `"${rules.data.version}"`,
    });
    setRules(response);
  }
  const content = resource.data && rules;
  const busy = pending || resource.loading;
  return (
    <>
      <PageTitle
        title="검사 서버 관리"
        description="검사 서버의 실행 상태와 조직 규칙, 사용자 연결을 관리하세요."
        action={<RefreshButton {...resource} loading={busy} />}
      />
      <div className="guard-tabs" role="tablist" aria-label="검사 서버 관리 탭">
        {tabs.map(([id, title]) => (
          <button
            id={`guard-tab-${id}`}
            key={id}
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = tabs.findIndex(([key]) => key === id);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              document.getElementById(`guard-tab-${tabs[next][0]}`)?.focus();
              setParams({ tab: tabs[next][0] });
              setError("");
              setNotice("");
            }}
            aria-controls="guard-tabpanel"
            disabled={busy}
            onClick={() => {
              setParams({ tab: id });
              setError("");
              setNotice("");
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : !content ? (
        <LoadingState />
      ) : (
        <>
          <ModelWarning runtime={resource.data!.runtime} />
          {error && (
            <p className="guard-feedback field-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="guard-feedback" role="status">
              {notice}
            </p>
          )}
          <div
            id="guard-tabpanel"
            role="tabpanel"
            aria-labelledby={`guard-tab-${tab}`}
            className="guard-settings"
            aria-busy={busy}
          >
            {tab === "status" && (
              <StatusTab
                key={`${resource.data!.runtime.model_mode}-${rules.data.version}`}
                runtime={{
                  ...resource.data!.runtime,
                  ruleset_version: rules.data.version,
                }}
                modules={rules.data.modules}
                pending={busy}
                run={run}
                update={update}
                refresh={resource.refresh}
              />
            )}
            {tab === "rules" && (
              <RulesTab
                key={resource.updatedAt?.getTime()}
                rules={rules.data.custom_rules}
                pending={busy}
                run={run}
                update={update}
              />
            )}
            {tab === "jev" && (
              <JudgmentsTab
                key={resource.updatedAt?.getTime()}
                rules={rules.data.context_detectors}
                template={rules.data.prompt_template}
                revision={rules.data.version}
                pending={busy}
                run={run}
                update={update}
              />
            )}
            {tab === "org" && <OrgTab pending={busy} run={run} />}
            {tab === "clients" && <ClientsTab pending={busy} run={run} />}
          </div>
        </>
      )}
    </>
  );
}
type Actions = {
  pending: boolean;
  run: (action: () => Promise<void>, message?: string) => Promise<void>;
};
type RuleActions = Actions & {
  update: (path: string, body?: unknown, method?: string) => Promise<void>;
};
function StatusTab({
  runtime,
  modules,
  pending,
  run,
  update,
  refresh,
}: RuleActions & {
  runtime: GuardRuntime;
  modules: GuardModules;
  refresh: () => void;
}) {
  const [mode, setMode] = useState<ModelMode>(runtime.model_mode);
  const [draft, setDraft] = useState(modules);
  const status = {
    active: "사용 중",
    disabled: "사용 안 함",
    endpoint_unset: "엔드포인트 미설정",
    unavailable: "연결 불가",
  }[runtime.model_status];
  return (
    <Panel
      title="실행 상태"
      description="저장한 설정이 환경변수의 초기값보다 우선합니다."
    >
      <dl className="guard-status">
        <div>
          <dt>모델 상태</dt>
          <dd>{status}</dd>
        </div>
        <div>
          <dt>모델 준비</dt>
          <dd>{runtime.model_ready ? "준비됨" : "준비되지 않음"}</dd>
        </div>
        <div>
          <dt>정책 버전</dt>
          <dd>{runtime.policy_version}</dd>
        </div>
        <div>
          <dt>룰셋 버전</dt>
          <dd>{runtime.ruleset_version}</dd>
        </div>
        <div>
          <dt>조직 연동</dt>
          <dd>
            {runtime.org.managed
              ? runtime.org.dashboard_error
                ? "연동 오류"
                : "연결됨"
              : "연결되지 않음"}
          </dd>
        </div>
        <div>
          <dt>조직 활성 버전</dt>
          <dd>
            {runtime.org.version_id ?? "없음"}
            {runtime.org.revision != null &&
              ` · 리비전 ${runtime.org.revision}`}
          </dd>
        </div>
      </dl>
      {runtime.org.dashboard_error && (
        <p role="alert">{runtime.org.dashboard_error}</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await guardRequest("runtime", {
              method: "PUT",
              body: { model_mode: mode },
            });
            refresh();
          });
        }}
      >
        <fieldset disabled={pending}>
          <Field title="모델 모드">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ModelMode)}
            >
              <option value="disabled">사용 안 함 (disabled)</option>
              <option value="optional">선택 사용 (optional)</option>
              <option value="required">필수 사용 (required)</option>
            </select>
          </Field>
          <Submit pending={pending}>모델 모드 저장</Submit>
        </fieldset>
      </form>
      <form
        className="guard-section"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await update("modules", draft);
            refresh();
          });
        }}
      >
        <fieldset disabled={pending}>
          <h3>검사 모듈</h3>
          <p className="muted">내장 규칙은 항상 사용합니다.</p>
          <EnabledSetting
            label="사용자 규칙 모듈"
            checked={draft.custom_rules}
            disabled={pending}
            onChange={(checked) =>
              setDraft({ ...draft, custom_rules: checked })
            }
          />
          <EnabledSetting
            label="Jev 판단 모듈"
            checked={draft.context_model}
            disabled={pending}
            onChange={(checked) =>
              setDraft({ ...draft, context_model: checked })
            }
          />
          <Submit pending={pending}>모듈 저장</Submit>
        </fieldset>
      </form>
      <div className="guard-section">
        <button
          className="button"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              await guardRequest("org/refresh", { method: "POST" });
              refresh();
            }, "조직 설정을 다시 불러왔습니다.")
          }
        >
          조직 연동 새로고침
        </button>
      </div>
    </Panel>
  );
}
function TypeFields<T extends GuardType>({
  draft,
  change,
  locked,
}: {
  draft: T;
  change: (draft: T) => void;
  locked: boolean;
}) {
  return (
    <>
      <div className="guard-form-grid">
        <Field title="이름">
          <input
            required
            maxLength={60}
            value={draft.label}
            onChange={(e) => change({ ...draft, label: e.target.value })}
          />
        </Field>
        <Field
          title="ID"
          help="영문 소문자로 시작하는 2~41자의 소문자·숫자·밑줄"
        >
          <input
            required
            pattern="[a-z][a-z0-9_]{1,40}"
            value={draft.id}
            disabled={locked}
            onChange={(e) => change({ ...draft, id: e.target.value })}
          />
        </Field>
        <Field title="분류">
          <input
            required
            pattern="[a-z][a-z0-9_]{1,40}"
            value={draft.category}
            onChange={(e) => change({ ...draft, category: e.target.value })}
          />
        </Field>
        <Field title="대체 토큰">
          <input
            required
            pattern="[A-Z][A-Z0-9_]{1,30}"
            value={draft.token}
            onChange={(e) => change({ ...draft, token: e.target.value })}
          />
        </Field>
        <Field title="심각도">
          <select
            value={draft.severity}
            onChange={(e) =>
              change({
                ...draft,
                severity: e.target.value as GuardType["severity"],
              })
            }
          >
            <option value="info">정보</option>
            <option value="low">낮음</option>
            <option value="medium">보통</option>
            <option value="high">높음</option>
            <option value="critical">매우 높음</option>
          </select>
        </Field>
        <Field title="조치">
          <ActionSelect
            value={draft.action}
            change={(action) => change({ ...draft, action })}
          />
        </Field>
      </div>
      <EnabledSetting
        label="검사에 사용"
        checked={draft.enabled}
        onChange={(enabled) => change({ ...draft, enabled })}
      />
    </>
  );
}
function ActionSelect({
  value,
  change,
}: {
  value: GuardType["action"];
  change: (action: GuardType["action"]) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => change(e.target.value as GuardType["action"])}
    >
      <option value="allow">허용</option>
      <option value="warn">경고</option>
      <option value="mask">마스킹</option>
      <option value="block">차단</option>
    </select>
  );
}
function RulesTab({
  rules,
  pending,
  run,
  update,
}: RuleActions & { rules: GuardRule[] }) {
  const [draft, setDraft] = useState<GuardRule>(rules[0] ?? freshRule());
  const [saved, setSaved] = useState(rules[0]?.id ?? "");
  const [keywords, setKeywords] = useState(draft.keywords.join("\n"));
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<unknown>(null);
  function select(rule?: GuardRule) {
    const next = rule ?? freshRule();
    setDraft(next);
    setSaved(rule?.id ?? "");
    setKeywords(next.keywords.join("\n"));
    setResult(null);
  }
  const body = {
    ...draft,
    keywords: draft.kind === "keywords" ? lines(keywords) : [],
    pattern: draft.kind === "regex" ? draft.pattern : null,
  };
  const error = validateRule(body);
  return (
    <div className="guard-editor-layout">
      <section className="guard-list">
        <h2>사용자 규칙</h2>
        <button className="button" disabled={pending} onClick={() => select()}>
          새 규칙
        </button>
        {!rules.length && <p className="muted">등록된 규칙이 없습니다.</p>}
        {rules.map((rule) => (
          <button
            className={saved === rule.id ? "selected" : ""}
            key={rule.id}
            disabled={pending}
            onClick={() => select(rule)}
          >
            <strong>{rule.label}</strong>
            <small>
              {rule.kind === "regex" ? "정규식" : "키워드"} ·{" "}
              {rule.enabled ? "사용 중" : "사용 안 함"} ·{" "}
              {rule.distribute ? "배포" : "서버 전용"}
            </small>
          </button>
        ))}
      </section>
      <Panel title={saved ? "규칙 편집" : "규칙 추가"}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!error)
              void run(async () => {
                await update(
                  `custom-rules/${encodeURIComponent(draft.id)}`,
                  body,
                );
                setSaved(draft.id);
              });
          }}
        >
          <fieldset disabled={pending}>
            <TypeFields
              draft={draft}
              change={(next) => {
                setDraft(next);
                setResult(null);
              }}
              locked={!!saved}
            />
            <Field title="규칙 종류">
              <select
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as GuardRule["kind"],
                  })
                }
              >
                <option value="keywords">키워드</option>
                <option value="regex">정규식</option>
              </select>
            </Field>
            {draft.kind === "keywords" ? (
              <Field
                title="키워드"
                help="한 줄에 하나씩 입력하세요. 최대 200개, 각 100자"
              >
                <textarea
                  required
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
              </Field>
            ) : (
              <Field
                title="정규식"
                help={`${codePoints(draft.pattern ?? "")} / 4,000자 · Python 정규식 문법`}
              >
                <textarea
                  required
                  aria-invalid={!!error}
                  className="code-value"
                  value={draft.pattern ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, pattern: e.target.value })
                  }
                />
              </Field>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <EnabledSetting
              label="대소문자 구분"
              checked={draft.case_sensitive}
              onChange={(case_sensitive) =>
                setDraft({ ...draft, case_sensitive })
              }
            />
            <EnabledSetting
              label="클라이언트에 배포 (distribute)"
              checked={draft.distribute}
              onChange={(distribute) => setDraft({ ...draft, distribute })}
            />
            <Field title="탐지 사유">
              <input
                maxLength={100}
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              />
            </Field>
            <div className="guard-actions">
              <button
                className="button button-primary"
                disabled={pending || !!error}
              >
                규칙 저장
              </button>
              {saved && (
                <button
                  type="button"
                  className="button danger-text"
                  onClick={() => {
                    if (window.confirm("이 규칙을 삭제하시겠습니까?"))
                      void run(async () => {
                        await update(
                          `custom-rules/${encodeURIComponent(saved)}`,
                          undefined,
                          "DELETE",
                        );
                        select();
                      }, "규칙을 삭제했습니다.");
                  }}
                >
                  규칙 삭제
                </button>
              )}
            </div>
            <div className="guard-section">
              <Field title="시험 텍스트">
                <textarea
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                />
              </Field>
              <button
                type="button"
                className="button"
                disabled={!!error || !sample || !draft.id || !draft.label}
                onClick={() =>
                  void run(
                    async () =>
                      setResult(
                        (
                          await guardRequest("custom-rules/test", {
                            method: "POST",
                            body: { rule: body, text: sample },
                          })
                        ).data,
                      ),
                    "규칙 시험을 완료했습니다.",
                  )
                }
              >
                규칙 시험
              </button>
              <TestResult result={result} />
            </div>
          </fieldset>
        </form>
      </Panel>
    </div>
  );
}
function JudgmentsTab({
  rules,
  template,
  revision,
  pending,
  run,
  update,
}: RuleActions & {
  rules: GuardJudgment[];
  template: string | null;
  revision: number;
}) {
  const [draft, setDraft] = useState<GuardJudgment>(
    rules[0] ?? freshJudgment(),
  );
  const [saved, setSaved] = useState(rules[0]?.id ?? "");
  const [examples, setExamples] = useState(draft.examples.join("\n"));
  const [counter, setCounter] = useState(draft.counter_examples.join("\n"));
  const [prompt, setPrompt] = useState(template ?? "");
  const preview = useResource(
    (signal) =>
      guardRequest<{
        default_template: string;
        rendered_system_prompt: string;
      }>("prompt", { signal }),
    [template, revision],
  );
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<unknown>(null);
  function select(rule?: GuardJudgment) {
    const next = rule ?? freshJudgment();
    setDraft(next);
    setSaved(rule?.id ?? "");
    setExamples(next.examples.join("\n"));
    setCounter(next.counter_examples.join("\n"));
    setResult(null);
  }
  const body = {
    ...draft,
    examples: lines(examples),
    counter_examples: lines(counter),
  };
  return (
    <>
      <p className="guard-intro">
        검사 서버의 Jev 판단 기준입니다.{" "}
        <Link className="text-link" to="/settings/jev">
          조직 트리의 Jev 설정
        </Link>
        에서 관리하는 판단 프롬프트와 각각 설정합니다.
      </p>
      <div className="guard-editor-layout">
        <section className="guard-list">
          <h2>Jev 판단 기준</h2>
          <button
            className="button"
            disabled={pending}
            onClick={() => select()}
          >
            새 Jev 판단
          </button>
          {!rules.length && (
            <p className="muted">등록된 판단 기준이 없습니다.</p>
          )}
          {rules.map((rule) => (
            <button
              key={rule.id}
              className={saved === rule.id ? "selected" : ""}
              disabled={pending}
              onClick={() => select(rule)}
            >
              <strong>{rule.label}</strong>
              <small>{rule.enabled ? "사용 중" : "사용 안 함"}</small>
            </button>
          ))}
        </section>
        <Panel title="Jev 판단 편집">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await update(
                  `context-detectors/${encodeURIComponent(draft.id)}`,
                  body,
                );
                setSaved(draft.id);
              });
            }}
          >
            <fieldset disabled={pending}>
              <TypeFields draft={draft} change={setDraft} locked={!!saved} />
              <Field title="Jev 판단 기준" help="5~1,000자">
                <textarea
                  required
                  minLength={5}
                  maxLength={1000}
                  value={draft.criteria}
                  onChange={(e) =>
                    setDraft({ ...draft, criteria: e.target.value })
                  }
                />
              </Field>
              <Field
                title="탐지 예문"
                help="한 줄에 하나씩, 최대 20개 · 각 300자"
              >
                <textarea
                  required
                  value={examples}
                  onChange={(e) => setExamples(e.target.value)}
                />
              </Field>
              <Field
                title="제외 예문"
                help="한 줄에 하나씩, 최대 20개 · 각 300자"
              >
                <textarea
                  value={counter}
                  onChange={(e) => setCounter(e.target.value)}
                />
              </Field>
              <div className="guard-actions">
                <Submit pending={pending}>판단 저장</Submit>
                {saved && (
                  <button
                    type="button"
                    className="button danger-text"
                    onClick={() => {
                      if (window.confirm("이 Jev 판단을 삭제하시겠습니까?"))
                        void run(async () => {
                          await update(
                            `context-detectors/${encodeURIComponent(saved)}`,
                            undefined,
                            "DELETE",
                          );
                          select();
                        }, "Jev 판단을 삭제했습니다.");
                    }}
                  >
                    판단 삭제
                  </button>
                )}
              </div>
              <div className="guard-section">
                <Field title="Jev 시험 텍스트">
                  <textarea
                    value={sample}
                    onChange={(e) => setSample(e.target.value)}
                  />
                </Field>
                <button
                  className="button"
                  type="button"
                  disabled={!sample || !draft.id || !draft.criteria}
                  onClick={() =>
                    void run(
                      async () =>
                        setResult(
                          (
                            await guardRequest("context-detectors/test", {
                              method: "POST",
                              body: { text: sample, detectors: [body] },
                            })
                          ).data,
                        ),
                      "Jev 시험을 완료했습니다.",
                    )
                  }
                >
                  Jev 시험
                </button>
                <TestResult result={result} />
              </div>
            </fieldset>
          </form>
        </Panel>
      </div>
      <Panel
        title="Jev 프롬프트 템플릿"
        description="{detectors} 자리에 사용 중인 판단 기준이 들어갑니다. 비우면 기본 템플릿을 사용합니다."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (codePoints(prompt) <= 4000)
              void run(() => update("prompt", { template: prompt || null }));
          }}
        >
          <fieldset disabled={pending}>
            <Field
              title="프롬프트 템플릿"
              help={`${codePoints(prompt)} / 4,000자`}
            >
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </Field>
            {!!prompt && !prompt.includes("{detectors}") && (
              <p className="field-error">
                {"{detectors} 자리표시자를 포함해 주세요."}
              </p>
            )}
            <button
              className="button button-primary"
              disabled={
                codePoints(prompt) > 4000 ||
                (!!prompt && !prompt.includes("{detectors}"))
              }
            >
              템플릿 저장
            </button>
          </fieldset>
        </form>
        {preview.error ? (
          <ErrorState message={preview.error} retry={preview.refresh} />
        ) : (
          preview.data && (
            <details className="guard-section">
              <summary>저장된 시스템 프롬프트 보기</summary>
              <pre className="guard-pre">
                {preview.data.data.rendered_system_prompt}
              </pre>
              <h3>기본 템플릿</h3>
              <pre className="guard-pre">
                {preview.data.data.default_template}
              </pre>
            </details>
          )
        )}
      </Panel>
    </>
  );
}
function OrgTab({ pending, run }: Actions) {
  const resource = useResource((signal) => guardApi.org(signal), []);
  return resource.error ? (
    <ErrorState message={resource.error} retry={resource.refresh} />
  ) : !resource.data ? (
    <LoadingState />
  ) : (
    <OrgForm settings={resource.data.data} pending={pending} run={run} />
  );
}
function OrgForm({ settings, pending, run }: Actions & { settings: GuardOrg }) {
  const [draft, setDraft] = useState(settings);
  const [tags, setTags] = useState(
    JSON.stringify(settings.tag_map ?? {}, null, 2),
  );
  const [policies, setPolicies] = useState(
    JSON.stringify(
      settings.policy_state_map ?? { allow: null, warn: null, block: null },
      null,
      2,
    ),
  );
  function map(text: string, policy: boolean) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        `${policy ? "정책 상태" : "태그"} 매핑의 JSON 형식을 확인해 주세요.`,
      );
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.entries(value).some(
        ([key, item]) =>
          !key ||
          (item === null
            ? !policy
            : typeof item !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item)),
      ) ||
      (policy &&
        Object.keys(value).some(
          (key) => !["allow", "warn", "block"].includes(key),
        ))
    )
      throw new Error(
        "매핑에는 유효한 ID를 입력해 주세요. 정책 상태에는 null을 사용할 수 있습니다.",
      );
    return value;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await guardRequest("org/settings", {
        method: "PUT",
        body: {
          report_text: draft.report_text,
          tag_action: draft.tag_action,
          jev_enabled: draft.jev_enabled,
          source_id: draft.source_id,
          tag_map: map(tags, false),
          policy_state_map: map(policies, true),
        },
      });
    });
  }
  return (
    <Panel
      title="조직 설정"
      description="원문 기록 방식과 조직 태그·정책 상태 연결을 설정합니다."
    >
      <form onSubmit={submit}>
        <fieldset disabled={pending}>
          <div className="guard-form-grid">
            <Field title="원문 기록 (report_text)">
              <select
                value={draft.report_text}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    report_text: e.target.value as GuardOrg["report_text"],
                  })
                }
              >
                <option value="full">전체 원문</option>
                <option value="masked">마스킹한 원문</option>
                <option value="off">기록 안 함</option>
              </select>
            </Field>
            <Field title="조직 태그 조치 (tag_action)">
              <ActionSelect
                value={draft.tag_action}
                change={(tag_action) => setDraft({ ...draft, tag_action })}
              />
            </Field>
            <Field title="수집 시스템 ID (source_id)">
              <input
                required
                pattern="[A-Za-z0-9_-]{1,80}"
                value={draft.source_id}
                onChange={(e) =>
                  setDraft({ ...draft, source_id: e.target.value })
                }
              />
            </Field>
          </div>
          <EnabledSetting
            label="조직 Jev 판단 사용 (jev_enabled)"
            checked={draft.jev_enabled}
            onChange={(jev_enabled) => setDraft({ ...draft, jev_enabled })}
          />
          <Field
            title="태그 매핑 (tag_map)"
            help="JSON 객체: 탐지 유형을 대시보드 태그 ID에 연결합니다."
          >
            <textarea
              className="code-value"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>
          <Field
            title="정책 상태 매핑 (policy_state_map)"
            help="allow·warn·block을 활성 버전의 정책 상태 ID에 연결합니다. null은 연결하지 않습니다."
          >
            <textarea
              className="code-value"
              value={policies}
              onChange={(e) => setPolicies(e.target.value)}
            />
          </Field>
          <Submit pending={pending}>조직 설정 저장</Submit>
        </fieldset>
      </form>
    </Panel>
  );
}
function ClientsTab({ pending, run }: Actions) {
  const clients = useResource((signal) => guardApi.clients(signal), []);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const people = useResource(
    (signal) => api.people({}, query, page, signal),
    [query, page],
  );
  const [person, setPerson] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  return (
    <>
      <Panel
        title="등록 코드 발급"
        description="등록된 사람을 선택해 일회용 코드를 발급합니다. 코드는 이번 응답에서만 표시됩니다."
      >
        <form
          className="guard-actions"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(
              String(new FormData(e.currentTarget).get("personQuery") ?? ""),
            );
            setPage(0);
            setPerson("");
          }}
        >
          <Field title="등록할 사람 검색">
            <input
              name="personQuery"
              placeholder="이름 또는 ID"
              disabled={pending}
            />
          </Field>
          <button className="button" disabled={pending}>
            검색
          </button>
        </form>
        {people.error ? (
          <ErrorState message={people.error} retry={people.refresh} />
        ) : !people.data ? (
          <LoadingState />
        ) : !people.data.items.length ? (
          <p>
            등록된 사람이 없습니다.{" "}
            <Link className="text-link" to="/people">
              사람 관리
            </Link>
            에서 먼저 등록해 주세요.
          </p>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEnrollment(null);
                void run(async () => {
                  const selected = people.data!.items.find(
                    (item) => item.id === person,
                  )!;
                  setEnrollment(
                    (
                      await guardRequest<Enrollment>("enrollments", {
                        method: "POST",
                        body: {
                          person_id: person,
                          label: selected.name.slice(0, 60),
                        },
                      })
                    ).data,
                  );
                }, "등록 코드를 발급했습니다.");
              }}
            >
              <fieldset disabled={pending}>
                <Field title="등록할 사람">
                  <select
                    required
                    value={person}
                    onChange={(e) => {
                      setPerson(e.target.value);
                      setEnrollment(null);
                    }}
                  >
                    <option value="">사람 선택</option>
                    {people.data.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.id})
                      </option>
                    ))}
                  </select>
                </Field>
                <Submit pending={pending}>등록 코드 발급</Submit>
              </fieldset>
            </form>
            <Pagination
              page={people.data}
              onChange={(next) => {
                setPage(next);
                setPerson("");
              }}
            />
          </>
        )}
        {enrollment && (
          <div className="guard-enrollment" role="status">
            <span>일회용 등록 코드</span>
            <strong className="code-value">{enrollment.code}</strong>
            <span>만료 {formatDateTime(enrollment.expires_at)}</span>
          </div>
        )}
      </Panel>
      <Panel title="연결된 사용자" action={<RefreshButton {...clients} />}>
        {clients.error ? (
          <ErrorState message={clients.error} retry={clients.refresh} />
        ) : !clients.data ? (
          <LoadingState />
        ) : !clients.data.data.clients.length ? (
          <EmptyState description="연결된 사용자가 없습니다. 등록 코드로 클라이언트를 연결해 주세요." />
        ) : (
          <div className="guard-clients">
            {clients.data.data.clients.map((client) => (
              <ClientRow
                key={client.client_id}
                client={client}
                pending={pending}
                run={run}
                refresh={clients.refresh}
              />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
function ClientRow({
  client,
  pending,
  run,
  refresh,
}: Actions & { client: GuardClient; refresh: () => void }) {
  const [label, setLabel] = useState(client.label);
  return (
    <form
      className="guard-client-row"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await guardRequest(
            `clients/${encodeURIComponent(client.client_id)}`,
            { method: "PATCH", body: { label } },
          );
          refresh();
        }, "연결 이름을 변경했습니다.");
      }}
    >
      <fieldset disabled={pending || !!client.revoked_at}>
        <Field title={`${client.label} 연결 이름`}>
          <input
            value={label}
            required
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <p className="muted">
          {client.person_id ?? "사람 미연결"} ·{" "}
          {client.device_name ?? client.client_type} · 최근 연결{" "}
          {client.last_seen_at
            ? formatDateTime(client.last_seen_at)
            : "기록 없음"}
        </p>
        <div className="guard-actions">
          <Submit pending={pending}>이름 변경</Submit>
          <button
            type="button"
            className="button danger-text"
            onClick={() => {
              if (
                window.confirm(
                  `${client.label}의 연결을 해지하시겠습니까? 기존 토큰을 더 이상 사용할 수 없습니다.`,
                )
              )
                void run(async () => {
                  await guardRequest(
                    `clients/${encodeURIComponent(client.client_id)}`,
                    { method: "DELETE" },
                  );
                  refresh();
                }, "연결을 해지했습니다.");
            }}
          >
            연결 해지
          </button>
        </div>
      </fieldset>
    </form>
  );
}
