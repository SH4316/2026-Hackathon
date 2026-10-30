import { useState } from "react";
import { api } from "./api";
import { formatDateTime } from "./format";
import { Icon, Panel } from "./ui";
import type { Enrollment } from "./types";

/** 사람 상세: 확장프로그램을 이 사람으로 조직 검사 서버에 연결하는 일회용 코드. */
export function PersonEnrollment({ personId }: { personId: string }) {
  const [issued, setIssued] = useState<Enrollment | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function issue() {
    setPending(true);
    setError("");
    try {
      setIssued(await api.createEnrollment(personId));
      setCopied(false);
    } catch (x) {
      setError(x instanceof Error ? x.message : "발급하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const shareable = issued ? (issued.connectionInfo ?? issued.code) : "";
  return (
    <Panel
      title="확장프로그램 연결"
      description="이 사람의 브라우저 확장을 조직 검사 서버에 연결합니다. 연결하면 확장은 조직 관리 모드가 되고 탐지 이력이 이 사람으로 기록됩니다."
      className="monitoring-panel"
      action={
        <button
          className="button button-primary"
          type="button"
          disabled={pending}
          onClick={issue}
        >
          {issued ? "새 연결 코드 발급" : "연결 코드 발급"}
        </button>
      }
    >
      <div className="monitoring-body">
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {issued ? (
          <div className="connector-created" role="status">
            <p>
              <Icon name="lock" size={14} />
              {issued.connectionInfo ? "연결 정보" : "연결 코드"}는 지금만 볼 수
              있습니다. {formatDateTime(issued.expiresAt)}까지 한 번만 쓸 수
              있습니다.
            </p>
            <div className="connector-url">
              <code>{shareable}</code>
              <button
                className="button button-small"
                type="button"
                onClick={() => copy(shareable)}
              >
                <Icon name="copy" size={14} />
                {copied ? "복사됨" : "복사"}
              </button>
            </div>
            <small>
              사용자에게 전달하면, 확장 설정 → 대시보드 연결에 그대로 붙여 넣고
              연결을 누릅니다.
              {!issued.connectionInfo &&
                " 검사 서버 연결 화면에서 검사 서버 주소를 등록해 두면 서버 주소까지 한 줄로 전달할 수 있습니다. 지금은 사용자가 검사 서버 주소를 먼저 저장해야 합니다."}
            </small>
          </div>
        ) : (
          <p className="compact-empty">
            발급한 코드는 연결된 검사 서버에서만 사용할 수 있고, 이 화면을
            벗어나면 다시 볼 수 없습니다.
          </p>
        )}
      </div>
    </Panel>
  );
}
