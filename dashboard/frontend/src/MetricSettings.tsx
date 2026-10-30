import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useResource } from "./hooks";
import { createId, descendantIds, flattenTree, formatDateTime } from "./format";
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
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<"tags" | "policies">("tags");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (r.data) {
      setVersion(r.data);
      setDirty(false);
      setError("");
      setSelected((previous) =>
        r.data!.tags.some((t) => t.id === previous) ||
        r.data!.policyStates.some((p) => p.id === previous)
          ? previous
          : (tab === "policies"
              ? r.data!.policyStates[0]?.id
              : flattenTree(r.data!.tags)[0]?.id) || "",
      );
    } else {
      setVersion(null);
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
        !window.confirm("저장하지 않은 초안 변경을 버리고 이동할까요?")
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
  const policy = version?.policyStates.find((p) => p.id === selected);
  const change = (value: ConfigVersion) => {
    setVersion(value);
    setDirty(true);
    setNotice("");
    setError("");
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
    !dirty || window.confirm("저장하지 않은 초안 변경을 버릴까요?");
  async function perform(
    action: () => Promise<ConfigVersion>,
    message: string,
  ) {
    setPending(true);
    setError("");
    try {
      const next = await action();
      setVersion(next);
      setDirty(false);
      setNotice(message);
      ws.reload();
      if (next.id !== versionId) setParams({ versionId: next.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
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
          description: "",
          examples: [],
          guidance: "",
          color: "#5776c6",
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
          color: "#648a83",
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
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
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
        description="태그를 트리로 구성하고, 발행한 버전을 분류기와 공유하세요."
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
                    disabled={pending || !dirty}
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
                  disabled={pending || version.isActive}
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
                  "발행된 버전은 복제해서 수정할 수 있습니다."
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
                    </div>
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
                  </div>
                  <fieldset
                    disabled={!editable || pending}
                    className="tag-fields"
                  >
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
                    </label>
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
              분류기는 활성 버전의 설정만 읽습니다. 초안 변경은 수집에 영향을
              주지 않습니다.
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
            description="활성 설정의 태그 ID와 판단 참고사항을 읽고, 해당 버전으로 결과를 전송하세요."
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
