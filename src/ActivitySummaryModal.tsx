// Modal tóm tắt hoạt động trong ngày: thời gian dùng máy (tracker trong app) + lịch sử AI agent,
// AI gom theo dự án và gợi ý task để thêm vào kế hoạch rồi log qua modal xác nhận dạng cây.
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import {
  Modal,
  Card,
  Alert,
  Spin,
  Switch,
  Tag,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
  Collapse,
  Empty,
  Tooltip,
  message as antdMessage,
} from "antd";
import { DesktopOutlined, RobotOutlined, AppstoreOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { AiConfig } from "./aiClient";
import { summarizeDayActivityWithAI, type Task, type DayActivitySummary } from "./aiService";
import { loadDaySummary, saveDaySummary, summaryRowToTask, type StoredDaySummary, type SummaryRow } from "./activitySummaryStore";

const { Text, Paragraph } = Typography;

interface Props {
  date: string;
  aiConfig: AiConfig;
  existingEntries: any[];
  plannedTasks: Task[];
  onAddTasks: (date: string, tasks: Task[]) => void;
  /** Kết quả tóm tắt được lưu lại để hiển thị trên thẻ ngày */
  onSummaryChange: (date: string, summary: StoredDaySummary | null) => void;
  onClose: () => void;
}

interface SuggestionRow extends SummaryRow {
  checked: boolean;
}

const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)}p`);

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const vnMinuteOfDay = (ms: number) => {
  const d = new Date(ms + VN_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

function ActivityTimeline({ timeline }: { timeline: any[] }) {
  if (!timeline.length) return null;
  let from = 7 * 60;
  let to = 21 * 60;
  timeline.forEach((s) => {
    from = Math.min(from, Math.floor(vnMinuteOfDay(s.startMs) / 60) * 60);
    to = Math.max(to, Math.ceil(vnMinuteOfDay(s.endMs) / 60) * 60);
  });
  const span = to - from;
  const hours = Array.from({ length: span / 60 + 1 }, (_, i) => from / 60 + i);
  return (
    <div>
      <div style={{ position: "relative", height: 22, borderRadius: 4, background: "var(--bg-secondary, rgba(128,128,128,0.12))", overflow: "hidden" }}>
        {timeline.map((s, i) => {
          const left = ((vnMinuteOfDay(s.startMs) - from) / span) * 100;
          const width = Math.max(((s.endMs - s.startMs) / 60000 / span) * 100, 0.3);
          return (
            <Tooltip key={i} title={`${s.start}–${s.end} · ${s.afk ? "Rời máy" : "Đang dùng máy"}`}>
              <div
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 0,
                  bottom: 0,
                  background: s.afk ? "rgba(140,140,140,0.45)" : "#52c41a",
                }}
              />
            </Tooltip>
          );
        })}
      </div>
      <div style={{ position: "relative", height: 16, fontSize: 10, color: "var(--text-secondary)" }}>
        {hours.map((h) => (
          <span key={h} style={{ position: "absolute", left: `${((h * 60 - from) / span) * 100}%`, transform: "translateX(-50%)" }}>
            {h}h
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ActivitySummaryModal({ date, aiConfig, existingEntries, plannedTasks, onAddTasks, onSummaryChange, onClose }: Props) {
  const [stored] = useState(() => loadDaySummary(date));
  const [activity, setActivity] = useState<any>(null);
  const [agentHistory, setAgentHistory] = useState<any>(null);
  const [loadError, setLoadError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [redmineProjects, setRedmineProjects] = useState<string[]>([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<DayActivitySummary | null>(stored ? { overview: stored.overview, projects: [] } : null);
  const [rows, setRows] = useState<SuggestionRow[]>(() => (stored?.rows || []).map((r) => ({ ...r, checked: !r.added })));
  const [createdAt, setCreatedAt] = useState(stored?.createdAt || "");

  const persist = (overview: string, nextRows: SuggestionRow[], at = createdAt) => {
    const data: StoredDaySummary = { date, overview, createdAt: at, rows: nextRows.map((r) => ({
        key: r.key,
        workspace: r.workspace,
        name: r.name,
        hours: r.hours,
        evidence: r.evidence,
        redmineProject: r.redmineProject,
        added: r.added,
      })),
    };
    saveDaySummary(data, date);
    onSummaryChange(date, data);
  };

  const dayEntries = useMemo(() => existingEntries.filter((e) => e.spent_on === date), [existingEntries, date]);
  const loggedHours = dayEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0);

  useEffect(() => {
    const get = (url: string) => fetch(url).then((r) => r.json());
    Promise.all([get(`/api/activity?date=${date}`), get(`/api/agent-history?date=${date}`)])
      .then(([act, hist]) => {
        if (!act.success && !hist.success) {
          setLoadError(
            "Tính năng theo dõi hoạt động đang tắt trên server này. Hãy chạy app trên máy cá nhân (bản desktop hoặc npm run dev) và không đặt ENABLE_AGENT_HISTORY=0."
          );
        }
        if (act.success) setActivity(act);
        if (hist.success) setAgentHistory(hist);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setIsLoading(false));
    get("/api/redmine/projects")
      .then((list) => Array.isArray(list) && setRedmineProjects(list.map((p: any) => p.name)))
      .catch(() => undefined);
  }, [date]);

  const toggleTracking = async (enabled: boolean) => {
    const res = await fetch("/api/activity/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).then((r) => r.json());
    if (res.success) {
      setActivity((prev: any) => ({ ...prev, tracking: res.tracking }));
      antdMessage.success(res.tracking ? "Đã bật theo dõi hoạt động" : "Đã tạm dừng theo dõi hoạt động");
    }
  };

  const [isInstallingExtension, setIsInstallingExtension] = useState(false);
  const installGnomeExtension = async () => {
    setIsInstallingExtension(true);
    try {
      const res = await fetch("/api/activity/gnome-extension", { method: "POST" }).then((r) => r.json());
      if (!res.success) throw new Error(res.error);
      if (res.userExtensionsDisabled) {
        antdMessage.warning("Đã cài extension, nhưng GNOME đang tắt toàn bộ extension. Bật lại trong app Extensions rồi đăng nhập lại.", 8);
      } else if (res.active) {
        antdMessage.success("Đã cài và bật extension. App sẽ ghi nhận cửa sổ đang dùng từ bây giờ.");
      } else {
        antdMessage.info("Đã cài extension. Đăng xuất rồi đăng nhập lại để GNOME bật extension.", 8);
      }
      setActivity((prev: any) => ({
        ...prev,
        capabilities: {
          ...prev.capabilities,
          gnomeExtension: res.active ? undefined : "pending-relogin",
          hint: res.active ? undefined : "Đã cài extension LogTime AI. Đăng xuất rồi đăng nhập lại để GNOME bật extension.",
        },
      }));
    } catch (e: any) {
      antdMessage.error(`Không cài được extension: ${e.message}`);
    } finally {
      setIsInstallingExtension(false);
    }
  };

  const claudeProjects: any[] = agentHistory?.claude?.projects || [];
  const antigravity: any[] = agentHistory?.antigravity?.conversations || [];
  const hasAnyData = (activity?.activeMinutes || 0) > 0 || claudeProjects.length > 0 || antigravity.length > 0;

  const handleSummarize = async () => {
    setIsSummarizing(true);
    try {
      const result = await summarizeDayActivityWithAI(
        {
          date,
          agentHistory: {
            claude: claudeProjects.map((p) => ({
              project: p.name,
              promptCount: p.promptCount,
              estimatedMinutes: p.estimatedMinutes,
              from: p.firstAt,
              to: p.lastAt,
              prompts: p.prompts,
            })),
            antigravity: antigravity.map((c) => ({ workspace: c.workspace, title: c.title, steps: c.steps, notes: c.notes })),
          },
          activity: activity && {
            activeMinutes: activity.activeMinutes,
            firstActive: activity.firstActive,
            lastActive: activity.lastActive,
            apps: activity.apps,
          },
          loggedEntries: dayEntries.map((e) => ({ project: e.project?.name, issue: e.issue?.id, hours: e.hours, comments: e.comments })),
          plannedTasks: plannedTasks.map((t) => t.name),
          knownRedmineProjects: redmineProjects,
        },
        aiConfig
      );
      const nextRows: SuggestionRow[] = result.projects.flatMap((p, pi) =>
        p.tasks.map((t, ti) => ({
          key: `${Date.now()}-${pi}-${ti}`,
          workspace: p.workspace,
          checked: true,
          name: t.name,
          hours: t.hours,
          evidence: t.evidence,
          redmineProject: p.redmineProjectGuess && redmineProjects.includes(p.redmineProjectGuess) ? p.redmineProjectGuess : undefined,
        }))
      );
      const at = new Date().toISOString();
      setSummary(result);
      setRows(nextRows);
      setCreatedAt(at);
      persist(result.overview, nextRows, at);
    } catch (e: any) {
      antdMessage.error(`Lỗi AI: ${e.message}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const patchRow = (key: string, patch: Partial<SuggestionRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const selected = rows.filter((r) => r.checked && !r.added && r.name.trim() && r.hours > 0);
  const selectedHours = selected.reduce((s, r) => s + r.hours, 0);

  const handleAdd = () => {
    onAddTasks(date, selected.map(summaryRowToTask));
    const addedKeys = new Set(selected.map((r) => r.key));
    persist(summary?.overview || "", rows.map((r) => (addedKeys.has(r.key) ? { ...r, added: true, checked: false } : r)));
    antdMessage.success(`Đã thêm ${selected.length} task vào kế hoạch ngày ${dayjs(date).format("DD/MM")}. Bấm log để xác nhận task Redmine.`);
    onClose();
  };

  // Lưu lại các chỉnh sửa (tên, giờ, dự án) khi đóng để thẻ ngày hiển thị đúng
  const handleClose = () => {
    if (summary && createdAt) persist(summary.overview, rows);
    onClose();
  };

  const workspaces = [...new Set(rows.map((r) => r.workspace))];

  return (
    <Modal
      open
      width={960}
      title={`Tóm tắt hoạt động · ${dayjs(date).locale("vi").format("dddd, DD/MM/YYYY")}`}
      onCancel={handleClose}
      footer={[
        <Button key="close" onClick={handleClose}>
          Đóng
        </Button>,
        summary && (
          <Button key="add" type="primary" icon={<PlusOutlined />} disabled={selected.length === 0} onClick={handleAdd}>
            Thêm {selected.length} task ({selectedHours.toFixed(1)}h) vào kế hoạch
          </Button>
        ),
      ]}
    >
      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {loadError && <Alert type="warning" showIcon title={loadError} />}

          {activity && (
            <Card
              size="small"
              title={
                <Space>
                  <DesktopOutlined /> Thời gian dùng máy
                </Space>
              }
              extra={
                <Space size={6}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Theo dõi</Text>
                  <Switch size="small" checked={activity.tracking} onChange={toggleTracking} />
                </Space>
              }
            >
              <Space size={16} wrap style={{ marginBottom: 8 }}>
                <Text>
                  Đang dùng máy: <Text strong>{fmtMinutes(activity.activeMinutes)}</Text>
                </Text>
                <Text>
                  Rời máy: <Text strong>{fmtMinutes(activity.afkMinutes)}</Text>
                </Text>
                {activity.firstActive && (
                  <Text>
                    Từ <Text strong>{activity.firstActive}</Text> đến <Text strong>{activity.lastActive}</Text>
                  </Text>
                )}
                <Text>
                  Đã log Redmine: <Text strong>{loggedHours.toFixed(1)}h</Text>
                </Text>
              </Space>
              {activity.timeline.length > 0 ? (
                <ActivityTimeline timeline={activity.timeline} />
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Chưa có dữ liệu cho ngày này. App chỉ ghi nhận khi đang chạy.
                </Text>
              )}
              {activity.capabilities?.hint && (
                <Alert
                  style={{ marginTop: 8 }}
                  type="info"
                  showIcon
                  title={activity.capabilities.hint}
                  action={
                    activity.capabilities.gnomeExtension === "missing" && (
                      <Button size="small" loading={isInstallingExtension} onClick={installGnomeExtension}>
                        Cài extension
                      </Button>
                    )
                  }
                />
              )}
            </Card>
          )}

          {activity?.apps?.length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  <AppstoreOutlined /> App / cửa sổ
                </Space>
              }
            >
              <Collapse
                size="small"
                ghost
                items={activity.apps.map((a: any) => ({
                  key: a.app,
                  label: (
                    <Space>
                      <Text strong>{a.app}</Text>
                      <Tag>{fmtMinutes(a.minutes)}</Tag>
                    </Space>
                  ),
                  children: a.titles.map((t: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <Text ellipsis style={{ fontSize: 12 }}>{t.title}</Text>
                      <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtMinutes(t.minutes)}</Text>
                    </div>
                  )),
                }))}
              />
            </Card>
          )}

          {agentHistory && (
            <Card
              size="small"
              title={
                <Space>
                  <RobotOutlined /> Làm việc với AI agent
                </Space>
              }
            >
              {claudeProjects.length === 0 && antigravity.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có hoạt động AI agent trong ngày" />
              ) : (
                <Collapse
                  size="small"
                  ghost
                  items={[
                    ...claudeProjects.map((p) => ({
                      key: `c-${p.project}`,
                      label: (
                        <Space wrap>
                          <Tag color="orange">Claude Code</Tag>
                          <Text strong>{p.name}</Text>
                          <Tag>~{fmtMinutes(p.estimatedMinutes)}</Tag>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {p.promptCount} prompt · {p.firstAt}–{p.lastAt}
                          </Text>
                        </Space>
                      ),
                      children: (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                          {p.prompts.map((t: string, i: number) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      ),
                    })),
                    ...antigravity.map((c) => ({
                      key: `a-${c.id}`,
                      label: (
                        <Space wrap>
                          <Tag color="blue">Antigravity</Tag>
                          <Text strong>{c.workspace || "(không rõ workspace)"}</Text>
                          <Text style={{ fontSize: 12 }}>{c.title}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {c.steps} bước · {c.lastActiveAt}
                          </Text>
                        </Space>
                      ),
                      children: <Text style={{ fontSize: 12 }}>{c.notes || "Không có ghi chú."}</Text>,
                    })),
                  ]}
                />
              )}
              {[agentHistory.claude, agentHistory.antigravity]
                .filter((s: any) => s && !s.available && s.error)
                .map((s: any, i: number) => (
                  <Text key={i} type="secondary" style={{ display: "block", fontSize: 11 }}>
                    {s.error}
                  </Text>
                ))}
            </Card>
          )}

          <Card
            size="small"
            title={
              <Space>
                <ThunderboltOutlined /> Tóm tắt theo dự án
              </Space>
            }
            extra={
              <Tooltip title="Dữ liệu ở trên (đã che secret) sẽ được gửi tới AI provider đang cấu hình">
                <Button type="primary" size="small" icon={<RobotOutlined />} loading={isSummarizing} disabled={!hasAnyData} onClick={handleSummarize}>
                  {summary ? "Tóm tắt lại" : "Tóm tắt bằng AI"}
                </Button>
              </Tooltip>
            }
          >
            {!summary ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {hasAnyData
                  ? "Bấm \"Tóm tắt bằng AI\" để gom hoạt động theo dự án và gợi ý task cần log."
                  : "Chưa có dữ liệu hoạt động cho ngày này."}
              </Text>
            ) : (
              <Space orientation="vertical" style={{ width: "100%" }} size={10}>
                {summary.overview && <Paragraph style={{ marginBottom: 0 }}>{summary.overview}</Paragraph>}
                {rows.length === 0 && <Text type="secondary">AI không gợi ý task nào (có thể đã log đủ).</Text>}
                {workspaces.map((ws) => (
                  <div key={ws}>
                    <Text strong>📁 {ws}</Text>
                    {rows
                      .filter((r) => r.workspace === ws)
                      .map((r) => (
                        <div key={r.key} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 0 6px 18px" }}>
                          <Space wrap size={6}>
                            <Checkbox checked={r.checked} disabled={r.added} onChange={(e) => patchRow(r.key, { checked: e.target.checked })} />
                            <Input size="small" style={{ width: 340 }} value={r.name} onChange={(e) => patchRow(r.key, { name: e.target.value })} />
                            <InputNumber
                              size="small"
                              min={0.5}
                              max={8}
                              step={0.5}
                              value={r.hours}
                              onChange={(v) => patchRow(r.key, { hours: v || 0.5 })}
                              suffix="h"
                              style={{ width: 80 }}
                            />
                            <Select
                              size="small"
                              allowClear
                              showSearch
                              placeholder="Dự án Redmine"
                              style={{ width: 220 }}
                              value={r.redmineProject}
                              onChange={(v) => patchRow(r.key, { redmineProject: v })}
                              options={redmineProjects.map((p) => ({ value: p, label: p }))}
                            />
                            {r.added && <Tag color="success">Đã tạo task</Tag>}
                          </Space>
                          {r.evidence && (
                            <Text type="secondary" style={{ fontSize: 11, paddingLeft: 24 }}>
                              {r.evidence}
                            </Text>
                          )}
                        </div>
                      ))}
                  </div>
                ))}
                {loggedHours + selectedHours > 8 && (
                  <Alert type="warning" showIcon title={`Tổng ${(loggedHours + selectedHours).toFixed(1)}h vượt 8h/ngày.`} />
                )}
              </Space>
            )}
          </Card>
        </Space>
      )}
    </Modal>
  );
}
