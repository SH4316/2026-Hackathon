import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { GuardBanner } from "./GuardBanner";
import { EnabledSetting } from "./EnabledSetting";
import { flattenTree, formatNumber } from "./format";
import { useResource } from "./hooks";
import { parseJevThreshold, jevThresholdError } from "./jev";
import type { ConfigVersion, JevPrompt } from "./types";
import {
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  PageTitle,
  Panel,
  VersionBadge,
  useWorkspace,
} from "./ui";

interface PromptDraft {
  id: string | null;
  name: string;
  prompt: string;
  enabled: boolean;
  tagIds: string[];
  thresholds: Record<string, string>;
}

function editPrompt(version: ConfigVersion, prompt?: JevPrompt): PromptDraft {
  return {
    id: prompt?.id ?? null,
    name: prompt?.name ?? "새 Jev 판단",
    prompt: prompt?.prompt ?? "",
    enabled: prompt?.enabled ?? true,
    tagIds: [...(prompt?.tagIds ?? [])],
    thresholds: Object.fromEntries(
      version.tags.map((tag) => [
        tag.id,
        tag.jevThreshold == null ? "" : String(tag.jevThreshold),
      ]),
    ),
  };
}

function draftContent(draft: PromptDraft) {
  return JSON.stringify({
    name: draft.name,
    prompt: draft.prompt,
    enabled: draft.enabled,
    outputs: draft.tagIds.map((tagId) => ({
      tagId,
      threshold: draft.thresholds[tagId] ?? "",
    })),
  });
}

export function JevSettings() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const versionId =
    params.get("versionId") ||
    workspace.versions.find((version) => version.isActive)?.id ||
    workspace.versions[0]?.id ||
    "";
  const resource = useResource(
    (signal) =>
      versionId ? api.version(versionId, signal) : Promise.resolve(null),
    [versionId],
  );
  const [loadedVersion, setVersion] = useState<ConfigVersion | null>(null);
  const version = loadedVersion?.id === versionId ? loadedVersion : null;
  const currentVersionId = useRef(versionId);
  currentVersionId.current = versionId;
  const [draft, setDraft] = useState<PromptDraft | null>(null);
  const [savedContent, setSavedContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [badThresholds, setBadThresholds] = useState<Record<string, boolean>>(
    {},
  );
  const dirty =
    !!draft &&
    (!draft.id ||
      draftContent(draft) !== savedContent ||
      draft.tagIds.some((id) => badThresholds[id]));

  function selectPrompt(value: ConfigVersion, prompt?: JevPrompt) {
    const next = editPrompt(value, prompt);
    setDraft(next);
    setBadThresholds({});
    setSavedContent(prompt ? draftContent(next) : "");
    setTagSearch("");
  }

  useEffect(() => {
    if (resource.data?.id === versionId) {
      setVersion(resource.data);
      const first = resource.data.jevPrompts[0];
      if (first) selectPrompt(resource.data, first);
      else {
        setDraft(null);
        setSavedContent("");
      }
      setError("");
      setNotice("");
    } else {
      setVersion(null);
      setDraft(null);
      setSavedContent("");
      setBadThresholds({});
      setError("");
      setNotice("");
    }
  }, [resource.data, versionId]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const linkGuard = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (
        link &&
        !link.target &&
        !window.confirm("저장하지 않은 Jev 설정을 버리고 이동할까요?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", linkGuard, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", linkGuard, true);
    };
  }, [dirty]);

  const canLeave = () =>
    !dirty || window.confirm("저장하지 않은 Jev 설정을 버릴까요?");
  const promptLength = Array.from(draft?.prompt ?? "").length;
  const nameInvalid =
    !!draft &&
    (!draft.name.trim() || Array.from(draft.name.trim()).length > 80);
  const thresholdInvalid =
    !!draft &&
    draft.tagIds.some(
      (id) =>
        badThresholds[id] ||
        parseJevThreshold(draft.thresholds[id] ?? "") === undefined,
    );
  const invalid = nameInvalid || promptLength > 12000 || thresholdInvalid;
  const tree = version ? flattenTree(version.tags) : [];
  const visibleTags = tree.filter(
    (tag) =>
      !tagSearch ||
      `${tag.name} ${tag.id}`.toLowerCase().includes(tagSearch.toLowerCase()),
  );
  const metricPath = `/settings/metrics${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`;

  function startNew() {
    if (!version || pending || version.jevPrompts.length >= 100 || !canLeave())
      return;
    selectPrompt(version);
    setError("");
    setNotice("");
  }

  async function save() {
    if (!version || !draft || pending || invalid) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const input = {
        revision: version.revision,
        name: draft.name,
        prompt: draft.prompt,
        enabled: draft.enabled,
        outputs: draft.tagIds.map((tagId) => ({
          tagId,
          threshold: parseJevThreshold(draft.thresholds[tagId] ?? "") as
            number | null,
        })),
      };
      const next = draft.id
        ? await api.saveJevPrompt(version.id, draft.id, input)
        : await api.createJevPrompt(version.id, input);
      if (currentVersionId.current !== version.id) return;
      const saved = next.jevPrompts.find((prompt) =>
        draft.id
          ? prompt.id === draft.id
          : !version.jevPrompts.some((existing) => existing.id === prompt.id),
      );
      if (!saved)
        throw new Error(
          "저장한 Jev 판단을 찾을 수 없습니다. 설정을 다시 불러와 주세요.",
        );
      setVersion(next);
      selectPrompt(next, saved);
      setNotice("Jev 판단을 저장했습니다. 선택한 트리 버전에만 적용됩니다.");
      workspace.reload();
    } catch (cause) {
      if (currentVersionId.current !== version.id) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Jev 판단을 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (
      !version ||
      !draft?.id ||
      pending ||
      !window.confirm(
        "이 Jev 판단을 삭제할까요? 연결된 태그와 임계값은 유지됩니다.",
      )
    )
      return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const next = await api.deleteJevPrompt(
        version.id,
        draft.id,
        version.revision,
      );
      if (currentVersionId.current !== version.id) return;
      setVersion(next);
      if (next.jevPrompts[0]) selectPrompt(next, next.jevPrompts[0]);
      else {
        setDraft(null);
        setSavedContent("");
      }
      setNotice("Jev 판단을 삭제했습니다. 결과 태그와 임계값은 유지됩니다.");
      workspace.reload();
    } catch (cause) {
      if (currentVersionId.current !== version.id) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Jev 판단을 삭제하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <GuardBanner />
      <PageTitle
        title="Jev 설정"
        description="판단 프롬프트와 결과 태그를 연결하고, 태그별 점수 임계값을 설정하세요."
        action={
          <button
            className="button button-primary"
            onClick={startNew}
            disabled={!version || pending || version.jevPrompts.length >= 100}
            title={
              version && version.jevPrompts.length >= 100
                ? "버전당 Jev 판단은 최대 100개까지 추가할 수 있습니다."
                : undefined
            }
          >
            <Icon name="plus" size={16} />새 Jev 판단
          </button>
        }
      />
      {workspace.error && (
        <ErrorState message={workspace.error} retry={workspace.reload} />
      )}
      <div className="version-workbar">
        <label>
          <span className="sr-only">Jev 설정 버전 선택</span>
          <select
            aria-label="Jev 설정 버전 선택"
            value={versionId}
            disabled={pending}
            onChange={(event) => {
              if (canLeave()) {
                setVersion(null);
                setDraft(null);
                setParams({ versionId: event.target.value });
              }
            }}
          >
            <option value="" disabled>
              트리 버전을 선택하세요
            </option>
            {workspace.versions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ·{" "}
                {item.isActive
                  ? "활성"
                  : item.status === "DRAFT"
                    ? "초안"
                    : "발행됨"}
              </option>
            ))}
          </select>
        </label>
        {version && <VersionBadge version={version} />}
        <div className="version-actions">
          <Link className="button" to={metricPath}>
            <Icon name="tree" size={16} />
            메트릭 트리
          </Link>
        </div>
      </div>
      {error && (
        <div className="editor-error">
          <ErrorState message={error} />
          <button
            className="text-button"
            onClick={() => {
              if (canLeave()) resource.refresh();
            }}
          >
            서버 내용 다시 불러오기
          </button>
        </div>
      )}
      {notice && (
        <div className="success-notice" role="status">
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}
      {resource.error ? (
        <ErrorState message={resource.error} retry={resource.refresh} />
      ) : (resource.loading && !version) ||
        (workspace.loading && !workspace.versions.length) ? (
        <LoadingState />
      ) : !version ? (
        <Panel title="트리 버전부터 준비하세요">
          <EmptyState
            icon="tree"
            title="아직 설정된 트리가 없습니다"
            description="메트릭 설정에서 트리와 결과로 사용할 태그를 만든 뒤 Jev 판단을 추가하세요."
            action={
              <Link className="button button-primary" to={metricPath}>
                메트릭 설정으로 이동
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          <p className="jev-version-note">
            {version.isActive
              ? "활성 버전입니다. 저장한 설정은 다음 분류 설정 조회부터 반영됩니다."
              : "선택한 버전에만 저장됩니다. 활성 버전의 설정은 바뀌지 않습니다."}{" "}
            발행 후에도 Jev 판단과 임계값을 수정할 수 있습니다.
          </p>
          <div className="jev-settings-layout">
            <section className="jev-prompt-list" aria-label="Jev 판단 목록">
              <div className="jev-list-heading">
                <h2>판단 프롬프트</h2>
                <span>{version.jevPrompts.length}개</span>
              </div>
              {version.jevPrompts.map((prompt) => (
                <button
                  key={prompt.id}
                  className={`jev-prompt-option${draft?.id === prompt.id ? " selected" : ""}`}
                  aria-pressed={draft?.id === prompt.id}
                  disabled={pending}
                  onClick={() => {
                    if (canLeave()) {
                      selectPrompt(version, prompt);
                      setError("");
                      setNotice("");
                    }
                  }}
                >
                  <strong>{prompt.name}</strong>
                  <span>결과 태그 {prompt.tagIds.length}개</span>
                  {!prompt.enabled && (
                    <small className="usage-badge">사용 안 함</small>
                  )}
                </button>
              ))}
              {draft && !draft.id && (
                <div className="jev-prompt-option selected">
                  <strong>새 Jev 판단</strong>
                  <span>아직 저장되지 않음</span>
                </div>
              )}
              {!version.jevPrompts.length && !draft && (
                <p className="jev-list-empty">
                  프롬프트를 추가해 결과 태그를 연결하세요.
                </p>
              )}
            </section>
            <section className="jev-prompt-editor">
              {!draft ? (
                <EmptyState
                  icon="code"
                  title="첫 Jev 판단을 추가하세요"
                  description="하나의 프롬프트에서 여러 태그를 결과 항목으로 사용할 수 있습니다."
                  action={
                    <button
                      className="button button-primary"
                      onClick={startNew}
                    >
                      <Icon name="plus" size={16} />첫 Jev 판단 만들기
                    </button>
                  }
                />
              ) : (
                <>
                  <div className="editor-detail-header">
                    <div>
                      <h2>{draft.id ? "Jev 판단 편집" : "새 Jev 판단"}</h2>
                      <p className="tag-detail-scope">
                        {dirty ? "저장되지 않은 변경" : "저장된 설정"} · 현재
                        트리 버전에만 적용
                      </p>
                    </div>
                    <button
                      className="button button-primary"
                      onClick={() => void save()}
                      disabled={pending || !dirty || invalid}
                    >
                      <Icon name="save" size={16} />
                      판단 저장
                    </button>
                  </div>
                  <fieldset className="tag-fields" disabled={pending}>
                    <EnabledSetting
                      label="Jev 판단 사용"
                      checked={draft.enabled}
                      disabled={pending}
                      onChange={(enabled) => setDraft({ ...draft, enabled })}
                      description="이 판단의 사용 여부입니다. 꺼도 프롬프트와 결과 태그 연결은 유지됩니다. 사용 중인 결과 태그가 있어야 실행 대상이 됩니다."
                    />
                    <label>
                      <span>판단 이름</span>
                      <input
                        aria-label="Jev 판단 이름"
                        value={draft.name}
                        aria-invalid={nameInvalid}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })
                        }
                        placeholder="예: 비공개 기술 정보 판단"
                      />
                      <small>
                        {nameInvalid
                          ? "판단 이름은 1~80자로 입력하세요."
                          : "목록에서 구분할 수 있는 이름을 입력하세요."}
                      </small>
                    </label>
                    <label>
                      <span>Jev 판단 프롬프트</span>
                      <textarea
                        aria-label="Jev 판단 프롬프트"
                        aria-describedby="jev-setting-prompt-hint"
                        aria-invalid={promptLength > 12000}
                        rows={8}
                        value={draft.prompt}
                        onChange={(event) =>
                          setDraft({ ...draft, prompt: event.target.value })
                        }
                        placeholder={
                          "예: 입력 내용을 읽고 결과 태그별 관련도를 0~1 점수로 판단하세요.\n공개된 예시와 미공개 자료를 문맥에 따라 구분하세요."
                        }
                      />
                      <small
                        id="jev-setting-prompt-hint"
                        className={promptLength > 12000 ? "danger-text" : ""}
                      >
                        {formatNumber(promptLength)} / 12,000자
                        {promptLength > 12000
                          ? " · 길이를 줄여 주세요"
                          : " · 빈 값은 판단 기준 미설정"}
                      </small>
                    </label>
                  </fieldset>
                  <div className="jev-output-heading">
                    <div>
                      <h3>결과 항목 · 태그</h3>
                      <p>
                        선택한 태그가 이 판단의 결과 항목이 됩니다. 새 태그는
                        트리 초안에서 추가하세요.
                      </p>
                    </div>
                    <span>{draft.tagIds.length}개 선택</span>
                  </div>
                  <p className="jev-threshold-note">
                    임계값은 0~1 점수이며 비우면 미설정입니다. 같은 버전의 다른
                    Jev 판단에서도 해당 태그의 임계값을 함께 사용합니다.
                  </p>
                  {tree.length ? (
                    <>
                      <label className="jev-tag-search">
                        <span className="sr-only">결과 태그 검색</span>
                        <input
                          aria-label="결과 태그 검색"
                          type="search"
                          value={tagSearch}
                          onChange={(event) => setTagSearch(event.target.value)}
                          placeholder="태그 이름 또는 ID 검색"
                        />
                      </label>
                      <div className="jev-output-columns" aria-hidden="true">
                        <span>결과 태그</span>
                        <span>점수 임계값</span>
                      </div>
                      <div className="jev-output-list">
                        {visibleTags.map((tag) => {
                          const checked = draft.tagIds.includes(tag.id);
                          const value = draft.thresholds[tag.id] ?? "";
                          const thresholdError = checked
                            ? badThresholds[tag.id]
                              ? "0~1 사이의 숫자를 입력하세요."
                              : jevThresholdError(value)
                            : null;
                          return (
                            <div className="jev-output-row" key={tag.id}>
                              <div className="jev-output-identity">
                                <label className="jev-output-tag">
                                  <input
                                    type="checkbox"
                                    aria-label={`${tag.name} 결과 태그`}
                                    checked={checked}
                                    disabled={pending}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        tagIds: event.target.checked
                                          ? [...draft.tagIds, tag.id]
                                          : draft.tagIds.filter(
                                              (id) => id !== tag.id,
                                            ),
                                      })
                                    }
                                  />
                                  <span>
                                    <strong>{tag.name}</strong>
                                    {!tag.enabled && (
                                      <small className="usage-badge">
                                        사용 안 함
                                      </small>
                                    )}
                                    <small>
                                      {tag.depth ? "하위 태그 · " : ""}
                                      {tag.id}
                                    </small>
                                  </span>
                                </label>
                                <Link
                                  className="jev-tag-detail-link"
                                  aria-label={`${tag.name} 태그 설정`}
                                  to={`${metricPath}&tagId=${encodeURIComponent(tag.id)}`}
                                >
                                  태그 설정
                                  <Icon name="arrow" size={12} />
                                </Link>
                              </div>
                              <div className="jev-output-threshold">
                                <input
                                  type="number"
                                  min={0}
                                  max={1}
                                  step="0.000001"
                                  aria-label={`${tag.name} 임계값`}
                                  aria-invalid={!!thresholdError}
                                  aria-describedby={
                                    thresholdError
                                      ? `jev-threshold-${tag.id}`
                                      : undefined
                                  }
                                  disabled={!checked || pending}
                                  value={value}
                                  placeholder="미설정"
                                  onChange={(event) => {
                                    const badInput =
                                      event.currentTarget.validity.badInput;
                                    setBadThresholds((values) => ({
                                      ...values,
                                      [tag.id]: badInput,
                                    }));
                                    setDraft({
                                      ...draft,
                                      thresholds: {
                                        ...draft.thresholds,
                                        [tag.id]: event.target.value,
                                      },
                                    });
                                  }}
                                />
                                {thresholdError && (
                                  <small
                                    className="danger-text"
                                    id={`jev-threshold-${tag.id}`}
                                  >
                                    {thresholdError}
                                  </small>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {!visibleTags.length && (
                          <p className="jev-list-empty">
                            검색과 일치하는 태그가 없습니다.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      icon="tree"
                      title="연결할 태그가 없습니다"
                      description="메트릭 설정에서 태그를 먼저 추가하세요. 발행된 트리라면 초안으로 복제할 수 있습니다."
                      action={
                        <Link className="text-link" to={metricPath}>
                          결과 태그 만들기
                          <Icon name="arrow" size={14} />
                        </Link>
                      }
                    />
                  )}
                  <div className="jev-editor-footer">
                    <Link className="text-link" to={metricPath}>
                      트리에서 태그·임계값 관리
                      <Icon name="arrow" size={14} />
                    </Link>
                    {draft.id && (
                      <button
                        className="text-button danger-text"
                        disabled={pending}
                        onClick={() => void remove()}
                      >
                        <Icon name="trash" size={14} />
                        판단 삭제
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
          <p className="editor-bottom">
            <span>
              <Icon name="info" size={15} />
              연결된 분류기가 활성 버전의 프롬프트·결과 태그·임계값을 조회해
              사용합니다.
            </span>
          </p>
        </>
      )}
    </>
  );
}
