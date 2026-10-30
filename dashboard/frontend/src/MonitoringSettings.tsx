import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { formatDateTime } from "./format";
import { useResource } from "./hooks";
import {
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  PageTitle,
  Panel,
  useWorkspace,
} from "./ui";
import type {
  CreatedConnector,
  DetectorSettings,
  ReportText,
  TagAction,
} from "./types";

const REPORT_TEXT: { value: ReportText; label: string; description: string }[] =
  [
    {
      value: "masked",
      label: "마스킹 문장",
      description: "탐지 구간을 [EMAIL_1]처럼 토큰으로 바꾼 문장만 기록합니다.",
    },
    {
      value: "full",
      label: "원문",
      description: "검사한 원문과 탐지 값을 그대로 기록합니다.",
    },
    {
      value: "off",
      label: "기록 안 함",
      description: "규칙만 적용하고 탐지 이력은 보내지 않습니다.",
    },
  ];

const TAG_ACTION: { value: TagAction; label: string }[] = [
  { value: "warn", label: "확인 필요" },
  { value: "mask", label: "치환 필요" },
  { value: "block", label: "전송 불가" },
];

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** 검사 서버 연결 URL 발급·해지. */
function Connectors() {
  const r = useResource((signal) => api.connectors(signal), []);
  const [created, setCreated] = useState<CreatedConnector | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const dashboardUrl = String(d.get("dashboardUrl") ?? "").trim();
    const serverUrl = String(d.get("serverUrl") ?? "").trim();
    setPending(true);
    setError("");
    try {
      const value = await api.createConnector({
        name: String(d.get("name")).trim(),
        ...(dashboardUrl ? { dashboardUrl } : {}),
        ...(serverUrl ? { serverUrl } : {}),
      });
      setCreated(value);
      setCopied(false);
      form.reset();
      r.refresh();
    } catch (x) {
      setError(message(x, "연결을 만들지 못했습니다."));
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (
      !window.confirm(
        `"${name}" 연결을 해지할까요? 그 검사 서버는 즉시 규칙을 받지 못하고 전송을 보류합니다.`,
      )
    )
      return;
    try {
      await api.revokeConnector(id);
      if (created?.connector.id === id) setCreated(null);
      r.refresh();
    } catch (x) {
      setError(message(x, "해지하지 못했습니다."));
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.connectionUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Panel
      title="검사 서버 연결"
      description="연결 URL을 검사 서버의 PG_DASHBOARD_CONNECTION에 넣으면 이 대시보드의 활성 설정을 받아 검사하고 탐지 이력을 보냅니다."
      className="monitoring-panel"
    >
      <div className="monitoring-body">
        <form className="connector-form" onSubmit={submit}>
          <label>
            <span>연결 이름</span>
            <input
              name="name"
              required
              maxLength={80}
              placeholder="본사 검사 서버"
              disabled={pending}
            />
          </label>
          <label>
            <span>검사 서버가 접속할 대시보드 주소 (선택)</span>
            <input
              name="dashboardUrl"
              type="url"
              placeholder={window.location.origin}
              disabled={pending}
            />
            <small>
              비우면 지금 주소를 씁니다. 컨테이너 안의 검사 서버라면
              http://host.docker.internal:8080 처럼 그 서버에서 보이는 주소를
              입력하세요.
            </small>
          </label>
          <label className="connector-form-wide">
            <span>사용자가 확장에 넣을 검사 서버 주소 (선택)</span>
            <input
              name="serverUrl"
              type="url"
              placeholder="https://guard.example.org"
              disabled={pending}
            />
            <small>
              입력하면 사람 화면에서 발급하는 연결 정보에 이 주소가 함께 들어가,
              사용자는 한 줄만 붙여 넣으면 됩니다.
            </small>
          </label>
          <button className="button button-primary" disabled={pending}>
            연결 URL 만들기
          </button>
        </form>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {created && (
          <div className="connector-created" role="status">
            <p>
              <Icon name="lock" size={14} />
              <strong>{created.connector.name}</strong> 연결 URL은 지금만 볼 수
              있습니다. 복사해 검사 서버에 넣으세요. 비밀번호처럼 다루세요.
            </p>
            <div className="connector-url">
              <code>{created.connectionUrl}</code>
              <button
                className="button button-small"
                type="button"
                onClick={copy}
              >
                <Icon name="copy" size={14} />
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
            <small>
              검사 서버: PG_DASHBOARD_CONNECTION=&lt;연결 URL&gt; 로 실행한 뒤
              관리 API POST /v1/admin/org/refresh 로 연결을 확인할 수 있습니다.
            </small>
          </div>
        )}
        {r.error ? (
          <ErrorState message={r.error} retry={r.refresh} />
        ) : !r.data ? (
          <LoadingState />
        ) : r.data.length === 0 ? (
          <p className="compact-empty">
            아직 연결이 없습니다. 연결을 처음 만들면 그때부터 검사 서버
            엔드포인트(활성 설정·탐지 이력 수집)는 연결 URL로만 사용할 수
            있습니다.
          </p>
        ) : (
          <ul className="connector-list" aria-label="검사 서버 연결 목록">
            {r.data.map((c) => (
              <li key={c.id} data-revoked={c.revokedAt ? "true" : undefined}>
                <span>
                  <span className="setting-label">{c.name}</span>
                  <span className="setting-description">
                    {c.id}
                    {c.serverUrl ? " · " + c.serverUrl : ""} · 발급{" "}
                    {formatDateTime(c.createdAt)} ·{" "}
                    {c.revokedAt
                      ? "해지 " + formatDateTime(c.revokedAt)
                      : c.lastUsedAt
                        ? "마지막 사용 " + formatDateTime(c.lastUsedAt)
                        : "아직 사용 안 함"}
                  </span>
                </span>
                {c.revokedAt ? (
                  <span className="badge">해지됨</span>
                ) : (
                  <button
                    className="button button-small"
                    type="button"
                    onClick={() => revoke(c.id, c.name)}
                  >
                    <Icon name="trash" size={14} />
                    해지
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

interface MapRow {
  type: string;
  tag: string;
}

/** 검사 서버가 따르는 조직 설정(원문 처리·태그 조치·Jev·탐지 유형 매핑). */
function DetectorSettingsPanel() {
  const { versions } = useWorkspace();
  const active = versions.find((v) => v.isActive);
  const r = useResource((signal) => api.detectorSettings(signal), []);
  const tags = useResource(
    (signal) =>
      active ? api.version(active.id, signal) : Promise.resolve(null),
    [active?.id],
  );
  const [draft, setDraft] = useState<DetectorSettings | null>(null);
  const [rows, setRows] = useState<MapRow[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!r.data) return;
    setDraft(r.data);
    setRows(
      Object.entries(r.data.tagMap).map(([type, tag]) => ({ type, tag })),
    );
  }, [r.data]);

  if (r.error) return <ErrorState message={r.error} retry={r.refresh} />;
  if (!draft) return <LoadingState />;
  const current = draft;

  async function save() {
    setPending(true);
    setNotice("");
    setError("");
    try {
      const tagMap: Record<string, string> = {};
      for (const row of rows) {
        const type = row.type.trim();
        if (type && row.tag) tagMap[type] = row.tag;
      }
      const saved = await api.saveDetectorSettings({
        reportText: current.reportText,
        tagAction: current.tagAction,
        jevEnabled: current.jevEnabled,
        tagMap,
        revision: current.revision,
      });
      setDraft(saved);
      setRows(
        Object.entries(saved.tagMap).map(([type, tag]) => ({ type, tag })),
      );
      setNotice("저장했습니다. 연결된 검사 서버는 30초 안에 반영합니다.");
    } catch (x) {
      setError(
        x instanceof ApiError && x.code === "REVISION_CONFLICT"
          ? "다른 변경이 먼저 저장되었습니다. 새로고침한 뒤 다시 저장하세요."
          : message(x, "저장하지 못했습니다."),
      );
    } finally {
      setPending(false);
    }
  }

  const tagOptions = tags.data?.tags ?? [];
  return (
    <Panel
      title="검사 서버 설정"
      description={
        "연결된 모든 검사 서버가 따릅니다." +
        (current.updatedAt
          ? " 마지막 저장 " + formatDateTime(current.updatedAt)
          : "")
      }
      className="monitoring-panel"
    >
      <div className="monitoring-body">
        <fieldset className="detector-settings" disabled={pending}>
          <legend>탐지 이력의 원문 처리</legend>
          {REPORT_TEXT.map((o) => (
            <label key={o.value} className="detector-choice">
              <input
                type="radio"
                name="reportText"
                checked={current.reportText === o.value}
                onChange={() => setDraft({ ...current, reportText: o.value })}
              />
              <span>
                <span className="setting-label">{o.label}</span>
                <span className="setting-description">{o.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="detector-grid">
          <label>
            <span>대시보드 태그(정규식·Jev) 탐지 시 조치</span>
            <select
              value={current.tagAction}
              disabled={pending}
              onChange={(e) =>
                setDraft({ ...current, tagAction: e.target.value as TagAction })
              }
            >
              {TAG_ACTION.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <small>
              전송 대상 AI의 데이터 정책 등급에 따라 더 강해질 수 있습니다.
            </small>
          </label>
          <label className="detector-check">
            <input
              type="checkbox"
              checked={current.jevEnabled}
              disabled={pending}
              onChange={(e) =>
                setDraft({ ...current, jevEnabled: e.target.checked })
              }
            />
            <span>
              <span className="setting-label">Jev 판정 사용</span>
              <span className="setting-description">
                끄면 태그 Python 정규식만 적용합니다. 켜면 검사 서버의 로컬
                모델이 필요합니다.
              </span>
            </span>
          </label>
        </div>
        <div className="detector-map">
          <h3>검사 서버 탐지 유형 → 태그</h3>
          <p className="setting-description">
            검사 서버의 기본 탐지 유형(email, phone, aws_access_key_id 등)을 이
            대시보드의 태그로 집계합니다. 태그 ID와 같은 유형은 자동으로
            연결됩니다.
          </p>
          {rows.map((row, i) => (
            <div className="detector-map-row" key={i}>
              <input
                aria-label="탐지 유형"
                value={row.type}
                maxLength={80}
                placeholder="email"
                disabled={pending}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, type: e.target.value } : x,
                    ),
                  )
                }
              />
              <Icon name="arrow" size={14} />
              <select
                aria-label="태그"
                value={row.tag}
                disabled={pending}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, tag: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="">태그 선택</option>
                {!tagOptions.some((t) => t.id === row.tag) && row.tag && (
                  <option value={row.tag}>{row.tag} (활성 버전에 없음)</option>
                )}
                {tagOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id})
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                type="button"
                aria-label="매핑 삭제"
                disabled={pending}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
          <button
            className="button button-small"
            type="button"
            disabled={pending}
            onClick={() => setRows([...rows, { type: "", tag: "" }])}
          >
            매핑 추가
          </button>
        </div>
        <div className="settings-save">
          <span role="status">
            {error ? <span className="field-error">{error}</span> : notice}
          </span>
          <button
            className="button button-primary"
            type="button"
            disabled={pending}
            onClick={save}
          >
            설정 저장
          </button>
        </div>
      </div>
    </Panel>
  );
}

export function MonitoringSettings() {
  const { versions } = useWorkspace();
  const active = versions.find((v) => v.isActive);
  return (
    <>
      <PageTitle
        title="감시 연동"
        description="검사 서버를 이 대시보드에 연결하고, 연결된 서버가 따를 설정을 정합니다."
      />
      <Connectors />
      <DetectorSettingsPanel />
      {!active && (
        <EmptyState
          icon="tree"
          title="활성 설정이 없습니다"
          description="메트릭 버전을 발행·활성화해야 연결된 검사 서버가 태그 규칙을 적용합니다."
        />
      )}
    </>
  );
}
