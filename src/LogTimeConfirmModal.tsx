// Modal xác nhận log time dạng cây: Project › Issue cha › Task › Entry.
// Quy định: time entry chỉ được log vào một task lá (issue không có task con), không log thẳng vào project.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { Modal, Tree, Tag, Button, Select, Input, Space, Typography, Alert, Spin, Tooltip, message as antdMessage } from "antd";
import {
  FolderOutlined,
  PushpinOutlined,
  CheckCircleFilled,
  WarningFilled,
  StopFilled,
  RobotOutlined,
  PlusOutlined,
  CloseOutlined,
  UndoOutlined,
  EditOutlined,
} from "@ant-design/icons";
import type { Task } from "./aiService";
import { analyzeRedmineMapping, extractSearchQuery, type RedmineMatchSuggestion } from "./aiRedmineService";
import type { AiConfig } from "./aiClient";

const { Text } = Typography;

export interface LogEntryInput {
  date: string;
  task: Task;
}

type RowStatus = "loading" | "ok" | "needs_child" | "no_issue" | "invalid" | "logged" | "failed";

interface Row {
  key: string;
  date: string;
  task: Task;
  issueId?: number;
  issue?: any;
  children: any[];
  status: RowStatus;
  error?: string;
  ai?: RedmineMatchSuggestion;
  aiLoading?: boolean;
  newSubject: string;
  excluded: boolean;
}

interface Props {
  entries: LogEntryInput[];
  existingEntries: any[];
  aiConfig: AiConfig;
  redmineServer?: string;
  /** Project mặc định — chỉ dùng để thu hẹp phạm vi AI tìm task, không dùng làm đích log */
  defaultProject?: string;
  onCancel: () => void;
  onDone: () => void;
  onTaskIssueChange: (date: string, taskId: string, issueId: number, projectName?: string) => void;
}

const postJson = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
};

const issueLabel = (issue: any) => `#${issue.id} ${issue.subject || ""}`.trim();

const buildInitialRows = (entries: LogEntryInput[]): Row[] =>
  entries.map(({ date, task }) => {
    const day = dayjs(date).day();
    let error: string | undefined;
    if (day === 0 || day === 6) error = "Không được log vào Thứ Bảy/Chủ Nhật";
    else if (!(task.duration > 0)) error = "Số giờ phải lớn hơn 0";
    return {
      key: `${date}:${task.id}`,
      date,
      task,
      issueId: task.redmineIssue,
      children: [],
      status: error ? "invalid" : task.redmineIssue ? "loading" : "no_issue",
      error,
      newSubject: task.name,
      excluded: false,
    };
  });

export default function LogTimeConfirmModal({
  entries,
  existingEntries,
  aiConfig,
  redmineServer,
  defaultProject,
  onCancel,
  onDone,
  onTaskIssueChange,
}: Props) {
  const [initialRows] = useState(() => buildInitialRows(entries));
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [parentIssues, setParentIssues] = useState<Record<number, any>>({});
  const [projects, setProjects] = useState<Record<number, any>>({});
  const [isLogging, setIsLogging] = useState(false);
  const [searchOptions, setSearchOptions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const issueCache = useRef(new Map<number, any>());
  const myIssuesRef = useRef<any[] | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const fetchIssue = async (id: number, force = false) => {
    if (!force && issueCache.current.has(id)) return issueCache.current.get(id);
    const res = await fetch(`/api/redmine/issue?id=${id}`);
    const data = await res.json();
    if (!data || !data.id) throw new Error(data?.error || `Không tìm thấy issue #${id}`);
    issueCache.current.set(id, data);
    return data;
  };

  // Xác định trạng thái của một entry dựa trên issue đang gắn
  const resolveRow = async (key: string, issueId: number, force = false) => {
    patchRow(key, { status: "loading", issueId, error: undefined });
    try {
      const issue = await fetchIssue(issueId, force);
      if (issue.parent?.id) {
        const parent = await fetchIssue(issue.parent.id).catch(() => undefined);
        if (parent) setParentIssues((prev) => ({ ...prev, [parent.id]: parent }));
      }
      if (Array.isArray(issue.children) && issue.children.length > 0) {
        const children = await postJson("/api/redmine/search", { parent: issueId, status: "open", limit: 100 });
        patchRow(key, { status: "needs_child", issue, children: Array.isArray(children) ? children : [] });
      } else {
        patchRow(key, { status: "ok", issue, children: [] });
      }
      return issue;
    } catch (e: any) {
      patchRow(key, { status: "no_issue", issue: undefined, issueId: undefined, error: e.message });
    }
  };

  const runAiSuggestion = async (row: Row) => {
    patchRow(row.key, { aiLoading: true });
    try {
      if (!myIssuesRef.current) {
        const mine = await postJson("/api/redmine/search", { assignee: "me", status: "open" });
        myIssuesRef.current = Array.isArray(mine) ? mine : [];
      }
      const keyword = await extractSearchQuery(row.task.name, aiConfig);
      const found = await postJson("/api/redmine/search", {
        query: keyword,
        status: "open",
        project: row.task.redmineProject || defaultProject || undefined,
      });
      const candidates = [...myIssuesRef.current];
      (Array.isArray(found) ? found : []).forEach((c: any) => {
        if (!candidates.some((x) => x.id === c.id)) candidates.push(c);
      });
      const ai = await analyzeRedmineMapping(row.task.name, candidates, aiConfig);
      patchRow(row.key, { ai, aiLoading: false });
    } catch (e: any) {
      patchRow(row.key, { aiLoading: false, ai: { type: "none", confidence: "low", reason: `Lỗi AI: ${e.message}` } });
    }
  };

  // Tải dữ liệu khi mở modal (App chỉ mount modal lúc mở nên chạy một lần)
  useEffect(() => {
    fetch("/api/redmine/projects")
      .then((r) => r.json())
      .then((list) => {
        if (!Array.isArray(list)) return;
        const map: Record<number, any> = {};
        list.forEach((p: any) => (map[p.id] = p));
        setProjects(map);
      })
      .catch(() => undefined);

    (async () => {
      for (const row of initialRows) {
        if (row.status === "loading" && row.issueId) await resolveRow(row.key, row.issueId);
      }
      for (const row of initialRows) {
        if (row.status === "no_issue") await runAiSuggestion(row);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyIssue = async (row: Row, issueId: number) => {
    const issue = await resolveRow(row.key, issueId);
    if (issue) onTaskIssueChange(row.date, row.task.id, issue.id, issue.project?.name);
  };

  const createChildTask = async (row: Row, parent: { id: number; projectId?: number }, subject: string) => {
    if (!subject.trim()) {
      antdMessage.warning("Vui lòng nhập tên task con!");
      return;
    }
    const msgKey = `create-${row.key}`;
    antdMessage.loading({ content: `Đang tạo task con dưới #${parent.id}...`, key: msgKey });
    try {
      let projectId = parent.projectId;
      if (!projectId) projectId = (await fetchIssue(parent.id)).project?.id;
      const created = await postJson("/api/redmine/create-issue", {
        project: projectId,
        parent: parent.id,
        subject: subject.trim(),
        estimatedHours: row.task.duration || undefined,
      });
      if (!created?.id) throw new Error(created?.error || "Không tạo được task con");
      issueCache.current.delete(parent.id);
      antdMessage.success({ content: `Đã tạo task con #${created.id}`, key: msgKey });
      await applyIssue(row, created.id);
    } catch (e: any) {
      antdMessage.error({ content: e.message, key: msgKey });
    }
  };

  const handleSearch = (value: string) => {
    window.clearTimeout(searchTimer.current);
    if (!value.trim()) return;
    searchTimer.current = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const isId = /^#?\d+$/.test(value.trim());
        if (isId) {
          const issue = await fetchIssue(parseInt(value.replace("#", ""), 10)).catch(() => undefined);
          setSearchOptions(issue ? [issue] : []);
        } else {
          const found = await postJson("/api/redmine/search", { query: value.trim(), status: "open", limit: 20 });
          setSearchOptions(Array.isArray(found) ? found : []);
        }
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  const issueSelect = (row: Row, options: any[], placeholder: string) => (
    <Select
      size="small"
      showSearch
      allowClear
      placeholder={placeholder}
      style={{ minWidth: 280 }}
      filterOption={false}
      onSearch={options === searchOptions ? handleSearch : undefined}
      optionFilterProp="label"
      notFoundContent={isSearching ? <Spin size="small" /> : null}
      options={options.map((i: any) => ({
        value: i.id,
        label: `${issueLabel(i)}${i.project?.name ? ` · ${i.project.name}` : ""}`,
      }))}
      onChange={(id) => id && applyIssue(row, id)}
      onClick={(e) => e.stopPropagation()}
    />
  );

  // Tổng giờ theo ngày (đã log + sắp log)
  const dailyTotals = useMemo(() => {
    const totals: Record<string, { existing: number; pending: number }> = {};
    rows.forEach((r) => {
      if (!totals[r.date]) {
        const existing = existingEntries
          .filter((e) => e.spent_on === r.date)
          .reduce((s, e) => s + (Number(e.hours) || 0), 0);
        totals[r.date] = { existing, pending: 0 };
      }
      if (!r.excluded && r.status !== "logged") totals[r.date].pending += r.task.duration || 0;
    });
    return totals;
  }, [rows, existingEntries]);

  const isDuplicate = (r: Row) =>
    !!r.issueId &&
    existingEntries.some(
      (e) => e.spent_on === r.date && e.issue?.id === r.issueId && (e.comments || "") === (r.task.name || "")
    );

  const statusIcon = (r: Row) => {
    if (r.excluded) return <CloseOutlined style={{ color: "var(--text-secondary)" }} />;
    switch (r.status) {
      case "loading":
        return <Spin size="small" />;
      case "ok":
      case "logged":
        return <CheckCircleFilled style={{ color: "#52c41a" }} />;
      case "needs_child":
        return <WarningFilled style={{ color: "#faad14" }} />;
      default:
        return <StopFilled style={{ color: "#ff4d4f" }} />;
    }
  };

  const entryTitle = (r: Row): ReactNode => {
    const disabled = r.excluded || isLogging || r.status === "logged";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 0", opacity: r.excluded ? 0.5 : 1 }}>
        <Space size={6} wrap>
          {statusIcon(r)}
          <Tag color="blue">{dayjs(r.date).locale("vi").format("dd DD/MM")}</Tag>
          <Tag color="purple">{(r.task.duration || 0).toFixed(1)}h</Tag>
          <Text strong style={{ fontSize: 13 }}>{r.task.name}</Text>
          {r.status === "logged" && <Tag color="success">Đã log</Tag>}
          {r.status === "failed" && <Tag color="error">Lỗi: {r.error}</Tag>}
          {r.status === "invalid" && <Tag color="error">{r.error}</Tag>}
          {!r.excluded && isDuplicate(r) && r.status !== "logged" && (
            <Tooltip title="Ngày này đã có entry cùng task và nội dung trên Redmine">
              <Tag color="warning">Có thể trùng</Tag>
            </Tooltip>
          )}
          {r.status !== "logged" && (
            <Button
              size="small"
              type="text"
              icon={r.excluded ? <UndoOutlined /> : <CloseOutlined />}
              disabled={isLogging}
              onClick={() => patchRow(r.key, { excluded: !r.excluded })}
            >
              {r.excluded ? "Đưa lại" : "Bỏ qua"}
            </Button>
          )}
          {r.status === "ok" && !disabled && (
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => patchRow(r.key, { status: "no_issue", issue: undefined, issueId: undefined })}
            >
              Đổi task
            </Button>
          )}
        </Space>

        {!disabled && r.status === "needs_child" && r.issue && (
          <div style={{ paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
            <Text type="warning" style={{ fontSize: 12 }}>
              #{r.issue.id} có {r.issue.children?.length} task con — chọn task con hoặc tạo task con mới:
            </Text>
            <Space size={6} wrap>
              {issueSelect(r, r.children, r.children.length ? "Chọn task con đang mở..." : "Không có task con đang mở")}
              <Input
                size="small"
                style={{ width: 240 }}
                value={r.newSubject}
                onChange={(e) => patchRow(r.key, { newSubject: e.target.value })}
                placeholder="Tên task con mới"
              />
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => createChildTask(r, { id: r.issue.id, projectId: r.issue.project?.id }, r.newSubject)}
              >
                Tạo task con
              </Button>
            </Space>
          </div>
        )}

        {!disabled && r.status === "no_issue" && (
          <div style={{ paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4 }}>
            {r.error && <Text type="danger" style={{ fontSize: 12 }}>{r.error}</Text>}
            {r.aiLoading && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <Spin size="small" /> AI đang tìm task phù hợp...
              </Text>
            )}
            {r.ai && !r.aiLoading && (
              <Space size={6} wrap>
                <Tag icon={<RobotOutlined />} color={r.ai.type === "none" ? "default" : "geekblue"}>
                  AI ({r.ai.confidence})
                </Tag>
                {r.ai.type === "direct" && r.ai.issueId && (
                  <Button size="small" type="primary" ghost onClick={() => applyIssue(r, r.ai!.issueId!)}>
                    Dùng #{r.ai.issueId} {r.ai.issueSubject}
                  </Button>
                )}
                {r.ai.type === "subtask" && r.ai.parentIssueId && (
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<PlusOutlined />}
                    onClick={() => createChildTask(r, { id: r.ai!.parentIssueId! }, r.newSubject)}
                  >
                    Tạo task con "{r.newSubject}" dưới #{r.ai.parentIssueId} {r.ai.parentIssueSubject}
                  </Button>
                )}
                <Text type="secondary" style={{ fontSize: 12 }}>{r.ai.reason}</Text>
              </Space>
            )}
            <Space size={6} wrap>
              {issueSelect(r, searchOptions, "Tìm task theo tên hoặc #ID...")}
              {!r.aiLoading && (
                <Button size="small" icon={<RobotOutlined />} onClick={() => runAiSuggestion(r)}>
                  {r.ai ? "Gợi ý lại" : "AI gợi ý"}
                </Button>
              )}
            </Space>
          </div>
        )}
      </div>
    );
  };

  // Chuỗi project từ gốc tới project của issue
  const projectPath = (project: { id: number; name: string }) => {
    const path: { id: number; name: string }[] = [];
    let cur: any = projects[project.id] || project;
    const seen = new Set<number>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.unshift({ id: cur.id, name: cur.name });
      cur = cur.parent ? projects[cur.parent.id] || cur.parent : undefined;
    }
    return path;
  };

  const treeData = useMemo(() => {
    type Node = { key: string; title: ReactNode; children: Node[]; selectable?: boolean };
    const roots: Node[] = [];
    const getOrAdd = (list: Node[], key: string, title: ReactNode) => {
      let node = list.find((n) => n.key === key);
      if (!node) {
        node = { key, title, children: [] };
        list.push(node);
      }
      return node;
    };
    const issueLink = (issue: any) =>
      redmineServer ? (
        <a href={`${redmineServer.replace(/\/$/, "")}/issues/${issue.id}`} target="_blank" rel="noreferrer">
          #{issue.id}
        </a>
      ) : (
        `#${issue.id}`
      );
    const issueNodeTitle = (issue: any, isParent: boolean) => (
      <Space size={6}>
        <PushpinOutlined style={{ color: isParent ? "var(--text-secondary)" : "#1677ff" }} />
        {issueLink(issue)}
        <Text style={{ fontSize: 13 }}>{issue.subject}</Text>
        {issue.tracker?.name && <Tag style={{ fontSize: 11 }}>{issue.tracker.name}</Tag>}
        {isParent && <Text type="secondary" style={{ fontSize: 11 }}>(issue cha)</Text>}
      </Space>
    );

    const unassigned: Node = {
      key: "unassigned",
      title: (
        <Space size={6}>
          <StopFilled style={{ color: "#ff4d4f" }} />
          <Text strong type="danger">Chưa gắn task — cần chọn task trước khi log</Text>
        </Space>
      ),
      children: [],
    };

    rows.forEach((r) => {
      const leaf: Node = { key: `e-${r.key}`, title: entryTitle(r), children: [] };
      if (!r.issue || r.status === "no_issue" || r.status === "loading") {
        if (r.status === "loading") leaf.title = <Space size={6}><Spin size="small" /> {r.task.name} (đang tải #{r.issueId})</Space>;
        unassigned.children.push(leaf);
        return;
      }
      let level = roots;
      projectPath(r.issue.project).forEach((p) => {
        level = getOrAdd(level, `p-${p.id}`, (
          <Space size={6}>
            <FolderOutlined style={{ color: "#fa8c16" }} />
            <Text strong>{p.name}</Text>
          </Space>
        )).children;
      });
      const parentId = r.issue.parent?.id;
      if (parentId) {
        const parent = parentIssues[parentId] || { id: parentId, subject: "" };
        level = getOrAdd(level, `i-${parentId}`, issueNodeTitle(parent, true)).children;
      }
      getOrAdd(level, `i-${r.issue.id}`, issueNodeTitle(r.issue, r.status === "needs_child")).children.push(leaf);
    });

    return unassigned.children.length ? [unassigned, ...roots] : roots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, projects, parentIssues, isLogging, searchOptions, isSearching, existingEntries, redmineServer]);

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: any[]) => nodes.forEach((n) => { keys.push(n.key); walk(n.children || []); });
    walk(treeData);
    return keys;
  }, [treeData]);

  const pending = rows.filter((r) => !r.excluded && r.status !== "logged");
  const blocked = pending.filter((r) => r.status !== "ok");
  const pendingHours = pending.reduce((s, r) => s + (r.task.duration || 0), 0);
  const overDays = Object.entries(dailyTotals).filter(([, t]) => t.existing + t.pending > 8);

  const handleConfirm = async () => {
    setIsLogging(true);
    let ok = 0;
    let fail = 0;
    for (const r of pending) {
      try {
        const data = await postJson("/api/redmine/log", {
          hours: r.task.duration,
          comment: r.task.name,
          date: r.date,
          issue: r.issueId,
        });
        if (data.success) {
          ok++;
          patchRow(r.key, { status: "logged", error: undefined });
        } else {
          fail++;
          patchRow(r.key, { status: "failed", error: data.error });
        }
      } catch (e: any) {
        fail++;
        patchRow(r.key, { status: "failed", error: e.message });
      }
    }
    setIsLogging(false);
    if (fail === 0) {
      antdMessage.success(`Đã log ${ok} entry lên Redmine!`);
      onDone();
    } else {
      antdMessage.error(`Log thành công ${ok}, thất bại ${fail}. Xem chi tiết trong cây.`);
    }
  };

  // Nếu đã log được một phần thì vẫn refresh dữ liệu khi đóng
  const handleClose = () => {
    if (isLogging) return;
    if (rows.some((r) => r.status === "logged")) onDone();
    else onCancel();
  };

  return (
    <Modal
      open
      title="Xác nhận log time lên Redmine"
      width={920}
      onCancel={handleClose}
      maskClosable={false}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={isLogging}>
          Huỷ
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={isLogging}
          disabled={pending.length === 0 || blocked.length > 0}
          onClick={handleConfirm}
        >
          Xác nhận & Log {pending.length} entry ({pendingHours.toFixed(1)}h)
        </Button>,
      ]}
    >
      <Space orientation="vertical" style={{ width: "100%" }} size={8}>
        <Alert
          type="info"
          showIcon
          title="Mỗi entry phải nằm trong một task lá của dự án. Kiểm tra đúng dự án › task › task con rồi mới bấm Xác nhận — chưa có gì được gửi lên Redmine."
        />
        {blocked.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={`${blocked.length} entry chưa hợp lệ (chưa gắn task, cần chọn task con, hoặc ngày/giờ không hợp lệ). Xử lý hoặc "Bỏ qua" để tiếp tục.`}
          />
        )}
        {overDays.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={`Vượt 8h/ngày: ${overDays
              .map(([d, t]) => `${dayjs(d).format("DD/MM")} (${t.existing.toFixed(1)}h đã log + ${t.pending.toFixed(1)}h mới)`)
              .join(", ")}`}
          />
        )}
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <Tree
            showLine
            blockNode
            selectable={false}
            expandedKeys={allKeys}
            switcherIcon={() => null}
            treeData={treeData as any}
          />
        </div>
      </Space>
    </Modal>
  );
}
