import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "./api";
import { regexReason, useSkippedRegex } from "./SkippedRegex";
import { EnabledSetting } from "./EnabledSetting";
import { parseJevThreshold, jevThresholdError } from "./jev";
import { useResource } from "./hooks";
import {
  compareTagOrder,
  createId,
  descendantIds,
  flattenTree,
  formatDateTime,
  formatNumber,
} from "./format";
import type { ConfigVersion, PolicyDefinition, Tag } from "./types";
import {
  Icon,
  PageTitle,
  Panel,
  EmptyState,
  ErrorState,
  LoadingState,
  VersionBadge,
  useWorkspace,
} from "./ui";

function tagDetails(tag: Tag) {
  return {
    name: tag.name,
    enabled: tag.enabled,
    description: tag.description,
    examples: tag.examples,
    guidance: tag.guidance,
    jevThreshold: tag.jevThreshold ?? null,
    pythonRegex: tag.pythonRegex || "",
    color: tag.color,
  };
}

function editableContent(version: ConfigVersion) {
  return JSON.stringify({
    name: version.name,
    tags: version.tags
      .map((tag) => ({
        id: tag.id,
        parentId: tag.parentId,
        order: tag.order,
        ...tagDetails(tag),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    policyStates: [...version.policyStates].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });
}

export function MetricSettings() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const versionId =
    params.get("versionId") ||
    ws.versions.find((v) => v.isActive)?.id ||
    ws.versions[0]?.id ||
    "";
  const r = useResource(
    (signal) =>
      versionId ? api.version(versionId, signal) : Promise.resolve(null),
    [versionId],
  );
  const [version, setVersion] = useState<ConfigVersion | null>(null);
  const [savedVersion, setSavedVersion] = useState<ConfigVersion | null>(null);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<"tags" | "policies">("tags");
  const [contentDirty, setDirty] = useState(false);
  const [thresholdTexts, setThresholdTexts] = useState<Record<string, string>>(
    {},
  );
  const [badThresholds, setBadThresholds] = useState<Record<string, boolean>>(
    {},
  );
  const hasInvalidThresholds = !!version?.tags.some(
    (item) =>
      badThresholds[item.id] ||
      (thresholdTexts[item.id] !== undefined &&
        parseJevThreshold(thresholdTexts[item.id]) === undefined),
  );
  const dirty = contentDirty || hasInvalidThresholds;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const skipped = useSkippedRegex(`${versionId}:${version?.revision ?? ""}`);
  const skippedRules =
    skipped.data?.status.version_id === versionId
      ? skipped.data?.status.skipped_regex ?? {}
      : {};
  useEffect(() => {
    setThresholdTexts({});
    setBadThresholds({});
    if (r.data) {
      setVersion(r.data);
      setSavedVersion(r.data);
      setDirty(false);
      setError("");
      setFieldErrors({});
      setSelected((previous) =>
        params.get("tagId") &&
        r.data!.tags.some((t) => t.id === params.get("tagId"))
          ? params.get("tagId")!
          : r.data!.tags.some((t) => t.id === previous) ||
              r.data!.policyStates.some((p) => p.id === previous)
            ? previous
            : (tab === "policies"
                ? r.data!.policyStates[0]?.id
                : flattenTree(r.data!.tags)[0]?.id) || "",
      );
    } else {
      setVersion(null);
      setSavedVersion(null);
      setDirty(false);
      setSelected("");
    }
  }, [r.data, versionId]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const linkGuard = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]");
      if (
        anchor &&
        !(anchor as HTMLAnchorElement).target &&
        !window.confirm("저장하지 않은 변경을 버리고 이동할까요?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", linkGuard, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", linkGuard, true);
    };
  }, [dirty]);
  const editable = version?.status === "DRAFT";
  const tag = version?.tags.find((t) => t.id === selected);
  const savedTag = savedVersion?.tags.find((t) => t.id === selected);
  const tagDetailsDirty =
    !!tag &&
    !!savedTag &&
    JSON.stringify(tagDetails(tag)) !== JSON.stringify(tagDetails(savedTag));
  const thresholdText = tag
    ? (thresholdTexts[tag.id] ??
      (tag.jevThreshold == null ? "" : String(tag.jevThreshold)))
    : "";
  const thresholdError =
    tag && badThresholds[tag.id]
      ? "0~1 사이의 숫자를 입력하세요."
      : jevThresholdError(thresholdText);
  const pythonRegexLength = Array.from(tag?.pythonRegex || "").length;
  const pythonRegexError = tag
    ? fieldErrors[`tags.${tag.id}.pythonRegex`]
    : undefined;
  const policy = version?.policyStates.find((p) => p.id === selected);
  const change = (value: ConfigVersion) => {
    setVersion(value);
    setDirty(
      !savedVersion || editableContent(value) !== editableContent(savedVersion),
    );
    setNotice("");
    setError("");
    setFieldErrors({});
  };
  const patchTag = (patch: Partial<Tag>) => {
    if (version && tag)
      change({
        ...version,
        tags: version.tags.map((t) =>
          t.id === tag.id ? { ...t, ...patch } : t,
        ),
      });
  };
  const patchPolicy = (patch: Partial<PolicyDefinition>) => {
    if (version && policy)
      change({
        ...version,
        policyStates: version.policyStates.map((p) =>
          p.id === policy.id ? { ...p, ...patch } : p,
        ),
      });
  };
  const canLeave = () =>
    !dirty || window.confirm("저장하지 않은 변경을 버릴까요?");
  function saveError(error: unknown, fallback: string) {
    const fields = error instanceof ApiError ? error.fieldErrors ?? {} : {};
    setFieldErrors(fields);
    const details = Object.entries(fields).map(([field, message]) => {
      const item = version?.tags.find(
        (tag) => field === `tags.${tag.id}.pythonRegex`,
      );
      return `${item?.name ?? field}: ${message}`;
    });
    setError(
      [error instanceof Error ? error.message : fallback, ...details].join(" · "),
    );
  }
  async function perform(
    action: () => Promise<ConfigVersion>,
    message: string,
  ) {
    setPending(true);
    setError("");
    setFieldErrors({});
    try {
      const next = await action();
      setVersion(next);
      setSavedVersion(next);
      setThresholdTexts({});
      setBadThresholds({});
      setDirty(false);
      setNotice(message);
      ws.reload();
      if (next.id !== versionId) setParams({ versionId: next.id });
    } catch (e) {
      saveError(e, "요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function saveTagDetails() {
    if (!version || !tag || !savedTag || pending || thresholdError) return;
    setPending(true);
    setError("");
    setFieldErrors({});
    setNotice("");
    try {
      const next = await api.saveTagDetails(version.id, tag.id, {
        revision: version.revision,
        ...tagDetails(tag),
        examples: tag.examples.filter((example) => example.trim()),
      });
      const updatedTag = next.tags.find((item) => item.id === tag.id)!;
      // A detail save must not discard edits to another tag or the draft's structure/policies.
      const merged: ConfigVersion = {
        ...next,
        name: version.name,
        tags: version.tags.map((item) =>
          item.id === tag.id ? { ...item, ...tagDetails(updatedTag) } : item,
        ),
        policyStates: version.policyStates,
      };
      setSavedVersion(next);
      setThresholdTexts((values) => {
        const next = { ...values };
        delete next[tag.id];
        return next;
      });
      setBadThresholds((values) => {
        const next = { ...values };
        delete next[tag.id];
        return next;
      });
      setVersion(merged);
      setDirty(editableContent(merged) !== editableContent(next));
      setNotice(
        "태그 세부 정보를 저장했습니다. 선택한 트리 버전에만 적용됩니다.",
      );
      ws.reload();
    } catch (e) {
      saveError(e, "세부 정보를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  function create(clone = false) {
    if (!canLeave()) return;
    void perform(
      () =>
        api.createVersion({
          name:
            clone && version
              ? Array.from(version.name).slice(0, 77).join("") + " 복사"
              : "새 메트릭 버전",
          ...(clone && version ? { baseVersionId: version.id } : {}),
        }),
      "초안을 만들었습니다. 태그와 정책 상태를 편집한 뒤 저장하세요.",
    );
  }
  function addTag(child = false) {
    if (!version || !editable) return;
    const parentId = child && tag ? tag.id : null;
    const id = createId("tag");
    change({
      ...version,
      tags: [
        ...version.tags,
        {
          id,
          name: "새 태그",
          enabled: true,
          description: "",
          examples: [],
          guidance: "",
          jevThreshold: null,
          pythonRegex: "",
          color: "#3B82F6",
          parentId,
          order: version.tags.filter((t) => t.parentId === parentId).length,
        },
      ],
    });
    setSelected(id);
    setTab("tags");
    setSearch("");
    if (parentId)
      setCollapsed((previous) => {
        const n = new Set(previous);
        n.delete(parentId);
        return n;
      });
  }
  function addPolicy() {
    if (!version || !editable) return;
    const id = createId("policy");
    change({
      ...version,
      policyStates: [
        ...version.policyStates,
        {
          id,
          name: "새 정책 상태",
          description: "",
          color: "#10B981",
          order: version.policyStates.length,
        },
      ],
    });
    setTab("policies");
    setSelected(id);
  }
  function remove() {
    if (!version || !editable) return;
    if (tab === "tags" && tag) {
      change({
        ...version,
        tags: version.tags
          .filter((t) => t.id !== tag.id)
          .map((t) =>
            t.parentId === tag.id ? { ...t, parentId: tag.parentId } : t,
          ),
      });
      setSelected("");
    } else if (policy) {
      change({
        ...version,
        policyStates: version.policyStates.filter((p) => p.id !== policy.id),
      });
      setSelected("");
    }
  }
  function reorder(direction: number) {
    if (!version) return;
    if (tab === "tags" && tag) {
      const siblings = version.tags
        .filter((t) => t.parentId === tag.parentId)
        .sort(compareTagOrder);
      const index = siblings.findIndex((t) => t.id === tag.id);
      const target = index + direction;
      if (target < 0 || target >= siblings.length) return;
      [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
      const orders = new Map(siblings.map((t, i) => [t.id, i]));
      change({
        ...version,
        tags: version.tags.map((t) =>
          orders.has(t.id) ? { ...t, order: orders.get(t.id)! } : t,
        ),
      });
    } else if (policy) {
      const rows = [...version.policyStates].sort((a, b) => a.order - b.order);
      const i = rows.findIndex((p) => p.id === policy.id);
      const next = i + direction;
      if (next < 0 || next >= rows.length) return;
      [rows[i], rows[next]] = [rows[next], rows[i]];
      change({
        ...version,
        policyStates: rows.map((p, i) => ({ ...p, order: i })),
      });
    }
  }
  async function deleteDraft() {
    if (
      !version ||
      !window.confirm(
        "이 초안을 삭제할까요? 발행된 버전과 수집 기록은 유지됩니다.",
      )
    )
      return;
    setPending(true);
    try {
      await api.deleteVersion(version.id);
      setVersion(null);
      setSavedVersion(null);
      setDirty(false);
      setParams({});
      ws.reload();
      setNotice("초안을 삭제했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  const flat = version ? flattenTree(version.tags) : [];
  const forbidden = new Set(
    tag && version ? descendantIds(version.tags, tag.id) : [],
  );
  const visible = flat.filter((t) => {
    if (search)
      return (
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase())
      );
    let parent = t.parentId;
    while (parent) {
      if (collapsed.has(parent)) return false;
      parent = version?.tags.find((p) => p.id === parent)?.parentId || null;
    }
    return true;
  });
  return (
    <>
      <PageTitle
        title="메트릭 설정"
        description="태그 트리는 버전으로 관리하고, 세부 정보는 각 버전에서 수정하세요."
        action={
          <button
            className="button button-primary"
            onClick={() => create()}
            disabled={pending}
          >
            <Icon name="plus" size={16} />새 버전
          </button>
        }
      />
      {ws.error && <ErrorState message={ws.error} retry={ws.reload} />}
      {skipped.error && (
        <ErrorState message={skipped.error} retry={skipped.refresh} />
      )}
      <div className="version-workbar">
        <label>
          <span className="sr-only">설정 버전 선택</span>
          <select
            aria-label="설정 버전 선택"
            disabled={pending}
            value={versionId}
            onChange={(e) => {
              if (canLeave()) {
                setParams({ versionId: e.target.value });
                setNotice("");
              }
            }}
          >
            <option value="" disabled>
              버전을 선택하세요
            </option>
            {ws.versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ·{" "}
                {v.isActive ? "활성" : v.status === "DRAFT" ? "초안" : "발행됨"}
              </option>
            ))}
          </select>
        </label>
        {version && <VersionBadge version={version} />}
        <div className="version-actions">
          {version && (
            <>
              <button
                className="button"
                disabled={pending}
                onClick={() => create(true)}
              >
                <Icon name="copy" size={15} />
                복제
              </button>
              {editable ? (
                <>
                  <button
                    className="button"
                    disabled={pending || !dirty || hasInvalidThresholds}
                    onClick={() =>
                      perform(
                        () =>
                          api.saveVersion(version.id, {
                            revision: version.revision,
                            name: version.name,
                            tags: version.tags.map((t) => ({
                              ...t,
                              examples: t.examples.filter((s) => s.trim()),
                            })),
                            policyStates: version.policyStates,
                          }),
                        "초안을 저장했습니다.",
                      )
                    }
                  >
                    <Icon name="save" size={15} />
                    초안 저장
                  </button>
                  <button
                    className="button button-primary"
                    disabled={pending || dirty}
                    onClick={() =>
                      perform(
                        () => api.publishVersion(version.id, version.revision),
                        "버전을 발행했습니다. 활성화하면 분류기에 제공됩니다.",
                      )
                    }
                  >
                    <Icon name="check" size={15} />
                    발행
                  </button>
                </>
              ) : (
                <button
                  className="button button-primary"
                  disabled={pending || dirty || version.isActive}
                  onClick={() =>
                    perform(
                      () => api.activateVersion(version.id),
                      "활성 버전을 변경했습니다. 분류기는 새 설정을 읽어야 합니다.",
                    )
                  }
                >
                  <Icon name="check" size={15} />
                  {version.isActive ? "활성 버전" : "활성화"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="editor-error">
          <ErrorState message={error} />
          <button
            className="text-button"
            onClick={() => {
              if (canLeave()) r.refresh();
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
      {r.error ? (
        <ErrorState message={r.error} retry={r.refresh} />
      ) : ws.loading || (r.loading && !r.data) ? (
        <LoadingState />
      ) : !version ? (
        <Panel title="나만의 첫 메트릭 트리">
          <EmptyState
            icon="tree"
            title="아직 설정된 메트릭이 없습니다"
            description="빈 버전에서 시작해 최상위 태그와 하위 태그, 정책 상태를 직접 만들어 보세요. 자동으로 추가되는 기본 항목은 없습니다."
            action={
              <button
                className="button button-primary"
                onClick={() => create()}
                disabled={pending}
              >
                <Icon name="plus" size={16} />첫 버전 만들기
              </button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="version-meta">
            <label>
              <span>버전 이름</span>
              <input
                aria-label="버전 이름"
                value={version.name}
                maxLength={80}
                onChange={(e) => change({ ...version, name: e.target.value })}
                disabled={!editable || pending}
              />
            </label>
            <div className="version-meta-info">
              <span>
                {version.tags.length}개 태그 · {version.policyStates.length}개
                정책 상태
              </span>
              <span>
                {dirty ? (
                  <strong className="unsaved-label">저장되지 않은 변경</strong>
                ) : editable ? (
                  "저장된 초안"
                ) : (
                  "발행된 트리 · 태그 세부 정보는 수정 가능"
                )}
              </span>
            </div>
            <span className="version-timestamp">
              {formatDateTime(version.createdAt)} 생성
            </span>
          </div>
          <div className="metric-editor">
            <section className="editor-tree">
              <div className="editor-tabs">
                <button
                  className={tab === "tags" ? "active" : ""}
                  onClick={() => {
                    setTab("tags");
                    setSelected(flattenTree(version.tags)[0]?.id || "");
                  }}
                >
                  메트릭 태그 <span>{version.tags.length}</span>
                </button>
                <button
                  className={tab === "policies" ? "active" : ""}
                  onClick={() => {
                    setTab("policies");
                    setSelected(version.policyStates[0]?.id || "");
                  }}
                >
                  정책 상태 <span>{version.policyStates.length}</span>
                </button>
              </div>
              <div className="editor-tree-tools">
                <input
                  aria-label="태그 검색"
                  placeholder={
                    tab === "tags" ? "태그 이름 검색" : "정책 상태 검색"
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="button button-small"
                  title={tab === "tags" ? "최상위 태그 추가" : "정책 상태 추가"}
                  aria-label={
                    tab === "tags" ? "최상위 태그 추가" : "정책 상태 추가"
                  }
                  disabled={!editable || pending}
                  onClick={() => (tab === "tags" ? addTag() : addPolicy())}
                >
                  <Icon name="plus" size={17} />
                </button>
              </div>
              <div
                className="editor-tree-body"
                role="group"
                aria-label={
                  tab === "tags" ? "메트릭 태그 트리" : "정책 상태 목록"
                }
              >
                {tab === "tags"
                  ? visible.map((t) => {
                      const hasChild = version.tags.some(
                        (x) => x.parentId === t.id,
                      );
                      return (
                        <div
                          className={
                            "editor-tree-row " +
                            (selected === t.id ? "selected" : "")
                          }
                          style={{
                            paddingLeft: 10 + Math.min(t.depth, 8) * 17,
                          }}
                          key={t.id}
                        >
                          <button
                            className={
                              "tree-chevron " +
                              (!collapsed.has(t.id) ? "expanded" : "")
                            }
                            aria-label={
                              t.name +
                              (collapsed.has(t.id) ? " 펼치기" : " 접기")
                            }
                            aria-expanded={
                              hasChild ? !collapsed.has(t.id) : undefined
                            }
                            disabled={!hasChild}
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.id)) next.delete(t.id);
                                else next.add(t.id);
                                return next;
                              })
                            }
                          >
                            <Icon name="chevron" size={12} />
                          </button>
                          <button
                            className="editor-node"
                            onClick={() => setSelected(t.id)}
                            aria-pressed={selected === t.id}
                          >
                            <span
                              className="tag-dot"
                              style={{ background: t.color }}
                            />
                            <span>{t.name || "이름 없는 태그"}</span>
                            {skippedRules[t.id] && (
                              <small
                                className="usage-badge"
                                title={regexReason(skippedRules[t.id])}
                              >
                                정규식 건너뜀
                              </small>
                            )}
                            {!t.enabled && (
                              <small className="usage-badge">사용 안 함</small>
                            )}
                          </button>
                        </div>
                      );
                    })
                  : version.policyStates
                      .filter((p) => p.name.includes(search))
                      .sort((a, b) => a.order - b.order)
                      .map((p) => (
                        <button
                          key={p.id}
                          className={
                            "policy-editor-node " +
                            (selected === p.id ? "selected" : "")
                          }
                          onClick={() => setSelected(p.id)}
                        >
                          <span
                            className="tag-dot"
                            style={{ background: p.color }}
                          />
                          {p.name}
                        </button>
                      ))}
                {(tab === "tags"
                  ? !visible.length
                  : !version.policyStates.length) && (
                  <div className="editor-no-items">
                    <Icon
                      name={tab === "tags" ? "tree" : "settings"}
                      size={23}
                    />
                    <p>
                      {search
                        ? "검색 결과가 없습니다."
                        : "아직 항목이 없습니다."}
                    </p>
                    {editable && !search && (
                      <button
                        className="text-link text-button"
                        onClick={() =>
                          tab === "tags" ? addTag() : addPolicy()
                        }
                      >
                        첫 항목 추가
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="tree-help">
                <Icon name="info" size={14} />
                <p>
                  모든 노드는 메트릭 태그입니다. 상위 노드에서 자신과 하위
                  태그를 함께 집계합니다.
                </p>
              </div>
            </section>
            <section className="editor-detail">
              {tab === "tags" && tag ? (
                <>
                  <div className="editor-detail-header">
                    <div>
                      <h2>{tag.name || "이름 없는 태그"}</h2>
                      <p className="tag-detail-scope">
                        {version.isActive
                          ? "이 버전의 세부 정보만 수정합니다. 저장하면 활성 분류 설정에 반영됩니다."
                          : "이 트리 버전의 세부 정보만 수정합니다. 다른 버전에는 적용되지 않습니다."}
                      </p>
                    </div>
                    <div className="editor-detail-actions">
                      {editable && (
                        <button
                          className="button"
                          disabled={pending}
                          onClick={() => addTag(true)}
                        >
                          <Icon name="plus" size={15} />
                          하위 태그
                        </button>
                      )}
                      <button
                        className="button button-primary"
                        disabled={
                          pending || !tagDetailsDirty || !!thresholdError
                        }
                        onClick={() => void saveTagDetails()}
                      >
                        <Icon name="save" size={15} />
                        세부 정보 저장
                      </button>
                    </div>
                  </div>
                  {!savedTag && (
                    <p className="new-tag-save-note">
                      새 태그의 내용은 ‘초안 저장’으로 함께 저장하세요.
                    </p>
                  )}
                  <fieldset disabled={pending} className="tag-fields">
                    <EnabledSetting
                      label="태그 사용"
                      checked={tag.enabled}
                      disabled={pending}
                      onChange={(enabled) => patchTag({ enabled })}
                      description="이 태그의 정규식과 Jev 결과 사용 여부입니다. 상위·하위 태그는 각각의 설정을 따르며, 꺼도 세부 정보와 기존 기록은 유지됩니다."
                    />
                    <div className="field-pair">
                      <label>
                        <span>태그 이름</span>
                        <input
                          aria-label="태그 이름"
                          value={tag.name}
                          maxLength={80}
                          onChange={(e) => patchTag({ name: e.target.value })}
                        />
                      </label>
                      <label className="color-field">
                        <span>표시 색상</span>
                        <span>
                          <input
                            aria-label="태그 색상"
                            type="color"
                            value={tag.color}
                            onChange={(e) =>
                              patchTag({ color: e.target.value })
                            }
                          />
                          <code>{tag.color}</code>
                        </span>
                      </label>
                    </div>
                    <label>
                      <span>상위 태그</span>
                      <select
                        aria-label="상위 태그"
                        disabled={!editable || pending}
                        value={tag.parentId || ""}
                        onChange={(e) =>
                          patchTag({
                            parentId: e.target.value || null,
                            order: version.tags.filter(
                              (t) => t.parentId === (e.target.value || null),
                            ).length,
                          })
                        }
                      >
                        <option value="">최상위</option>
                        {flat
                          .filter((t) => !forbidden.has(t.id))
                          .map((t) => (
                            <option value={t.id} key={t.id}>
                              {"　".repeat(t.depth) + t.name}
                            </option>
                          ))}
                      </select>
                      {!editable && (
                        <small>
                          발행된 트리 구조입니다. 부모나 순서를 바꾸려면
                          복제하세요.
                        </small>
                      )}
                    </label>
                    <div className="jev-tag-threshold-field">
                      <label>
                        <span>
                          Jev 임계값 <small>선택</small>
                        </span>
                        <input
                          type="number"
                          aria-label="Jev 임계값"
                          min={0}
                          max={1}
                          step="0.000001"
                          placeholder="미설정"
                          value={thresholdText}
                          aria-invalid={!!thresholdError}
                          aria-describedby="tag-jev-threshold-help"
                          onChange={(event) => {
                            const value = event.target.value;
                            const badInput =
                              event.currentTarget.validity.badInput;
                            setThresholdTexts((values) => ({
                              ...values,
                              [tag.id]: value,
                            }));
                            setBadThresholds((values) => ({
                              ...values,
                              [tag.id]: badInput,
                            }));
                            const parsed = parseJevThreshold(value);
                            if (!badInput && parsed !== undefined)
                              patchTag({ jevThreshold: parsed });
                          }}
                        />
                        <small
                          id="tag-jev-threshold-help"
                          className={thresholdError ? "danger-text" : ""}
                        >
                          {thresholdError ||
                            "0~1 사이, 소수점 최대 6자리. 비우면 미설정입니다. 같은 버전의 Jev 판단들이 이 태그의 임계값을 함께 사용합니다."}
                        </small>
                      </label>
                      <Link
                        className="text-link"
                        to={`/settings/jev?versionId=${encodeURIComponent(version.id)}`}
                      >
                        Jev 판단 프롬프트 설정
                        <Icon name="arrow" size={14} />
                      </Link>
                    </div>
                    <div className="python-regex-field">
                      {skippedRules[tag.id] && (
                        <p className="guard-warning" role="alert">
                          {tag.name} 정규식이 검사에서 건너뛰어졌습니다.{" "}
                          {regexReason(skippedRules[tag.id])}
                        </p>
                      )}
                      <label>
                        <span>
                          Python 정규식 <small>선택</small>
                        </span>
                        <span className="tag-rule-hint" id="python-regex-help">
                          Python re 문법으로 작성하세요. 검사 서버가 연결되어
                          있으면 저장 전에 서버 기준으로 검증합니다.
                        </span>
                        <textarea
                          aria-label="Python 정규식"
                          aria-describedby={
                            "python-regex-help python-regex-scope python-regex-count" +
                            (pythonRegexError ? " python-regex-error" : "")
                          }
                          aria-invalid={pythonRegexLength > 4000 || !!pythonRegexError}
                          rows={3}
                          spellCheck={false}
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={tag.pythonRegex || ""}
                          placeholder={"(?i)\\b(?:internal|confidential)\\b"}
                          onChange={(e) =>
                            patchTag({ pythonRegex: e.target.value })
                          }
                        />
                        {pythonRegexError && (
                          <small id="python-regex-error" className="field-error">
                            {pythonRegexError}
                          </small>
                        )}
                      </label>
                      <div className="tag-rule-footer">
                        <span id="python-regex-scope">
                          각 태그의 정규식은 독립적으로 저장됩니다.
                        </span>
                        <span
                          id="python-regex-count"
                          className={
                            pythonRegexLength > 4000 ? "danger-text" : ""
                          }
                        >
                          {formatNumber(pythonRegexLength)} / 4,000자
                          {pythonRegexLength > 4000 && " · 길이를 줄여 주세요"}
                        </span>
                      </div>
                    </div>
                    <label>
                      <span>설명</span>
                      <textarea
                        aria-label="태그 설명"
                        rows={2}
                        value={tag.description}
                        maxLength={4000}
                        placeholder="어떤 정보를 나타내는 태그인지 설명하세요."
                        onChange={(e) =>
                          patchTag({ description: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>
                        예시 <small>줄마다 하나씩 입력</small>
                      </span>
                      <textarea
                        aria-label="태그 예시"
                        rows={3}
                        value={tag.examples.join("\n")}
                        placeholder={"예: 비공개 Repository\n핵심 알고리즘"}
                        onChange={(e) =>
                          patchTag({ examples: e.target.value.split("\n") })
                        }
                      />
                    </label>
                    <label>
                      <span>판단 참고사항</span>
                      <textarea
                        aria-label="판단 참고사항"
                        rows={3}
                        value={tag.guidance}
                        maxLength={4000}
                        placeholder="분류기가 판단할 때 확인해야 하는 맥락이나 기준"
                        onChange={(e) => patchTag({ guidance: e.target.value })}
                      />
                    </label>
                  </fieldset>
                  <div className="tag-id-box">
                    <span>태그 ID · 분류기 연동에 사용</span>
                    <code>{tag.id}</code>
                  </div>
                </>
              ) : tab === "policies" && policy ? (
                <>
                  <div className="editor-detail-header">
                    <div>
                      <h2>{policy.name || "이름 없는 정책 상태"}</h2>
                    </div>
                  </div>
                  <fieldset
                    disabled={!editable || pending}
                    className="tag-fields"
                  >
                    <div className="field-pair">
                      <label>
                        <span>정책 상태 이름</span>
                        <input
                          aria-label="정책 상태 이름"
                          value={policy.name}
                          maxLength={80}
                          onChange={(e) =>
                            patchPolicy({ name: e.target.value })
                          }
                        />
                      </label>
                      <label className="color-field">
                        <span>표시 색상</span>
                        <span>
                          <input
                            type="color"
                            aria-label="정책 색상"
                            value={policy.color}
                            onChange={(e) =>
                              patchPolicy({ color: e.target.value })
                            }
                          />
                          <code>{policy.color}</code>
                        </span>
                      </label>
                    </div>
                    <label>
                      <span>설명</span>
                      <textarea
                        aria-label="정책 설명"
                        rows={4}
                        maxLength={4000}
                        value={policy.description}
                        onChange={(e) =>
                          patchPolicy({ description: e.target.value })
                        }
                      />
                    </label>
                  </fieldset>
                  <div className="tag-id-box">
                    <span>정책 상태 ID · 분류기 연동에 사용</span>
                    <code>{policy.id}</code>
                  </div>
                </>
              ) : (
                <EmptyState
                  icon="tree"
                  title="편집할 항목을 선택하세요"
                  description="왼쪽에서 태그나 정책 상태를 선택하면 세부 내용을 확인할 수 있습니다."
                />
              )}
              {editable && (tab === "tags" ? tag : policy) && (
                <div className="editor-detail-footer">
                  <div>
                    <button
                      className="button button-small"
                      aria-label="위로 이동"
                      disabled={pending}
                      onClick={() => reorder(-1)}
                    >
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      className="button button-small"
                      aria-label="아래로 이동"
                      disabled={pending}
                      onClick={() => reorder(1)}
                    >
                      <Icon name="down" size={16} />
                    </button>
                    <span>같은 단계 안에서 순서 변경</span>
                  </div>
                  <button
                    className="text-button danger-text"
                    disabled={pending}
                    onClick={remove}
                  >
                    <Icon name="trash" size={14} />
                    항목 제거
                  </button>
                </div>
              )}
              {editable &&
                tab === "tags" &&
                tag &&
                version.tags.some((t) => t.parentId === tag.id) && (
                  <p className="remove-note">
                    이 항목을 제거하면 하위 태그는 한 단계 위로 이동합니다.
                  </p>
                )}
            </section>
          </div>
          <div className="editor-bottom">
            <span>
              <Icon name="info" size={15} />
              태그 세부 정보는 현재 버전에서 수정할 수 있습니다. 트리 구조와
              정책 상태 변경은 초안에서 저장·발행하세요.
            </span>
            {editable && (
              <button
                className="text-button danger-text"
                onClick={deleteDraft}
                disabled={pending}
              >
                초안 삭제
              </button>
            )}
          </div>
          <Panel
            title="분류기 연동"
            description="활성 설정의 Jev 판단·결과 태그·임계값·Python 정규식을 읽고, 해당 버전으로 결과를 전송하세요."
            className="api-panel"
          >
            <div className="api-links">
              <a
                href="/api/v1/classifier-config"
                target="_blank"
                rel="noreferrer"
              >
                <span className="method">GET</span>
                <code>/api/v1/classifier-config</code>
                <Icon name="arrow" size={15} />
              </a>
              <a href="/swagger-ui.html" target="_blank" rel="noreferrer">
                <Icon name="code" size={17} />
                Swagger에서 요청 형식 확인
                <Icon name="arrow" size={15} />
              </a>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
