import { useState, useEffect, useRef } from "react";
import {
  ConfigProvider,
  theme,
  Layout,
  Typography,
  DatePicker,
  Row,
  Col,
  Card,
  Input,
  Select,
  Button,
  Table,
  Tag,
  Switch,
  Space,
  Progress,
  Tooltip,
  Modal,
  message as antdMessage,
  Empty,
  InputNumber,
  Badge,
  Card as AntdCard,
  Menu,
  Spin,
  Pagination,
  Avatar,
  Alert,
  Dropdown,
  Tabs,
  Segmented,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
  RobotOutlined,
  CopyOutlined,
  DownloadOutlined,
  SettingOutlined,
  SendOutlined,
  ThunderboltOutlined,
  ClearOutlined,
  HistoryOutlined,
  SunOutlined,
  MoonOutlined,
  CalendarOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  BellOutlined,
  DownloadOutlined as DownloadCSVOutlined,
  AimOutlined,
  ReloadOutlined,
  FireOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  CloseOutlined,
  MinusOutlined,
  CheckCircleOutlined,
  UploadOutlined,
  FundViewOutlined,
  LeftOutlined,
  RightOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import confetti from "canvas-confetti";
import type { Task, ChatMessage } from "./aiService";
import { loadAiSettings, resolveAiConfig, saveAiSettings, PROVIDERS, type AiSettings } from "./aiClient";
import AiSettingsPanel from "./AiSettings";
import LogTimeConfirmModal, { type LogEntryInput } from "./LogTimeConfirmModal";
import ActivitySummaryModal from "./ActivitySummaryModal";
import DaySummaryTree from "./DaySummaryTree";
import { loadDaySummary, saveDaySummary, summaryRowToTask, type StoredDaySummary, type SummaryRow } from "./activitySummaryStore";
import {
  distributeTasksWithAI,
  adjustTasksWithChat,
  parseRawTasksWithAI,
  distributeWeekTasksWithAI,
  generateWeeklySummaryWithAI,
} from "./aiService";
import {
  DashboardOutlined,
  SearchOutlined,
  PlusCircleOutlined,
  TeamOutlined,
  MenuOutlined,
  ProjectOutlined,
  PieChartOutlined,
  BarChartOutlined,
  LineChartOutlined,
  BulbOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import {
  analyzeRedmineMapping,
  extractSearchQuery,
} from "./aiRedmineService";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
  AreaChart, Area,
} from "recharts";

const { Header, Content, Footer, Sider } = Layout;
const { Text } = Typography;
const { Option } = Select;

// Một số mẫu task phổ biến để điền nhanh
const TEMPLATE_TASKS: Omit<Task, "id">[] = [
  { name: "Họp Daily Standup", importance: "low", category: "Meeting", duration: 0.5, isLocked: true },
  { name: "Fix bug và refactor code module đăng nhập", importance: "high", category: "Coding", duration: 0, isLocked: false },
  { name: "Viết unit test cho service xác thực người dùng", importance: "medium", category: "Coding", duration: 0, isLocked: false },
  { name: "Review Pull Request của team", importance: "medium", category: "Review", duration: 0, isLocked: false },
  { name: "Nghiên cứu công nghệ mới để tích hợp AI", importance: "low", category: "Research", duration: 0, isLocked: false },
];

const DAY_NAMES_VI = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];

const PAGE_META: Record<"daily" | "weekly" | "dashboard" | "settings" | "spent_time" | "team", { title: string; subtitle: string }> = {
  spent_time: { title: "Thời gian đã báo cáo", subtitle: "Thời gian đã log lên Redmine, theo từng ngày" },
  daily: { title: "Kế hoạch ngày", subtitle: "" },
  weekly: { title: "Kế hoạch tuần", subtitle: "" },
  dashboard: { title: "Ticket của tôi", subtitle: "Ticket Redmine được giao cho bạn" },
  team: { title: "Thống kê nhóm", subtitle: "Giờ đã log của các thành viên trong tháng này" },
  settings: { title: "Cài đặt", subtitle: "AI, Redmine và nhắc nhở" },
};

// Màu & nhãn trạng thái giờ trong ngày — luôn đi kèm chữ, không chỉ dựa vào màu
const getHoursStatus = (hours: number) => {
  const h = Math.round(hours * 100) / 100;
  if (h === 8) return { key: "ok" as const, color: "var(--success-color)", label: "Đủ 8h" };
  if (h > 8) return { key: "over" as const, color: "var(--danger-color)", label: `Vượt ${(h - 8).toFixed(1)}h` };
  return { key: "under" as const, color: "var(--warning-color)", label: `Thiếu ${(8 - h).toFixed(1)}h` };
};

// Hiệu ứng ăn mừng chỉ khi người dùng không bật "Giảm chuyển động"
const celebrate = (opts: confetti.Options) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 }, ...opts });
};

// Warm, muted palette that matches the neutral theme (no saturated blue/purple)
const CHART_COLORS = ["#d97757", "#8f9e8b", "#e0b25a", "#7f9cb0", "#b5838d", "#a3a380", "#9c8673"];
const STATUS_COLORS = { danger: "#d9534f", warning: "#e0b25a", success: "#8f9e8b" };

// Helper để lấy danh sách 7 ngày trong tuần của một ngày bất kỳ
const getWeekDays = (dateStr: string) => {
  const current = dayjs(dateStr);
  const dayIndex = current.day(); // 0: Chủ Nhật, 1: Thứ Hai...
  const diffToMonday = dayIndex === 0 ? -6 : 1 - dayIndex;
  const monday = current.add(diffToMonday, "day");
  
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(monday.add(i, "day").format("YYYY-MM-DD"));
  }
  return days;
};

// Helper để định dạng ngày theo tiếng Việt
const formatVietnameseDate = (dateStr: string) => {
  const d = dayjs(dateStr);
  const daysOfWeek = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
  const dayName = daysOfWeek[d.day()];
  return `${dayName}, ${d.format("DD/MM/YYYY")}`;
};

// Helper để lấy ngày hôm nay theo giờ Việt Nam (Asia/Ho_Chi_Minh) dưới dạng YYYY-MM-DD
const getVietnamToday = () => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return `${year}-${month}-${day}`;
  } catch (e) {
    return dayjs().format("YYYY-MM-DD");
  }
};

// Helper để tạo danh sách đầy đủ các ngày cần hiển thị trong lịch sử dựa theo filter
const generateDatesForFilter = (filter: "all" | "this_month" | "last_month", entries: any[]) => {
  const vnToday = getVietnamToday();
  const todayVal = dayjs(vnToday);
  
  let startDate = todayVal;
  let endDate = todayVal;
  
  if (filter === "this_month") {
    startDate = todayVal.startOf("month");
    endDate = todayVal;
  } else if (filter === "last_month") {
    startDate = todayVal.subtract(1, "month").startOf("month");
    endDate = todayVal.subtract(1, "month").endOf("month");
  } else {
    // "all" - Lấy từ ngày cũ nhất có log đến ngày hôm nay, tối thiểu là 30 ngày qua
    let oldestDateStr = vnToday;
    if (entries && entries.length > 0) {
      entries.forEach((e) => {
        if (e.spent_on && e.spent_on < oldestDateStr) {
          oldestDateStr = e.spent_on;
        }
      });
    }
    const oldestDate = dayjs(oldestDateStr);
    const thirtyDaysAgo = todayVal.subtract(30, "days");
    startDate = oldestDate.isBefore(thirtyDaysAgo) ? oldestDate : thirtyDaysAgo;
    endDate = todayVal;
  }

  const dates: string[] = [];
  let curr = startDate;
  while (curr.isBefore(endDate) || curr.isSame(endDate, "day")) {
    dates.push(curr.format("YYYY-MM-DD"));
    curr = curr.add(1, "day");
  }
  
  return dates.sort((a, b) => b.localeCompare(a));
};

// Component Heatmap kiểu GitHub
// Trạng thái trống có minh hoạ nét vẽ, đổi màu nét theo theme
const EmptyIllustration = ({ themeMode, description }: { themeMode: "light" | "dark"; description: string }) => (
  <Empty
    image={<img src={`/illustrations/empty-${themeMode}.png`} alt="" style={{ height: 140, width: "auto" }} />}
    styles={{ image: { height: 140, marginBottom: 12 } }}
    description={<span style={{ color: "var(--text-secondary)" }}>{description}</span>}
    style={{ padding: "24px 0" }}
  />
);

const LogTimeHeatmap = ({ entries, themeMode }: { entries: any[], themeMode: "light" | "dark" }) => {
  const today = dayjs();
  // Hiển thị 24 tuần (khoảng 6 tháng) cho đẹp và đủ dữ liệu
  const start = today.subtract(23, "week").startOf("week");
  const days: string[] = [];
  let curr = start;
  while (curr.isBefore(today) || curr.isSame(today, "day")) {
    days.push(curr.format("YYYY-MM-DD"));
    curr = curr.add(1, "day");
  }

  const dataMap = entries.reduce((acc, e) => {
    const d = e.spent_on;
    if (d) acc[d] = (acc[d] || 0) + (e.hours || 0);
    return acc;
  }, {} as Record<string, number>);

  const getDayColor = (dateStr: string) => {
    const hours = dataMap[dateStr] || 0;
    const isWeekend = dayjs(dateStr).day() === 0 || dayjs(dateStr).day() === 6;
    if (hours === 0) return isWeekend ? "transparent" : (themeMode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)");
    if (hours >= 8) return STATUS_COLORS.success;
    if (hours > 0) return STATUS_COLORS.warning;
    return "transparent";
  };

  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(24, 12px)", 
        gridTemplateRows: "repeat(7, 12px)", 
        gridAutoFlow: "column", 
        gap: "4px", 
        overflowX: "auto", 
        paddingBottom: "12px",
        paddingTop: "4px"
      }}>
        {days.map(d => (
          <Tooltip key={d} title={`${dayjs(d).format("DD/MM")}: ${dataMap[d]?.toFixed(1) || 0}h`}>
            <div style={{ 
              width: "12px", 
              height: "12px", 
              borderRadius: "2px", 
              background: getDayColor(d), 
              border: `1px solid ${themeMode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}` 
            }} />
          </Tooltip>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-secondary)", maxWidth: "380px" }}>
        <span>{start.format("MMM YYYY")}</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span>0h</span>
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: themeMode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)", border: "1px solid var(--glass-border)" }} />
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: STATUS_COLORS.warning }} />
          <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: STATUS_COLORS.success }} />
          <span>≥ 8h</span>
        </div>
        <span>{today.format("MMM YYYY")}</span>
      </div>
    </div>
  );
};

export default function App() {
  // Giao diện: Chế độ sáng/tối và Tab hiển thị
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");

  // Dữ liệu cho chế độ Ngày (Daily)
  const [selectedDate, setSelectedDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [explanation, setExplanation] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  
  // Dữ liệu cho chế độ Tuần (Weekly)
  const [weeklyTasks, setWeeklyTasks] = useState<{ [date: string]: Task[] }>({});
  const [weeklyExplanation, setWeeklyExplanation] = useState("");
  const [isWeeklyAnalyzing, setIsWeeklyAnalyzing] = useState(false);
  const [quickTaskNames, setQuickTaskNames] = useState<{ [date: string]: string }>({});

  // Form nhập task đơn lẻ
  const [inputName, setInputName] = useState("");
  const [inputImportance, setInputImportance] = useState<"high" | "medium" | "low">("medium");
  const [inputCategory, setInputCategory] = useState("Coding");
  const [inputDuration, setInputDuration] = useState<number>(0);
  const [inputIsLocked, setInputIsLocked] = useState(false);
  const [inputRedmineIssue, setInputRedmineIssue] = useState<number | undefined>(undefined);
  const [inputRedmineProject, setInputRedmineProject] = useState("");

  // Nhập nhanh văn bản thô
  const [rawInputText, setRawInputText] = useState("");
  const [isParsingRaw, setIsParsingRaw] = useState(false);

  // Gọi AI trạng thái load
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isSyncingRedmine, setIsSyncingRedmine] = useState(false);
  
  // Cấu hình API Key & Redmine
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const aiConfig = resolveAiConfig(aiSettings);
  const [redmineServer, setRedmineServer] = useState("");
  // Chỉ chứa khoá MỚI người dùng gõ vào; khoá đã lưu không bao giờ được gửi về giao diện
  const [redmineApiKey, setRedmineApiKey] = useState("");
  const [redmineKeyHint, setRedmineKeyHint] = useState("");
  const [redmineDefaultProject, setRedmineDefaultProject] = useState("");
  const [redmineLoaded, setRedmineLoaded] = useState(false);
  // Cài đặt đã lưu (khác bản đang sửa trong trang Cài đặt) — dùng để biết còn thiếu bước thiết lập nào
  const [savedAiSettings, setSavedAiSettings] = useState<AiSettings>(loadAiSettings);
  const [savedRedmine, setSavedRedmine] = useState({ server: "", apiKey: "" });

  // Active module: "daily" | "weekly" | "dashboard" | "settings" | "spent_time" | "team"
  const [activeModule, setActiveModule] = useState<"daily" | "weekly" | "dashboard" | "settings" | "spent_time" | "team">("spent_time");
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [isSiderCollapsed, setIsSiderCollapsed] = useState(false);

  // Redmine Tickets Dashboard states
  const [userRedmineTickets, setUserRedmineTickets] = useState<any[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);

  // Spent Time states
  const [spentTimeEntries, setSpentTimeEntries] = useState<any[]>([]);
  const [isLoadingSpentTime, setIsLoadingSpentTime] = useState(false);
  const [spentTimeFilter, setSpentTimeFilter] = useState<"all" | "this_month" | "last_month">("this_month");
  const [spentTimePage, setSpentTimePage] = useState(1);
  const [spentTimePageSize, setSpentTimePageSize] = useState(12);

  // Trạng thái cho Modal Xác thực Ánh xạ Đơn lẻ
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [mappingTask, setMappingTask] = useState<Task | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);

  // Các trường chỉnh sửa thủ công trong modal đơn lẻ
  const [manualMatchType, setManualMatchType] = useState<"direct" | "subtask" | "none">("none");
  const [manualIssueId, setManualIssueId] = useState<number | undefined>(undefined);
  const [manualParentIssueId, setManualParentIssueId] = useState<number | undefined>(undefined);
  const [manualSubject, setManualSubject] = useState("");
  const [manualProject, setManualProject] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualEstimatedHours, setManualEstimatedHours] = useState<number | undefined>(undefined);

  // Search autocomplete
  const [searchIssuesResults, setSearchIssuesResults] = useState<any[]>([]);
  const [isSearchingIssues, setIsSearchingIssues] = useState(false);

  // Trạng thái cho Bulk Mapping
  const [isBulkMappingModalOpen, setIsBulkMappingModalOpen] = useState(false);
  const [bulkMappingSuggestions, setBulkMappingSuggestions] = useState<any[]>([]);
  const [isBulkMappingLoading, setIsBulkMappingLoading] = useState(false);

  // Redmine Tickets Dashboard search and filter states
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState("all");
  const [dashboardPriorityFilter, setDashboardPriorityFilter] = useState("all");

  // ---- TÍNH NĂNG MỚI ----

  // 1. Pomodoro Timer
  const [pomodoroVisible, setPomodoroVisible] = useState(false);
  const [pomodoroMinimized, setPomodoroMinimized] = useState(false);
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroMode, setPomodoroMode] = useState<"work" | "break">("work");
  const [pomodoroTask, setPomodoroTask] = useState("");
  const [pomodoroSessions, setPomodoroSessions] = useState(0);
  const [showPomodoroLogModal, setShowPomodoroLogModal] = useState(false);
  const [lastFinishedTask, setLastFinishedTask] = useState("");
  const pomodoroIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 2. Recurring Tasks - lưu danh sách tên task lặp lại
  const [recurringTemplates, setRecurringTemplates] = useState<Task[]>(() => {
    try { return JSON.parse(localStorage.getItem("logtime_recurring_tasks") || "[]"); } catch { return []; }
  });

  // 3. Bulk Select (Daily view)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [logConfirmEntries, setLogConfirmEntries] = useState<LogEntryInput[] | null>(null);
  const [activitySummaryDate, setActivitySummaryDate] = useState<string | null>(null);
  // Tóm tắt hoạt động đã lưu theo ngày (undefined = chưa đọc từ localStorage)
  const [daySummaries, setDaySummaries] = useState<Record<string, StoredDaySummary | null>>({});
  const [redmineProjectList, setRedmineProjectList] = useState<any[]>([]);

  // 4. Project Targets
  const [projectTargets, setProjectTargets] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("logtime_project_targets") || "{}"); } catch { return {}; }
  });
  const [projectTargetInput, setProjectTargetInput] = useState<Record<string, number>>({});

  // 5. AI Weekly Summary
  const [weeklySummaryModalOpen, setWeeklySummaryModalOpen] = useState(false);
  const [weeklySummaryText, setWeeklySummaryText] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);

  // 6. Team View
  const [teamTimeEntries, setTeamTimeEntries] = useState<any[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  // 7. Browser Notification permission
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    "Notification" in window ? Notification.permission : "denied"
  );

  // 8. Drag & Drop (weekly view)
  const [dragTask, setDragTask] = useState<{ date: string; taskId: string } | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Cuộn khung chat xuống cuối khi chatHistory thay đổi
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // Thiết lập theme ban đầu từ localStorage và document attribute
  useEffect(() => {
    const savedTheme = localStorage.getItem("logtime_theme") as "dark" | "light" | null;
    if (savedTheme) {
      setThemeMode(savedTheme);
      document.documentElement.setAttribute("data-theme", savedTheme);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  // Thay đổi theme mode
  const handleToggleTheme = (checked: boolean) => {
    const mode = checked ? "dark" : "light";
    setThemeMode(mode);
    localStorage.setItem("logtime_theme", mode);
    document.documentElement.setAttribute("data-theme", mode);
  };

  // Tải dữ liệu LogTime Ngày
  useEffect(() => {
    const savedTasks = localStorage.getItem(`logtime_tasks_${selectedDate}`);
    const savedExplanation = localStorage.getItem(`logtime_explanation_${selectedDate}`);
    const savedChat = localStorage.getItem(`logtime_chat_${selectedDate}`);

    if (savedTasks) {
      setTasks(JSON.parse(savedTasks));
    } else {
      setTasks([]);
    }

    if (savedExplanation) {
      setExplanation(savedExplanation);
    } else {
      setExplanation("");
    }

    if (savedChat) {
      setChatHistory(JSON.parse(savedChat));
    } else {
      setChatHistory([
        {
          role: "assistant",
          content: "Thêm các việc đã làm, khoá những việc có giờ cố định, rồi bấm “Phân bổ bằng AI” để chia đủ 8 giờ. Muốn chỉnh gì, cứ nhắn ở đây — ví dụ: “Họp 1 tiếng, còn lại dồn cho code”.",
        },
      ]);
    }
  }, [selectedDate]);

  // Tải cấu hình Redmine một lần duy nhất khi component mount
  useEffect(() => {
    fetch("/api/get-redmine")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setRedmineServer(data.server || "");
          setRedmineKeyHint(data.hasApiKey ? data.apiKeyHint : "");
          setSavedRedmine({ server: data.server || "", apiKey: "" });
        }
      })
      .catch((err) => console.error("Lỗi khi tải cấu hình Redmine:", err))
      .finally(() => setRedmineLoaded(true));

    const savedDefaultProject = localStorage.getItem("logtime_redmine_default_project");
    if (savedDefaultProject) {
      setRedmineDefaultProject(savedDefaultProject);
    }
  }, []);

  // Tải danh sách ticket của me cho dashboard
  const handleRefreshDashboardTickets = async () => {
    setIsLoadingDashboard(true);
    try {
      const res = await fetch("/api/redmine/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee: "me", status: "*" }),
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setUserRedmineTickets(data);
        localStorage.setItem("logtime_cached_tickets", JSON.stringify(data));
      }
    } catch (err: any) {
      console.error("Lỗi khi tải danh sách ticket:", err);
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  // Tải danh sách thời gian đã báo cáo (Spent Time) cho user is me
  const handleFetchSpentTime = async () => {
    setIsLoadingSpentTime(true);
    try {
      const res = await fetch("/api/redmine/time-entries", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setSpentTimeEntries(data);
      } else {
        setSpentTimeEntries([]);
      }
    } catch (err: any) {
      console.error("Lỗi khi tải danh sách thời gian:", err);
      antdMessage.error("Không tải được thời gian đã báo cáo. Kiểm tra URL và API key Redmine trong Cài đặt.");
    } finally {
      setIsLoadingSpentTime(false);
    }
  };

  // Tải danh sách thời gian đã báo cáo (Spent Time) cho cả nhóm (Team View)
  const handleFetchTeamSpentTime = async () => {
    setIsLoadingTeam(true);
    setTeamError(null);
    try {
      const res = await fetch("/api/redmine/time-entries?user_id=all&limit=300", {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (data && data.success === false) {
        setTeamError(data.error || "Không thể tải thông tin Team View từ Redmine.");
        setTeamTimeEntries([]);
      } else if (Array.isArray(data)) {
        setTeamTimeEntries(data);
      } else {
        setTeamTimeEntries([]);
      }
    } catch (err: any) {
      console.error("Lỗi khi tải thông tin Team View:", err);
      setTeamError("Không thể tải thông tin Team View. Vui lòng kiểm tra quyền truy cập Redmine.");
      setTeamTimeEntries([]);
    } finally {
      setIsLoadingTeam(false);
    }
  };

  useEffect(() => {
    const cached = localStorage.getItem("logtime_cached_tickets");
    if (cached) {
      setUserRedmineTickets(JSON.parse(cached));
    }
  }, []);

  useEffect(() => {
    if (activeModule === "dashboard") {
      handleRefreshDashboardTickets();
      if (spentTimeEntries.length === 0) handleFetchSpentTime();
    }
  }, [activeModule, savedRedmine.server, redmineKeyHint]);

  useEffect(() => {
    if (activeModule === "spent_time") {
      handleFetchSpentTime();
    }
  }, [activeModule, savedRedmine.server, redmineKeyHint]);

  // Danh sách project Redmine (có parent) để dựng cây cho phần tóm tắt hoạt động
  useEffect(() => {
    if (activeModule !== "spent_time" || redmineProjectList.length > 0) return;
    fetch("/api/redmine/projects")
      .then((r) => r.json())
      .then((list) => Array.isArray(list) && setRedmineProjectList(list))
      .catch(() => undefined);
  }, [activeModule, redmineProjectList.length]);

  useEffect(() => {
    if (activeModule === "team") {
      handleFetchTeamSpentTime();
    }
  }, [activeModule, savedRedmine.server, redmineKeyHint]);


  // Browser notification: nhắc cuối ngày nếu chưa đủ 8h logged
  useEffect(() => {
    if (notifPermission !== "granted") return;
    const checkReminder = () => {
      const now = new Date();
      const vnHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ho_Chi_Minh", hour: "numeric", hour12: false }).format(now));
      if (vnHour < 16 || vnHour > 18) return;
      const today = getVietnamToday();
      const todayLogged = spentTimeEntries.filter(e => e.spent_on === today).reduce((s, e) => s + (e.hours || 0), 0);
      if (todayLogged < 8) {
        new Notification("⏰ Nhắc nhở LogTime", {
          body: `Hôm nay bạn đã log ${todayLogged.toFixed(1)}h / 8.0h. Nhớ cập nhật trước khi hết giờ!`,
          icon: "/logo.png",
        });
      }
    };
    const interval = setInterval(checkReminder, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [notifPermission, spentTimeEntries]);

  // Pomodoro timer countdown
  useEffect(() => {
    if (pomodoroRunning) {
      pomodoroIntervalRef.current = setInterval(() => {
        setPomodoroSeconds(s => {
          if (s <= 1) {
            clearInterval(pomodoroIntervalRef.current!);
            setPomodoroRunning(false);
            const nextMode = pomodoroMode === "work" ? "break" : "work";
            const nextSeconds = nextMode === "work" ? 25 * 60 : 5 * 60;
            setPomodoroMode(nextMode);
            setPomodoroSeconds(nextSeconds);
            antdMessage.success(pomodoroMode === "work" ? "🍅 Xong 1 Pomodoro! Nghỉ 5 phút nào!" : "💪 Hết giờ nghỉ! Bắt đầu làm việc!", 5);

            if (pomodoroMode === "work") {
              setLastFinishedTask(pomodoroTask);
              setPomodoroSessions(prev => prev + 1);
              setShowPomodoroLogModal(true);
            }
            if ("Notification" in window && Notification.permission === "granted") {              new Notification(pomodoroMode === "work" ? "🍅 Xong Pomodoro!" : "💪 Bắt đầu làm việc!", {
                body: pomodoroMode === "work" ? `Hoàn thành: ${pomodoroTask || "Task"} - Nghỉ 5 phút!` : "Hết giờ nghỉ, tiếp tục nào!",
              });
            }
            return nextSeconds;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (pomodoroIntervalRef.current) clearInterval(pomodoroIntervalRef.current);
    }
    return () => { if (pomodoroIntervalRef.current) clearInterval(pomodoroIntervalRef.current); };
  }, [pomodoroRunning, pomodoroMode]);

  // Auto-add recurring tasks khi đổi tuần
  useEffect(() => {
    if (recurringTemplates.length === 0) return;
    const days = getWeekDays(selectedDate);
    const updates: Record<string, Task[]> = {};
    days.forEach(day => {
      const d = dayjs(day);
      if (d.day() === 0 || d.day() === 6) return; // bỏ cuối tuần
      const existing = JSON.parse(localStorage.getItem(`logtime_tasks_${day}`) || "[]") as Task[];
      const toAdd = recurringTemplates.filter(rt => !existing.some(t => t.name === rt.name));
      if (toAdd.length > 0) {
        const newList = [...existing, ...toAdd.map(rt => ({ ...rt, id: Math.random().toString(36).substring(2, 9) }))];
        localStorage.setItem(`logtime_tasks_${day}`, JSON.stringify(newList));
        updates[day] = newList;
      }
    });
    if (Object.keys(updates).length > 0) {
      setWeeklyTasks(prev => ({ ...prev, ...updates }));
    }
  }, [selectedDate]);

  // Tải dữ liệu LogTime Tuần
  const loadWeeklyData = () => {
    const days = getWeekDays(selectedDate);
    const data: { [date: string]: Task[] } = {};
    days.forEach((day) => {
      const saved = localStorage.getItem(`logtime_tasks_${day}`);
      data[day] = saved ? JSON.parse(saved) : [];
    });
    setWeeklyTasks(data);

    const savedWeeklyExp = localStorage.getItem(`logtime_weekly_explanation_${days[0]}`);
    setWeeklyExplanation(savedWeeklyExp || "");
  };

  useEffect(() => {
    if (activeModule === "weekly") {
      loadWeeklyData();
    }
  }, [selectedDate, activeModule]);

  // Đồng bộ danh sách công việc hiện tại sang workspace file current_tasks.json
  useEffect(() => {
    const syncData = {
      date: selectedDate,
      tasks: tasks,
      weeklyTasks: weeklyTasks,
    };
    fetch("/api/sync-workspace-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(syncData),
    }).catch((err) => console.error("Lỗi khi đồng bộ danh sách task sang workspace:", err));
  }, [selectedDate, tasks, weeklyTasks]);

  // Lưu trạng thái ngày
  const saveDailyState = (updatedTasks: Task[], updatedExplanation: string, updatedChat: ChatMessage[], date = selectedDate) => {
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updatedTasks));
    localStorage.setItem(`logtime_explanation_${date}`, updatedExplanation);
    localStorage.setItem(`logtime_chat_${date}`, JSON.stringify(updatedChat));
  };

  const handleSetTasks = (newTasks: Task[]) => {
    setTasks(newTasks);
    saveDailyState(newTasks, explanation, chatHistory);
  };

  // Tính tổng số giờ ngày
  const calculateTotalHours = (taskList: Task[]): number => {
    return Number(taskList.reduce((sum, task) => sum + (task.duration || 0), 0).toFixed(2));
  };

  const totalHours = calculateTotalHours(tasks);

  // Thêm task thủ công ngày
  const handleAddTask = () => {
    if (!inputName.trim()) {
      antdMessage.warning("Nhập tên công việc trước khi thêm.");
      return;
    }

    const newTask: Task = {
      id: Math.random().toString(36).substring(2, 9),
      name: inputName.trim(),
      importance: inputImportance,
      category: inputCategory,
      duration: inputDuration,
      isLocked: inputIsLocked || inputDuration > 0,
      aiReason: "Thêm thủ công bởi người dùng",
      redmineIssue: inputRedmineIssue,
      redmineProject: inputRedmineProject.trim() || undefined,
    };

    const newTasks = [...tasks, newTask];
    handleSetTasks(newTasks);

    setInputName("");
    setInputImportance("medium");
    setInputCategory("Coding");
    setInputDuration(0);
    setInputIsLocked(false);
    setInputRedmineIssue(undefined);
    setInputRedmineProject("");
  };

  // Nạp nhanh mẫu công việc ngày
  const handleQuickPopulate = () => {
    const newTasks = TEMPLATE_TASKS.map((t) => ({
      ...t,
      id: Math.random().toString(36).substring(2, 9),
    }));
    handleSetTasks(newTasks);
  };

  // Xoá là hành động dự kiến nên không hỏi lại, nhưng luôn cho hoàn tác
  const showUndo = (label: string, undo: () => void) => {
    const key = `undo-${Date.now()}`;
    antdMessage.open({
      key,
      type: "info",
      duration: 6,
      content: (
        <span>
          {label}{" "}
          <Button type="link" size="small" style={{ padding: "0 4px" }} onClick={() => { undo(); antdMessage.destroy(key); }}>
            Hoàn tác
          </Button>
        </span>
      ),
    });
  };

  // Xóa task
  const handleDeleteTask = (id: string) => {
    const previous = tasks;
    const removed = tasks.find((t) => t.id === id);
    handleSetTasks(tasks.filter((t) => t.id !== id));
    showUndo(`Đã xoá "${removed?.name ?? "công việc"}".`, () => handleSetTasks(previous));
  };

  // Toggle trạng thái lock
  const handleToggleLock = (id: string, checked: boolean) => {
    const newTasks = tasks.map((t) => {
      if (t.id === id) {
        return { ...t, isLocked: checked };
      }
      return t;
    });
    handleSetTasks(newTasks);
  };

  // Cập nhật duration của task
  const handleUpdateDuration = (id: string, val: number | null) => {
    const duration = val === null ? 0 : val;
    const newTasks = tasks.map((t) => {
      if (t.id === id) {
        return { ...t, duration, isLocked: duration > 0 ? t.isLocked : false };
      }
      return t;
    });
    handleSetTasks(newTasks);
  };

  // Gọi AI phân bổ ngày
  const handleAIDistribute = async () => {
    if (tasks.length === 0) {
      antdMessage.warning("Thêm ít nhất một công việc để AI phân bổ.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const response = await distributeTasksWithAI(tasks, aiConfig);
      
      const newChat: ChatMessage[] = [
        ...chatHistory,
        {
          role: "system",
          content: `AI tự động phân bổ lại danh sách công việc cho ngày ${selectedDate}`,
        },
        {
          role: "assistant",
          content: `Đã phân bổ thành công! ${response.explanation}`,
        },
      ];

      const before = { tasks, explanation, chatHistory };
      setExplanation(response.explanation);
      setChatHistory(newChat);
      setTasks(response.tasks);
      saveDailyState(response.tasks, response.explanation, newChat);

      showUndo(
        calculateTotalHours(response.tasks) === 8.0 ? "Đã phân bổ đủ 8 giờ." : "Đã phân bổ lại thời gian.",
        () => {
          setTasks(before.tasks);
          setExplanation(before.explanation);
          setChatHistory(before.chatHistory);
          saveDailyState(before.tasks, before.explanation, before.chatHistory);
        }
      );
    } catch (error: any) {
      antdMessage.error(error.message || "Đã xảy ra lỗi khi gọi AI.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Gửi chat yêu cầu điều chỉnh ngày
  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    if (tasks.length === 0) {
      antdMessage.warning("Thêm công việc trước khi nhờ AI điều chỉnh.");
      return;
    }

    const userMsg = chatInput.trim();
    const updatedHistory: ChatMessage[] = [
      ...chatHistory,
      { role: "user", content: userMsg },
    ];
    
    setChatHistory(updatedHistory);
    setChatInput("");
    setIsChatting(true);

    try {
      const response = await adjustTasksWithChat(
        tasks,
        userMsg,
        updatedHistory,
        aiConfig
      );

      const nextHistory: ChatMessage[] = [
        ...updatedHistory,
        { role: "assistant", content: response.aiMessage },
      ];

      setChatHistory(nextHistory);
      setTasks(response.tasks);
      saveDailyState(response.tasks, explanation, nextHistory);

      if (calculateTotalHours(response.tasks) === 8.0) {
        antdMessage.success("Đã điều chỉnh, tổng vẫn đủ 8 giờ.");
      }
    } catch (error: any) {
      antdMessage.error(error.message || "Đã xảy ra lỗi khi điều chỉnh.");
    } finally {
      setIsChatting(false);
    }
  };

  // Phân tích văn bản thô (Ngày & Danh sách công việc)
  const handleParseRawTasks = async () => {
    if (!rawInputText.trim()) {
      antdMessage.warning("Dán danh sách công việc vào ô văn bản trước.");
      return;
    }

    setIsParsingRaw(true);
    try {
      const response = await parseRawTasksWithAI(rawInputText, aiConfig);
      const targetDate = response.date;
      const existing: Task[] =
        targetDate === selectedDate ? tasks : JSON.parse(localStorage.getItem(`logtime_tasks_${targetDate}`) || "[]");
      const prevChat: ChatMessage[] =
        targetDate === selectedDate ? chatHistory : JSON.parse(localStorage.getItem(`logtime_chat_${targetDate}`) || "[]");

      const apply = () => {
        const newChat: ChatMessage[] = [
          ...prevChat,
          { role: "system", content: `Đã nhập từ văn bản cho ngày ${dayjs(targetDate).format("DD/MM/YYYY")}` },
          { role: "assistant", content: response.explanation },
        ];
        // Lưu theo đúng ngày AI nhận diện, rồi mới chuyển ngày để effect tải lại đúng dữ liệu
        saveDailyState(response.tasks, response.explanation, newChat, targetDate);
        if (targetDate === selectedDate) {
          setTasks(response.tasks);
          setExplanation(response.explanation);
          setChatHistory(newChat);
        } else {
          setSelectedDate(targetDate);
        }
        setRawInputText("");
        antdMessage.success(`Đã thêm ${response.tasks.length} công việc cho ngày ${dayjs(targetDate).format("DD/MM/YYYY")}.`);
      };

      if (existing.length > 0) {
        Modal.confirm({
          title: `Thay thế ${existing.length} công việc của ngày ${dayjs(targetDate).format("DD/MM/YYYY")}?`,
          content: "Ngày này đã có kế hoạch. Danh sách mới từ văn bản sẽ thay thế toàn bộ danh sách hiện tại.",
          okText: "Thay thế",
          okButtonProps: { danger: true },
          cancelText: "Giữ nguyên",
          onOk: apply,
        });
      } else {
        apply();
      }
    } catch (error: any) {
      antdMessage.error(error.message || "Không phân tích được văn bản. Kiểm tra cài đặt AI rồi thử lại.");
    } finally {
      setIsParsingRaw(false);
    }
  };

  // Xóa lịch sử chat
  const handleClearChat = () => {
    const initialChat: ChatMessage[] = [
      {
        role: "assistant",
        content: "Nhắn yêu cầu để điều chỉnh thời gian, ví dụ: “Giảm review còn 1 giờ”.",
      },
    ];
    setChatHistory(initialChat);
    saveDailyState(tasks, explanation, initialChat);
  };

  // Xuất file CSV ngày
  const handleExportCSV = () => {
    if (tasks.length === 0) {
      antdMessage.warning("Chưa có dữ liệu để xuất.");
      return;
    }

    const headers = "ID,Tên công việc,Độ quan trọng,Danh mục,Thời gian (Giờ),Đã khóa,Lý do phân bổ\n";
    const rows = tasks
      .map(
        (t) =>
          `"${t.id}","${t.name.replace(/"/g, '""')}","${t.importance}","${t.category}",${t.duration},${
            t.isLocked
          },"${(t.aiReason || "").replace(/"/g, '""')}"`
      )
      .join("\n");

    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `logtime_${selectedDate}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    antdMessage.success("Đã tải file CSV.");
  };

  // Copy báo cáo ngày
  const handleExportText = () => {
    if (tasks.length === 0) {
      antdMessage.warning("Chưa có dữ liệu để xuất.");
      return;
    }

    const lines = [
      `--- BÁO CÁO LOGTIME NGÀY ${selectedDate} ---`,
      `Tổng số giờ: ${totalHours}h`,
      "",
    ];

    tasks.forEach((t, i) => {
      lines.push(`${i + 1}. [${t.category}] ${t.name}: ${t.duration}h (${t.importance.toUpperCase()}) - ${t.aiReason || ""}`);
    });

    navigator.clipboard.writeText(lines.join("\n"));
    antdMessage.success("Đã sao chép báo cáo.");
  };

  // Lưu API Key & cấu hình Redmine
  const handleSaveApiKey = async () => {
    saveAiSettings(aiSettings);
    setSavedAiSettings(aiSettings);
    localStorage.setItem("logtime_redmine_default_project", redmineDefaultProject);
    
    try {
      const res = await fetch("/api/save-redmine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server: redmineServer,
          apiKey: redmineApiKey,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedRedmine({ server: redmineServer, apiKey: "" });
        setRedmineApiKey("");
        setRedmineKeyHint(data.hasApiKey ? data.apiKeyHint : "");
        antdMessage.success("Đã lưu cài đặt.");
      } else {
        antdMessage.error("Không lưu được cài đặt Redmine: " + data.error);
      }
    } catch (e: any) {
      antdMessage.error("Không kết nối được máy chủ ứng dụng: " + e.message);
    }
  };

  const isSettingsDirty =
    JSON.stringify(aiSettings) !== JSON.stringify(savedAiSettings) ||
    redmineServer !== savedRedmine.server ||
    redmineApiKey !== savedRedmine.apiKey ||
    redmineDefaultProject !== (localStorage.getItem("logtime_redmine_default_project") || "");

  const revertSettings = () => {
    setAiSettings(savedAiSettings);
    setRedmineServer(savedRedmine.server);
    setRedmineApiKey(savedRedmine.apiKey);
    setRedmineDefaultProject(localStorage.getItem("logtime_redmine_default_project") || "");
  };

  // Rời trang Cài đặt khi còn thay đổi chưa lưu thì hỏi để tránh mất dữ liệu
  const navigateTo = (key: typeof activeModule) => {
    if (activeModule === "settings" && key !== "settings" && isSettingsDirty) {
      Modal.confirm({
        title: "Lưu thay đổi trong Cài đặt?",
        content: "Nếu không lưu, các thay đổi vừa nhập sẽ bị bỏ.",
        okText: "Lưu",
        cancelText: "Bỏ thay đổi",
        onOk: async () => {
          await handleSaveApiKey();
          setActiveModule(key);
        },
        onCancel: () => {
          revertSettings();
          setActiveModule(key);
        },
      });
      return;
    }
    setActiveModule(key);
  };

  // Mọi lần log đều qua modal xác nhận dạng cây (Project › Task › Task con) trước khi gửi Redmine
  const openLogConfirm = (entries: LogEntryInput[]) => {
    if (entries.length === 0) {
      antdMessage.warning("Chưa có công việc nào có số giờ lớn hơn 0 để log.");
      return;
    }
    setLogConfirmEntries(entries);
  };

  // Ghi lại task Redmine đã chọn trong modal để lần sau không phải chọn lại
  const handleTaskIssueChange = (date: string, taskId: string, issueId: number, projectName?: string) => {
    const apply = (list: Task[]) =>
      list.map((t) => (t.id === taskId ? { ...t, redmineIssue: issueId, redmineProject: projectName || t.redmineProject } : t));
    const saved = localStorage.getItem(`logtime_tasks_${date}`);
    if (saved) localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(apply(JSON.parse(saved) as Task[])));
    setWeeklyTasks((prev) => (prev[date] ? { ...prev, [date]: apply(prev[date]) } : prev));
    if (date === selectedDate) setTasks((prev) => apply(prev));
  };

  // Thêm task (từ tóm tắt hoạt động) vào kế hoạch của một ngày
  const handleAddTasksToDate = (date: string, newTasks: Task[]) => {
    const saved = localStorage.getItem(`logtime_tasks_${date}`);
    const base = date === selectedDate ? tasks : saved ? (JSON.parse(saved) as Task[]) : weeklyTasks[date] || [];
    const updated = [...base, ...newTasks];
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updated));
    setWeeklyTasks((prev) => ({ ...prev, [date]: updated }));
    if (date === selectedDate) setTasks(updated);
  };

  const getDaySummary = (date: string) => (date in daySummaries ? daySummaries[date] : loadDaySummary(date));

  const handleDaySummaryChange = (date: string, summary: StoredDaySummary | null) => {
    saveDaySummary(summary, date);
    setDaySummaries((prev) => ({ ...prev, [date]: summary }));
  };

  // Tạo task từ các dòng tóm tắt trên thẻ ngày rồi đánh dấu đã tạo
  const handleCreateSummaryRows = (date: string, rows: SummaryRow[]) => {
    const summary = getDaySummary(date);
    if (!summary) return;
    handleAddTasksToDate(date, rows.map(summaryRowToTask));
    const keys = new Set(rows.map((r) => r.key));
    handleDaySummaryChange(date, { ...summary, rows: summary.rows.map((r) => (keys.has(r.key) ? { ...r, added: true } : r)) });
    antdMessage.success(`Đã tạo ${rows.length} task trong kế hoạch ngày ${dayjs(date).format("DD/MM")}. Bấm log để chọn task Redmine.`);
  };

  const handleLogConfirmDone = () => {
    setLogConfirmEntries(null);
    setSelectedTaskIds(new Set());
    celebrate({});
    handleFetchSpentTime();
  };

  // Đồng bộ thời gian lên Redmine cho các task của ngày hiện tại
  const handleSyncToRedmine = () => {
    openLogConfirm(tasks.filter((t) => t.duration > 0).map((task) => ({ date: selectedDate, task })));
  };

  // ---- HANDLERS CHO CÁC TÍNH NĂNG MỚI ----

  // Export CSV Spent Time
  // Export CSV Spent Time
  const handleExportSpentTimeCSV = () => {
    const filtered = spentTimeEntries.filter((entry) => {
      if (spentTimeFilter === "this_month") {
        return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs(), "month");
      }
      if (spentTimeFilter === "last_month") {
        return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs().subtract(1, "month"), "month");
      }
      return true;
    });

    if (filtered.length === 0) {
      antdMessage.warning("Chưa có dữ liệu để xuất.");
      return;
    }

    const header = "Ngày,Dự án,Mã Issue,Hoạt động,Số giờ,Ghi chú\n";
    const rows = filtered.map(e => {
      const date = e.spent_on || "";
      const proj = (e.project?.name || "").replace(/"/g, '""');
      const issue = e.issue?.id || "";
      const act = (e.activity?.name || "").replace(/"/g, '""');
      const hours = e.hours || 0;
      const comment = (e.comments || "").replace(/"/g, '""');
      return `${date},"${proj}","${issue}","${act}",${hours},"${comment}"`;
    }).join("\n");

    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `logtime_report_${spentTimeFilter}_${dayjs().format("YYYYMMDD")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    antdMessage.success("Đã tải file CSV.");
  };

  // Bulk log time to Redmine
  const handleBulkLogTime = () => {
    openLogConfirm(tasks.filter((t) => selectedTaskIds.has(t.id)).map((task) => ({ date: selectedDate, task })));
  };

  // AI Weekly Summary
  const handleGenerateWeeklySummary = async () => {
    setIsGeneratingSummary(true);
    setWeeklySummaryModalOpen(true);
    setWeeklySummaryText("");
    try {
      const result = await generateWeeklySummaryWithAI(weeklyTasks, spentTimeEntries, aiConfig);
      setWeeklySummaryText(result.summary);
    } catch {
      setWeeklySummaryText("Không thể tạo tóm tắt. Vui lòng thử lại.");
    } finally {
      setIsGeneratingSummary(false);
    }
  };


  // Toggle recurring for a task
  const handleToggleRecurring = (task: Task) => {
    const isNowRecurring = !task.isRecurring;
    const newTasks = tasks.map(t => t.id === task.id ? { ...t, isRecurring: isNowRecurring } : t);
    handleSetTasks(newTasks);
    // Cập nhật recurring templates
    let newTemplates: Task[];
    if (isNowRecurring) {
      newTemplates = recurringTemplates.some(rt => rt.name === task.name)
        ? recurringTemplates
        : [...recurringTemplates, { ...task, isRecurring: true }];
    } else {
      newTemplates = recurringTemplates.filter(rt => rt.name !== task.name);
    }
    setRecurringTemplates(newTemplates);
    localStorage.setItem("logtime_recurring_tasks", JSON.stringify(newTemplates));
    antdMessage.success(isNowRecurring ? `"${task.name}" sẽ tự thêm vào các ngày làm việc mỗi tuần.` : `Đã tắt lặp lại cho "${task.name}".`);
  };

  // Request browser notification permission
  const handleRequestNotification = async () => {
    if (!("Notification" in window)) {
      antdMessage.error("Trình duyệt này không hỗ trợ thông báo.");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === "granted") antdMessage.success("Đã bật nhắc nhở cuối ngày.");
    else antdMessage.warning("Thông báo đang bị chặn. Cho phép thông báo trong cài đặt trình duyệt rồi thử lại.");
  };


  // Drag & Drop handlers (weekly view)
  const handleDragStart = (date: string, taskId: string) => setDragTask({ date, taskId });
  const handleDragOver = (e: React.DragEvent, date: string) => { e.preventDefault(); setDragOverDate(date); };
  const handleDrop = (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    if (!dragTask || dragTask.date === targetDate) { setDragTask(null); return; }
    const sourceDay = dragTask.date;
    const taskId = dragTask.taskId;
    const task = (weeklyTasks[sourceDay] || []).find(t => t.id === taskId);
    if (!task) { setDragTask(null); return; }
    const newSource = (weeklyTasks[sourceDay] || []).filter(t => t.id !== taskId);
    const newTarget = [...(weeklyTasks[targetDate] || []), task];
    const updated = { ...weeklyTasks, [sourceDay]: newSource, [targetDate]: newTarget };
    setWeeklyTasks(updated);
    localStorage.setItem(`logtime_tasks_${sourceDay}`, JSON.stringify(newSource));
    localStorage.setItem(`logtime_tasks_${targetDate}`, JSON.stringify(newTarget));
    setDragTask(null);
  };

  // --- LOGIC CHO PHẦN LOGTIME TUẦN (NHIỀU NGÀY) ---

  const getTasksForDate = (date: string): Task[] => {
    if (weeklyTasks[date] !== undefined && weeklyTasks[date].length > 0) {
      return weeklyTasks[date];
    }
    const saved = localStorage.getItem(`logtime_tasks_${date}`);
    return saved ? (JSON.parse(saved) as Task[]) : [];
  };

  const handleSyncSingleTaskToRedmine = (date: string, task: Task) => {
    if (task.duration <= 0) {
      antdMessage.warning("Đặt số giờ lớn hơn 0 trước khi log.");
      return;
    }
    openLogConfirm([{ date, task }]);
  };

  // Thêm nhanh công việc vào một ngày cụ thể trong tuần
  const handleAddQuickWeekTask = (date: string) => {
    const taskName = quickTaskNames[date] || "";
    if (!taskName.trim()) {
      antdMessage.warning("Nhập tên công việc trước khi thêm.");
      return;
    }

    const newTask: Task = {
      id: Math.random().toString(36).substring(2, 9),
      name: taskName.trim(),
      importance: "medium",
      category: "Coding",
      duration: 0,
      isLocked: false,
      aiReason: "Thêm nhanh từ bảng tuần",
    };

    const existingTasks = getTasksForDate(date);
    const updatedTasks = [...existingTasks, newTask];
    const newWeeklyTasks = { ...weeklyTasks, [date]: updatedTasks };
    
    setWeeklyTasks(newWeeklyTasks);
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updatedTasks));

    // Nếu trùng với ngày đang xem ở Daily View, cập nhật luôn
    if (date === selectedDate) {
      setTasks(updatedTasks);
    }

    // Reset input của ngày đó
    setQuickTaskNames({ ...quickTaskNames, [date]: "" });
  };

  // Xóa task nhanh ở bảng tuần
  const handleDeleteWeekTask = (date: string, taskId: string) => {
    const existingTasks = getTasksForDate(date);
    const removed = existingTasks.find((t) => t.id === taskId);
    const writeDay = (list: Task[]) => {
      setWeeklyTasks((prev) => ({ ...prev, [date]: list }));
      localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(list));
      if (date === selectedDate) setTasks(list);
    };
    writeDay(existingTasks.filter((t) => t.id !== taskId));
    showUndo(`Đã xoá "${removed?.name ?? "công việc"}".`, () => writeDay(existingTasks));
  };

  // Toggle Lock nhanh ở bảng tuần
  const handleToggleWeekLock = (date: string, taskId: string, checked: boolean) => {
    const existingTasks = getTasksForDate(date);
    const updatedTasks = existingTasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, isLocked: checked };
      }
      return t;
    });
    const newWeeklyTasks = { ...weeklyTasks, [date]: updatedTasks };

    setWeeklyTasks(newWeeklyTasks);
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updatedTasks));

    if (date === selectedDate) {
      setTasks(updatedTasks);
    }
  };

  // Cập nhật giờ nhanh ở bảng tuần
  const handleUpdateWeekDuration = (date: string, taskId: string, val: number | null) => {
    const duration = val === null ? 0 : val;
    const existingTasks = getTasksForDate(date);
    const updatedTasks = existingTasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, duration, isLocked: duration > 0 ? t.isLocked : false };
      }
      return t;
    });
    const newWeeklyTasks = { ...weeklyTasks, [date]: updatedTasks };

    setWeeklyTasks(newWeeklyTasks);
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updatedTasks));

    if (date === selectedDate) {
      setTasks(updatedTasks);
    }
  };

  // Phân bổ logtime cả tuần bằng AI
  const handleAIWeeklyDistribute = async () => {
    // Kiểm tra xem có ngày nào có công việc hay không
    const days = getWeekDays(selectedDate);
    let hasTasks = false;
    for (const day of days) {
      if ((weeklyTasks[day] || []).length > 0) {
        hasTasks = true;
        break;
      }
    }

    if (!hasTasks) {
      antdMessage.warning("Thêm ít nhất một công việc vào tuần này để AI phân bổ.");
      return;
    }

    setIsWeeklyAnalyzing(true);
    try {
      const response = await distributeWeekTasksWithAI(weeklyTasks, aiConfig);

      // Cập nhật state tuần và lưu trữ cục bộ cho từng ngày
      setWeeklyTasks(response.weeklyTasks);
      setWeeklyExplanation(response.explanation);

      // Lưu trữ chi tiết từng ngày
      days.forEach((day) => {
        const dayTasks = response.weeklyTasks[day] || [];
        localStorage.setItem(`logtime_tasks_${day}`, JSON.stringify(dayTasks));
      });

      // Lưu trữ mô tả tổng kết tuần
      localStorage.setItem(`logtime_weekly_explanation_${days[0]}`, response.explanation);

      // Nếu ngày được chọn đang nằm trong tuần đó, cập nhật luôn giao diện ngày
      if (days.includes(selectedDate)) {
        setTasks(response.weeklyTasks[selectedDate] || []);
        setExplanation(response.explanation);
      }

      antdMessage.success("Đã phân bổ 8 giờ cho từng ngày trong tuần.");
    } catch (error: any) {
      antdMessage.error(error.message || "Không thể gọi AI phân bổ tuần.");
    } finally {
      setIsWeeklyAnalyzing(false);
    }
  };

  // Chuyển sang xem/chỉnh sửa chi tiết một ngày
  const handleViewDayDetail = (date: string) => {
    setSelectedDate(date);
    setActiveModule("daily");
  };

  // Cột bảng của giao diện Ngày
  const columns = [
    {
      title: "Công việc",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: Task) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>
            {text}
            {record.isRecurring && (
              <Tooltip title="Lặp lại mỗi tuần">
                <ReloadOutlined style={{ marginLeft: 6, fontSize: 11, color: "var(--text-secondary)" }} />
              </Tooltip>
            )}
          </div>
          {record.aiReason && (
            <Text type="secondary" style={{ fontSize: "12px" }}>{record.aiReason}</Text>
          )}
        </div>
      ),
    },
    {
      title: "Độ ưu tiên",
      dataIndex: "importance",
      key: "importance",
      width: 120,
      render: (imp: "high" | "medium" | "low") => {
        let className = "tag-low";
        let text = "Thấp";
        if (imp === "high") {
          className = "tag-high";
          text = "Cao";
        } else if (imp === "medium") {
          className = "tag-medium";
          text = "Trung bình";
        }
        return <Tag className={className}>{text}</Tag>;
      },
    },
    {
      title: "Phân loại",
      dataIndex: "category",
      key: "category",
      width: 120,
      render: (cat: string) => (
        <Tag style={{ borderRadius: "4px", background: "var(--primary-light)", color: "var(--text-primary)", border: "1px solid var(--glass-border)" }}>
          {cat || "Coding"}
        </Tag>
      ),
    },
    {
      title: "Số giờ",
      dataIndex: "duration",
      key: "duration",
      width: 120,
      render: (val: number, record: Task) => (
        <InputNumber
          min={0}
          max={8}
          step={0.5}
          value={val}
          onChange={(newVal) => handleUpdateDuration(record.id, newVal)}
          style={{ width: "90px" }}
          addonAfter="h"
        />
      ),
    },
    {
      title: "Issue",
      dataIndex: "redmineIssue",
      key: "redmineIssue",
      width: 130,
      render: (val: number | undefined, record: Task) => (
        <InputNumber
          placeholder="Chưa gắn"
          prefix="#"
          value={val}
          onChange={(newVal) => {
            const newTasks = tasks.map((t) => {
              if (t.id === record.id) {
                return { ...t, redmineIssue: newVal === null ? undefined : newVal };
              }
              return t;
            });
            handleSetTasks(newTasks);
          }}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: "Khoá giờ",
      dataIndex: "isLocked",
      key: "isLocked",
      width: 90,
      align: "center" as const,
      render: (locked: boolean, record: Task) => (
        <Tooltip title={locked ? "Đang khoá: AI giữ nguyên số giờ. Bấm để mở khoá." : "AI có thể chia lại số giờ. Bấm để khoá."}>
          <Switch
            checkedChildren={<LockOutlined />}
            unCheckedChildren={<UnlockOutlined />}
            checked={locked}
            onChange={(checked) => handleToggleLock(record.id, checked)}
          />
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "action",
      width: 96,
      align: "right" as const,
      render: (_: any, record: Task) => (
        <Space size={0}>
          <Tooltip title={record.redmineIssue ? `Đổi issue (đang gắn #${record.redmineIssue})` : "Tìm issue phù hợp bằng AI"}>
            <Button
              type="text"
              aria-label="Gắn issue Redmine"
              icon={<RobotOutlined style={{ color: record.redmineIssue ? "var(--success-color)" : "var(--text-secondary)" }} />}
              onClick={() => handleStartAiMapping(record)}
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "recurring", icon: <ReloadOutlined />, label: record.isRecurring ? "Tắt lặp lại mỗi tuần" : "Lặp lại mỗi tuần" },
                { type: "divider" },
                { key: "delete", icon: <DeleteOutlined />, label: "Xoá", danger: true },
              ],
              onClick: ({ key }) => {
                if (key === "recurring") handleToggleRecurring(record);
                if (key === "delete") handleDeleteTask(record.id);
              },
            }}
          >
            <Button type="text" aria-label="Thao tác khác" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  // Import ticket từ Redmine Dashboard vào Planner
  const handleImportTicket = (ticket: any) => {
    if (tasks.some((t) => t.redmineIssue === ticket.id)) {
      antdMessage.info("Ticket này đã có trong kế hoạch ngày.");
      return;
    }
    
    let importance: "high" | "medium" | "low" = "medium";
    if (ticket.priority?.name.toLowerCase() === "high" || ticket.priority?.name.toLowerCase() === "urgent" || ticket.priority?.name.toLowerCase() === "immediate") {
      importance = "high";
    } else if (ticket.priority?.name.toLowerCase() === "low") {
      importance = "low";
    }

    const newTask: Task = {
      id: Math.random().toString(36).substring(2, 9),
      name: ticket.subject,
      importance,
      category: "Coding",
      duration: ticket.estimated_hours || 0,
      isLocked: ticket.estimated_hours ? true : false,
      aiReason: `Nạp từ ticket Redmine #${ticket.id}`,
      redmineIssue: ticket.id,
      redmineProject: ticket.project?.name || ticket.project?.id?.toString() || undefined,
    };

    const newTasks = [...tasks, newTask];
    handleSetTasks(newTasks);
    antdMessage.success(`Đã thêm #${ticket.id} vào kế hoạch ngày ${dayjs(selectedDate).format("DD/MM")}.`);
  };

  // Khởi chạy modal ánh xạ AI đơn lẻ
  const handleStartAiMapping = async (task: Task) => {
    setMappingTask(task);
    setIsAiLoading(true);
    setAiSuggestion(null);
    setIsMappingModalOpen(true);
    
    setManualMatchType("none");
    setManualIssueId(task.redmineIssue);
    setManualParentIssueId(undefined);
    setManualSubject(task.name);
    setManualProject(task.redmineProject || redmineDefaultProject || "");
    setManualDescription(`Subtask created for daily task: ${task.name}`);
    setManualEstimatedHours(task.duration > 0 ? task.duration : undefined);

    try {
      let candidates = userRedmineTickets;
      if (candidates.length === 0) {
        const res = await fetch("/api/redmine/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignee: "me", status: "*" }),
        });
        candidates = await res.json();
        setUserRedmineTickets(candidates);
      }

      const queryKeyword = await extractSearchQuery(task.name, aiConfig);
      
      const searchRes = await fetch("/api/redmine/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryKeyword, status: "*" }),
      });
      const queryCandidates = await searchRes.json();
      
      const allCandidates = [...candidates];
      queryCandidates.forEach((c: any) => {
        if (!allCandidates.some((existing) => existing.id === c.id)) {
          allCandidates.push(c);
        }
      });

      const suggestion = await analyzeRedmineMapping(task.name, allCandidates, aiConfig);
      setAiSuggestion(suggestion);
      
      setManualMatchType(suggestion.type);
      if (suggestion.type === "direct") {
        setManualIssueId(suggestion.issueId);
        setManualProject(suggestion.projectName || suggestion.projectId?.toString() || "");
      } else if (suggestion.type === "subtask") {
        setManualParentIssueId(suggestion.parentIssueId);
        setManualProject(suggestion.projectName || suggestion.projectId?.toString() || "");
      }
    } catch (err: any) {
      antdMessage.error("Lỗi khi phân tích ánh xạ: " + err.message);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Xác nhận và áp dụng ánh xạ trong modal đơn lẻ
  const handleConfirmMapping = async () => {
    if (!mappingTask) return;
    
    setIsSyncingRedmine(true);
    try {
      let updatedIssueId = manualIssueId;
      let updatedProject = manualProject;

      if (manualMatchType === "subtask") {
        if (!manualParentIssueId) {
          antdMessage.warning("Vui lòng chọn hoặc điền mã Issue cha!");
          setIsSyncingRedmine(false);
          return;
        }
        
        antdMessage.loading({ content: "Đang tạo subtask mới trên Redmine...", key: "create-subtask" });
        const res = await fetch("/api/redmine/create-issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: manualProject || undefined,
            parent: manualParentIssueId,
            subject: manualSubject,
            description: manualDescription,
            estimatedHours: manualEstimatedHours,
          }),
        });
        
        const createdIssue = await res.json();
        
        if (createdIssue && createdIssue.id) {
          updatedIssueId = createdIssue.id;
          updatedProject = createdIssue.project?.name || createdIssue.project?.id?.toString() || manualProject;
          antdMessage.success({ content: `Đã tạo thành công subtask #${createdIssue.id} trên Redmine!`, key: "create-subtask" });
        } else {
          throw new Error(createdIssue.error || "Không thể tạo issue mới trên Redmine. Vui lòng kiểm tra trạng thái Issue cha.");
        }
      }

      const newTasks = tasks.map((t) => {
        if (t.id === mappingTask.id) {
          return {
            ...t,
            redmineIssue: manualMatchType === "none" ? undefined : updatedIssueId,
            redmineProject: manualMatchType === "none" ? undefined : updatedProject,
            aiReason: manualMatchType === "none" ? "Không ánh xạ" : `Ánh xạ ${manualMatchType === "direct" ? "trực tiếp" : "subtask con"} vào #${updatedIssueId}`,
          };
        }
        return t;
      });
      handleSetTasks(newTasks);
      
      handleRefreshDashboardTickets();
      setIsMappingModalOpen(false);
      setMappingTask(null);
    } catch (err: any) {
      antdMessage.error({ content: "Lỗi: " + err.message, key: "create-subtask" });
    } finally {
      setIsSyncingRedmine(false);
    }
  };

  // Tìm kiếm thủ công các issue trong modal
  const handleSearchRedmineIssues = async (queryText: string) => {
    if (!queryText.trim()) return;
    setIsSearchingIssues(true);
    try {
      const res = await fetch("/api/redmine/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText, status: "*" }),
      });
      const results = await res.json();
      setSearchIssuesResults(results);
    } catch (err: any) {
      antdMessage.error("Lỗi khi tìm kiếm Redmine: " + err.message);
    } finally {
      setIsSearchingIssues(false);
    }
  };

  // Khởi chạy modal ánh xạ AI hàng loạt
  const handleStartBulkAiMapping = async () => {
    const unmappedTasks = tasks.filter((t) => !t.redmineIssue);
    if (unmappedTasks.length === 0) {
      antdMessage.info("Tất cả công việc đã gắn issue Redmine.");
      return;
    }

    setIsBulkMappingLoading(true);
    setIsBulkMappingModalOpen(true);
    setBulkMappingSuggestions([]);

    try {
      let candidates = userRedmineTickets;
      if (candidates.length === 0) {
        const res = await fetch("/api/redmine/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignee: "me", status: "*" }),
        });
        candidates = await res.json();
        setUserRedmineTickets(candidates);
      }

      const suggestionsList: any[] = [];

      for (const task of unmappedTasks) {
        const queryKeyword = await extractSearchQuery(task.name, aiConfig);
        
        const searchRes = await fetch("/api/redmine/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryKeyword, status: "*" }),
        });
        const queryCandidates = await searchRes.json();
        
        const allCandidates = [...candidates];
        queryCandidates.forEach((c: any) => {
          if (!allCandidates.some((existing) => existing.id === c.id)) {
            allCandidates.push(c);
          }
        });

        const suggestion = await analyzeRedmineMapping(task.name, allCandidates, aiConfig);
        
        suggestionsList.push({
          task,
          suggestion,
          approved: suggestion.type !== "none",
          manualMatchType: suggestion.type,
          manualIssueId: suggestion.type === "direct" ? suggestion.issueId : undefined,
          manualParentIssueId: suggestion.type === "subtask" ? suggestion.parentIssueId : undefined,
          manualProject: suggestion.projectName || suggestion.projectId?.toString() || "",
        });
      }

      setBulkMappingSuggestions(suggestionsList);
    } catch (err: any) {
      antdMessage.error("Lỗi trong quá trình tự động phân tích hàng loạt: " + err.message);
    } finally {
      setIsBulkMappingLoading(false);
    }
  };

  // Xác nhận và áp dụng ánh xạ hàng loạt
  const handleConfirmBulkMapping = async () => {
    setIsSyncingRedmine(true);
    antdMessage.loading({ content: "Đang áp dụng ánh xạ hàng loạt...", key: "bulk-map" });
    
    let updatedTasks = [...tasks];
    let createdCount = 0;
    let directCount = 0;

    try {
      for (const item of bulkMappingSuggestions) {
        if (!item.approved) continue;

        let finalIssueId = item.manualIssueId;
        let finalProject = item.manualProject;

        if (item.manualMatchType === "direct" && item.manualIssueId) {
          directCount++;
        } else if (item.manualMatchType === "subtask" && item.manualParentIssueId) {
          const res = await fetch("/api/redmine/create-issue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project: item.manualProject || undefined,
              parent: item.manualParentIssueId,
              subject: item.task.name,
              description: `Subtask created via bulk mapper for daily task: ${item.task.name}`,
              estimatedHours: item.task.duration > 0 ? item.task.duration : undefined,
            }),
          });
          const createdIssue = await res.json();
          if (createdIssue && createdIssue.id) {
            finalIssueId = createdIssue.id;
            finalProject = createdIssue.project?.name || createdIssue.project?.id?.toString() || item.manualProject;
            createdCount++;
          }
        }

        if (finalIssueId) {
          updatedTasks = updatedTasks.map((t) => {
            if (t.id === item.task.id) {
              return {
                ...t,
                redmineIssue: finalIssueId,
                redmineProject: finalProject || undefined,
                aiReason: `Ánh xạ hàng loạt (${item.manualMatchType === "direct" ? "trực tiếp" : "tạo subtask"} #${finalIssueId})`,
              };
            }
            return t;
          });
        }
      }

      handleSetTasks(updatedTasks);
      handleRefreshDashboardTickets();
      setIsBulkMappingModalOpen(false);
      antdMessage.success({
        content: `Ánh xạ thành công! Gắn trực tiếp: ${directCount} tasks, tạo mới subtask: ${createdCount} tasks.`,
        key: "bulk-map",
      });
    } catch (err: any) {
      antdMessage.error({ content: "Có lỗi khi chạy ánh xạ hàng loạt: " + err.message, key: "bulk-map" });
    } finally {
      setIsSyncingRedmine(false);
    }
  };

  const weekDays = getWeekDays(selectedDate);
  const mondayFormatted = dayjs(weekDays[0]).format("DD/MM/YYYY");
  const sundayFormatted = dayjs(weekDays[6]).format("DD/MM/YYYY");

  return (
    <ConfigProvider
      theme={{
        algorithm: themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: themeMode === "dark" ? "#f0eee6" : "#5e5d59",
          colorTextLightSolid: themeMode === "dark" ? "#141413" : "#ffffff",
          colorBgBase: themeMode === "dark" ? "#141413" : "#faf9f5",
          colorLink: themeMode === "dark" ? "#e8a383" : "#b0532f",
          colorLinkHover: themeMode === "dark" ? "#f0bfa6" : "#8c3f22",
          borderRadius: 8,
        },
      }}
    >
      <Layout style={{ minHeight: "100vh", background: "transparent" }}>
        
        {/* Left Sidebar */}
        <Sider
          breakpoint="lg"
          collapsedWidth="0"
          trigger={null}
          width={280}
          collapsed={isSiderCollapsed}
          onBreakpoint={(broken) => {
            setIsNarrowScreen(broken);
            setIsSiderCollapsed(broken);
          }}
          className="app-sider"
          style={{
            background: "var(--header-bg)",
            borderRight: "1px solid var(--glass-border)",
            position: "fixed",
            height: "100vh",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: isNarrowScreen ? 1000 : 100,
            boxShadow: isNarrowScreen ? "4px 0 24px rgba(0,0,0,0.25)" : "none"
          }}
        >
          <div style={{ padding: "24px", display: "flex", alignItems: "center", gap: "12px" }}>
            <img src="/logo.png" alt="" width={40} height={40} style={{ display: "block" }} />
            <div>
              <div style={{ fontSize: "20px", fontWeight: 600, fontFamily: "Lora, serif", color: "var(--text-primary)", lineHeight: 1.2 }}>LogTime AI</div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500, letterSpacing: "0.5px" }}>TRỢ LÝ LOG TIME</div>
            </div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[activeModule]}
            onClick={({ key }) => {
              navigateTo(key as typeof activeModule);
              if (isNarrowScreen) setIsSiderCollapsed(true);
            }}
            style={{ background: "transparent", borderRight: 0, padding: "0 10px" }}
            items={[
              {
                type: 'group',
                label: <span className="sider-group-label">Log time</span>,
                children: [
                  { key: "spent_time", icon: <ClockCircleOutlined />, label: PAGE_META.spent_time.title },
                  { key: "daily", icon: <ScheduleOutlined />, label: PAGE_META.daily.title },
                  { key: "weekly", icon: <CalendarOutlined />, label: PAGE_META.weekly.title },
                ]
              },
              {
                type: 'group',
                label: <span className="sider-group-label">Redmine</span>,
                children: [
                  { key: "dashboard", icon: <DashboardOutlined />, label: PAGE_META.dashboard.title },
                  { key: "team", icon: <TeamOutlined />, label: PAGE_META.team.title },
                ]
              },
              {
                type: 'group',
                label: <span className="sider-group-label">Ứng dụng</span>,
                children: [
                  { key: "settings", icon: <SettingOutlined />, label: PAGE_META.settings.title },
                ]
              },
            ]}
          />
        </Sider>

        {isNarrowScreen && !isSiderCollapsed && (
          <div className="sider-backdrop" onClick={() => setIsSiderCollapsed(true)} />
        )}

        <Layout className="main-layout-wrapper" style={{ minHeight: "100vh" }}>
          {/* App Header */}
          <Header className="app-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "64px", padding: "0 24px", lineHeight: "normal" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
              <Button
                type="text"
                className="mobile-nav-toggle"
                icon={<MenuOutlined />}
                onClick={() => setIsSiderCollapsed(!isSiderCollapsed)}
                aria-label="Mở menu"
              />
              <div style={{ minWidth: 0 }}>
                <div className="header-title">{PAGE_META[activeModule].title}</div>
                <div className="header-subtitle">
                  {activeModule === "daily" && formatVietnameseDate(selectedDate)}
                  {activeModule === "weekly" && `${mondayFormatted} – ${sundayFormatted}`}
                  {activeModule !== "daily" && activeModule !== "weekly" && PAGE_META[activeModule].subtitle}
                </div>
              </div>
            </div>
            
            <Space size="small">
              {/* Điều hướng ngày/tuần: lùi · hôm nay · tiến · chọn ngày */}
              {(activeModule === "daily" || activeModule === "weekly") && (
                <Space.Compact>
                  <Tooltip title={activeModule === "weekly" ? "Tuần trước" : "Ngày trước"}>
                    <Button
                      icon={<LeftOutlined />}
                      aria-label={activeModule === "weekly" ? "Tuần trước" : "Ngày trước"}
                      onClick={() => setSelectedDate(dayjs(selectedDate).subtract(1, activeModule === "weekly" ? "week" : "day").format("YYYY-MM-DD"))}
                    />
                  </Tooltip>
                  <Button
                    disabled={activeModule === "weekly" ? getWeekDays(selectedDate).includes(dayjs().format("YYYY-MM-DD")) : selectedDate === dayjs().format("YYYY-MM-DD")}
                    onClick={() => setSelectedDate(dayjs().format("YYYY-MM-DD"))}
                  >
                    {activeModule === "weekly" ? "Tuần này" : "Hôm nay"}
                  </Button>
                  <Tooltip title={activeModule === "weekly" ? "Tuần sau" : "Ngày sau"}>
                    <Button
                      icon={<RightOutlined />}
                      aria-label={activeModule === "weekly" ? "Tuần sau" : "Ngày sau"}
                      onClick={() => setSelectedDate(dayjs(selectedDate).add(1, activeModule === "weekly" ? "week" : "day").format("YYYY-MM-DD"))}
                    />
                  </Tooltip>
                  <DatePicker
                    value={dayjs(selectedDate)}
                    onChange={(date) => setSelectedDate(date ? date.format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"))}
                    allowClear={false}
                    format="DD/MM/YYYY"
                    style={{ width: "130px" }}
                  />
                </Space.Compact>
              )}

              <Tooltip title={themeMode === "dark" ? "Giao diện sáng" : "Giao diện tối"}>
                <Button
                  type="text"
                  icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
                  aria-label={themeMode === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
                  onClick={() => handleToggleTheme(themeMode !== "dark")}
                />
              </Tooltip>
            </Space>
          </Header>

          {/* Content Layout */}
          <Content className="app-content">
            {activeModule !== "settings" && (() => {
              const savedAi = resolveAiConfig(savedAiSettings);
              const missing: string[] = [];
              if (redmineLoaded && (!savedRedmine.server || !redmineKeyHint)) missing.push("kết nối Redmine");
              if (PROVIDERS[savedAi.provider].needsKey ? !savedAi.apiKey : !savedAi.baseUrl) missing.push("API key AI");
              if (missing.length === 0) return null;
              return (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 20 }}
                  message={`Cần thiết lập ${missing.join(" và ")} để dùng đầy đủ tính năng`}
                  description={missing.includes("kết nối Redmine")
                    ? "Nhập URL và API key Redmine để xem thời gian đã log và log giờ trực tiếp."
                    : "Nhập API key của nhà cung cấp AI để tự tách việc và phân bổ giờ."}
                  action={<Button size="small" type="primary" onClick={() => setActiveModule("settings")}>Mở Cài đặt</Button>}
                />
              );
            })()}
            
            {/* GIAO DIỆN XEM HÀNG NGÀY (DAILY VIEW) */}
            {activeModule === "daily" && (() => {
              const dayStatus = getHoursStatus(totalHours);
              const loggableCount = tasks.filter((t) => t.duration > 0).length;
              const unmappedCount = tasks.filter((t) => !t.redmineIssue).length;
              return (
              <Row gutter={[24, 24]}>
                {/* Cột chính bên trái */}
                <Col xs={24} lg={16}>
                  <Row gutter={[16, 16]} style={{ marginBottom: "20px" }}>
                    <Col xs={12} sm={8}>
                      <div className="glass-stat-card">
                        <div className="label">Tổng thời gian</div>
                        <div className="value" style={{ color: dayStatus.color }}>
                          {totalHours} / 8.0 giờ
                        </div>
                        <div className="hint">{tasks.length === 0 ? "Chưa có công việc" : dayStatus.label}</div>
                      </div>
                    </Col>

                    <Col xs={12} sm={8}>
                      <div className="glass-stat-card">
                        <div className="label">Công việc</div>
                        <div className="value">{tasks.length}</div>
                        <div className="hint">{unmappedCount > 0 ? `${unmappedCount} việc chưa gắn issue` : tasks.length > 0 ? "Đã gắn issue đầy đủ" : "—"}</div>
                      </div>
                    </Col>

                    <Col xs={24} sm={8}>
                      <div className="glass-stat-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
                        <div className="label" style={{ marginBottom: "8px" }}>Tiến độ</div>
                        <Progress
                          percent={Math.min(100, (totalHours / 8) * 100)}
                          status={dayStatus.key === "ok" ? "success" : "normal"}
                          strokeColor={dayStatus.color}
                          showInfo={false}
                          style={{ margin: 0 }}
                        />
                      </div>
                    </Col>
                  </Row>

                  {/* Nhập công việc: cách nhanh nhất (dán danh sách) đặt trước */}
                  <Card
                    className="glass-panel"
                    styles={{ body: { padding: "8px 20px 20px" } }}
                  >
                    <Tabs
                      defaultActiveKey={tasks.length === 0 ? "paste" : "single"}
                      items={[
                        {
                          key: "paste",
                          label: <span><ThunderboltOutlined /> Dán danh sách</span>,
                          children: (
                            <div>
                              <Text type="secondary" style={{ fontSize: "13px", display: "block", marginBottom: "12px" }}>
                                Dán ngày và các việc đã làm. AI sẽ nhận diện ngày, tách từng việc và chia đủ 8 giờ.
                              </Text>
                              <Input.TextArea
                                autoSize={{ minRows: 4, maxRows: 10 }}
                                placeholder={`Ví dụ:\nNgày 4/5/2026\n- Kiểm tra khảo sát ML\n- Ovaltine popup\n- Davipharm tin tức video`}
                                value={rawInputText}
                                onChange={(e) => setRawInputText(e.target.value)}
                                onKeyDown={(e) => {
                                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleParseRawTasks();
                                }}
                                style={{ marginBottom: "12px" }}
                              />
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                <Text type="secondary" style={{ fontSize: "12px" }}>Ctrl/⌘ + Enter để gửi</Text>
                                <Button
                                  type="primary"
                                  icon={<ThunderboltOutlined />}
                                  onClick={handleParseRawTasks}
                                  loading={isParsingRaw}
                                  disabled={!rawInputText.trim()}
                                >
                                  Phân tích bằng AI
                                </Button>
                              </div>
                            </div>
                          ),
                        },
                        {
                          key: "single",
                          label: <span><PlusOutlined /> Thêm từng việc</span>,
                          children: (
                            <div>
                              <Row gutter={[12, 12]} align="bottom">
                                <Col xs={24} md={10}>
                                  <div className="field-label">Tên công việc</div>
                                  <Input
                                    placeholder="Ví dụ: Họp standup, Code API đăng nhập…"
                                    value={inputName}
                                    onChange={(e) => setInputName(e.target.value)}
                                    onPressEnter={handleAddTask}
                                  />
                                </Col>
                                <Col xs={12} md={5}>
                                  <div className="field-label">Số giờ</div>
                                  <InputNumber
                                    min={0}
                                    max={8}
                                    step={0.5}
                                    value={inputDuration}
                                    onChange={(val) => setInputDuration(val || 0)}
                                    onPressEnter={handleAddTask}
                                    style={{ width: "100%" }}
                                    addonAfter="h"
                                  />
                                </Col>
                                <Col xs={12} md={5}>
                                  <div className="field-label">Issue Redmine</div>
                                  <InputNumber
                                    placeholder="Không bắt buộc"
                                    value={inputRedmineIssue}
                                    onChange={(val) => setInputRedmineIssue(val || undefined)}
                                    onPressEnter={handleAddTask}
                                    style={{ width: "100%" }}
                                    prefix="#"
                                  />
                                </Col>
                                <Col xs={24} md={4}>
                                  <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    onClick={handleAddTask}
                                    disabled={!inputName.trim()}
                                    style={{ width: "100%" }}
                                  >
                                    Thêm
                                  </Button>
                                </Col>
                              </Row>
                              <Row gutter={[12, 12]} style={{ marginTop: "12px" }}>
                                <Col xs={12} md={6}>
                                  <div className="field-label">Độ ưu tiên</div>
                                  <Select value={inputImportance} onChange={setInputImportance} style={{ width: "100%" }}>
                                    <Option value="high">Cao</Option>
                                    <Option value="medium">Trung bình</Option>
                                    <Option value="low">Thấp</Option>
                                  </Select>
                                </Col>
                                <Col xs={12} md={6}>
                                  <div className="field-label">Danh mục</div>
                                  <Select value={inputCategory} onChange={setInputCategory} style={{ width: "100%" }}>
                                    <Option value="Coding">Coding</Option>
                                    <Option value="Meeting">Meeting</Option>
                                    <Option value="Review">Review</Option>
                                    <Option value="Research">Research</Option>
                                    <Option value="Documentation">Docs</Option>
                                    <Option value="Other">Khác</Option>
                                  </Select>
                                </Col>
                                <Col xs={24} md={12}>
                                  <div className="field-label">Dự án Redmine</div>
                                  <Input
                                    placeholder={redmineDefaultProject ? `Mặc định: ${redmineDefaultProject}` : "Không bắt buộc — giúp AI tìm đúng issue"}
                                    value={inputRedmineProject}
                                    onChange={(e) => setInputRedmineProject(e.target.value)}
                                    onPressEnter={handleAddTask}
                                  />
                                </Col>
                              </Row>
                              <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "8px" }}>
                                Nhập số giờ thì việc sẽ được khoá giờ; để 0 cho AI tự chia.
                              </Text>
                            </div>
                          ),
                        },
                      ]}
                    />
                  </Card>

                  {/* Bảng công việc */}
                  <Card
                    className="glass-panel"
                    title={
                      <div className="panel-header">
                        <span className="panel-title">
                          <ScheduleOutlined /> Công việc ngày {dayjs(selectedDate).format("DD/MM/YYYY")}
                        </span>
                        <Space wrap>
                          <Button
                            icon={<ThunderboltOutlined />}
                            onClick={handleAIDistribute}
                            loading={isAnalyzing}
                            disabled={tasks.length === 0}
                          >
                            Phân bổ bằng AI
                          </Button>
                          <Tooltip title={loggableCount === 0 ? "Đặt số giờ cho ít nhất một việc để log" : undefined}>
                            <Button
                              type="primary"
                              icon={<UploadOutlined />}
                              onClick={handleSyncToRedmine}
                              loading={isSyncingRedmine}
                              disabled={loggableCount === 0}
                            >
                              Log lên Redmine
                            </Button>
                          </Tooltip>
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: [
                                { key: "map", icon: <RobotOutlined />, label: "Gắn issue tự động (AI)", disabled: unmappedCount === 0 },
                                { type: "divider" },
                                { key: "copy", icon: <CopyOutlined />, label: "Sao chép báo cáo", disabled: tasks.length === 0 },
                                { key: "csv", icon: <DownloadOutlined />, label: "Tải file CSV", disabled: tasks.length === 0 },
                                ...(tasks.length === 0
                                  ? [{ type: "divider" as const }, { key: "sample", icon: <HistoryOutlined />, label: "Dùng danh sách mẫu" }]
                                  : []),
                              ],
                              onClick: ({ key }) => {
                                if (key === "map") handleStartBulkAiMapping();
                                if (key === "copy") handleExportText();
                                if (key === "csv") handleExportCSV();
                                if (key === "sample") handleQuickPopulate();
                              },
                            }}
                          >
                            <Button icon={<MoreOutlined />} aria-label="Thao tác khác" loading={isBulkMappingLoading} />
                          </Dropdown>
                        </Space>
                      </div>
                    }
                    styles={{ body: { padding: 0 } }}
                  >
                    {explanation && (
                      <div className="callout" style={{ margin: "16px 20px 0" }}>
                        <div className="section-label"><BulbOutlined /> Nhận xét của AI</div>
                        <Text style={{ fontSize: "13px" }}>{explanation}</Text>
                      </div>
                    )}

                    {selectedTaskIds.size > 0 && (
                      <div className="selection-bar" style={{ marginTop: explanation ? 16 : 0 }}>
                        <span>Đã chọn <strong>{selectedTaskIds.size}</strong> việc</span>
                        <Space>
                          <Button size="small" onClick={() => setSelectedTaskIds(new Set())}>Bỏ chọn</Button>
                          <Button size="small" type="primary" icon={<UploadOutlined />} onClick={handleBulkLogTime}>
                            Log {selectedTaskIds.size} việc đã chọn
                          </Button>
                        </Space>
                      </div>
                    )}

                    <Table
                      rowSelection={{
                        selectedRowKeys: Array.from(selectedTaskIds),
                        onChange: (selectedRowKeys) => {
                          setSelectedTaskIds(new Set(selectedRowKeys as string[]));
                        },
                      }}
                      dataSource={tasks}
                      columns={columns}
                      rowKey="id"
                      pagination={false}
                      scroll={{ x: 860 }}
                      locale={{
                        emptyText: (
                          <EmptyIllustration
                            themeMode={themeMode}
                            description="Chưa có công việc cho ngày này. Dán danh sách ở trên để AI tách việc, hoặc thêm từng việc."
                          />
                        ),
                      }}
                      rowClassName={(record) => (record.isLocked ? "task-locked-row" : "task-unlocked-row")}
                    />
                  </Card>
                </Col>

                {/* Cột phụ bên phải: trợ lý AI */}
                <Col xs={24} lg={8}>
                  <Card
                    className="glass-panel"
                    title={
                      <div className="panel-header">
                        <span className="panel-title">
                          <RobotOutlined />
                          Trợ lý AI
                        </span>
                        <Tooltip title="Xoá hội thoại">
                          <Button
                            type="text"
                            size="small"
                            icon={<ClearOutlined />}
                            onClick={handleClearChat}
                            aria-label="Xoá hội thoại"
                          />
                        </Tooltip>
                      </div>
                    }
                    styles={{ body: { padding: "16px" } }}
                  >
                    <div className="chat-container">
                      <div className="chat-messages">
                        {chatHistory.map((msg, index) => (
                          <div key={index} className={`chat-bubble ${msg.role}`}>
                            {msg.content}
                          </div>
                        ))}
                        {isChatting && (
                          <div className="chat-bubble assistant" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <Badge status="processing" color="var(--primary-color)" />
                            <span>Đang điều chỉnh…</span>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>

                      <div style={{ display: "flex", gap: "8px" }}>
                        <Input
                          placeholder={tasks.length === 0 ? "Thêm công việc trước khi nhờ AI điều chỉnh" : "Ví dụ: Họp 1 tiếng, còn lại cho code"}
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onPressEnter={handleSendChat}
                          disabled={isChatting || tasks.length === 0}
                        />
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={handleSendChat}
                          loading={isChatting}
                          disabled={!chatInput.trim() || tasks.length === 0}
                          aria-label="Gửi"
                        />
                      </div>
                    </div>
                  </Card>
                </Col>
              </Row>
              );
            })()}

            {/* GIAO DIỆN XEM THEO TUẦN (WEEKLY VIEW) */}
            {activeModule === "weekly" && (
              <div>
                <Card
                  className="glass-panel"
                  title={
                    <div className="panel-header">
                      <div>
                        <span className="panel-title">
                          <CalendarOutlined /> Tuần {mondayFormatted} – {sundayFormatted}
                        </span>
                        <span className="panel-subtitle">
                          Kéo một việc sang ngày khác để chuyển ngày. Mở một ngày để chỉnh chi tiết.
                        </span>
                      </div>
                      <div>
                        <Space wrap>
                          <Button
                            type="default"
                            icon={<RobotOutlined />}
                            onClick={handleGenerateWeeklySummary}
                            loading={isGeneratingSummary}
                          >
                            Viết tóm tắt tuần
                          </Button>
                          <Button
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            onClick={handleAIWeeklyDistribute}
                            loading={isWeeklyAnalyzing}
                          >
                            Phân bổ cả tuần bằng AI
                          </Button>
                        </Space>
                      </div>
                    </div>
                  }
                >
                  {weeklyExplanation && (
                    <div className="callout" style={{ marginBottom: "16px" }}>
                      <div className="section-label"><BulbOutlined /> Nhận xét tuần</div>
                      <Text style={{ fontSize: "13px" }}>{weeklyExplanation}</Text>
                    </div>
                  )}
                  <Row gutter={[16, 16]}>
                    {weekDays.map((day) => {
                      const dayTasks = weeklyTasks[day] || [];
                      const dayHours = calculateTotalHours(dayTasks);
                      const isDayEightHours = dayHours === 8.0;
                      const dayName = DAY_NAMES_VI[dayjs(day).day()];
                      const isToday = day === dayjs().format("YYYY-MM-DD");

                      return (
                        <Col xs={24} sm={12} md={8} lg={8} xl={6} key={day}>
                          <AntdCard
                            size="small"
                            className={["day-card", isToday && "is-today", dragOverDate === day && "is-drop-target"].filter(Boolean).join(" ")}
                            onDragOver={(e: any) => handleDragOver(e, day)}
                            onDrop={(e: any) => handleDrop(e, day)}
                            title={
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                  {dayName}
                                  {isToday && <Tag className="chip-tag">Hôm nay</Tag>}
                                </span>
                                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                  {dayjs(day).format("DD/MM")}
                                </span>
                              </div>
                            }
                            style={{
                              height: "100%",
                              background: "var(--card-bg)",
                              border: "1px solid var(--glass-border)",
                              transition: "border-color 0.2s"
                            }}
                            actions={[
                              <Button type="link" size="small" icon={<ArrowRightOutlined />} onClick={() => handleViewDayDetail(day)}>
                                Mở ngày
                              </Button>
                            ]}
                          >
                            {/* Thống kê giờ trong ngày */}
                            <div style={{ marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: "bold", color: getHoursStatus(dayHours).color }}>
                                {dayHours} / 8.0h
                              </span>
                              {dayTasks.length > 0 && (
                                <span className={`status-pill ${getHoursStatus(dayHours).key}`}>{getHoursStatus(dayHours).label}</span>
                              )}
                            </div>
                            <Progress
                              percent={Math.min(100, (dayHours / 8) * 100)}
                              strokeColor={getHoursStatus(dayHours).color}
                              size="small"
                              showInfo={false}
                              status={isDayEightHours ? "success" : "normal"}
                              style={{ marginBottom: "16px" }}
                            />

                            {/* Danh sách Task của ngày */}
                            <div className="day-card-list">
                              {dayTasks.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "30px 0" }}>
                                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: "12px" }}>Chưa có việc — thêm ở ô bên dưới</span>} />
                                </div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {dayTasks.map((t) => (
                                    <div
                                      key={t.id}
                                      draggable
                                      onDragStart={() => handleDragStart(day, t.id)}
                                      onDragEnd={() => setDragOverDate(null)}
                                      className="task-chip"
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                        <Text style={{ fontSize: "13px", fontWeight: 500, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: t.name }}>
                                          {t.name}
                                        </Text>
                                        <Tooltip title="Xoá">
                                          <Button
                                            type="text"
                                            size="small"
                                            danger
                                            aria-label="Xoá"
                                            icon={<DeleteOutlined style={{ fontSize: "12px" }} />}
                                            onClick={() => handleDeleteWeekTask(day, t.id)}
                                            style={{ height: "22px", width: "22px", padding: 0 }}
                                          />
                                        </Tooltip>
                                      </div>

                                      <Text type="secondary" style={{ fontSize: "11px" }}>
                                        {t.redmineIssue ? `#${t.redmineIssue}` : "Chưa gắn issue"}
                                        {t.redmineProject ? ` · ${t.redmineProject}` : ""}
                                      </Text>

                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                        <Space size={4}>
                                          <Tooltip title={t.isLocked ? "Đang khoá giờ — bấm để mở" : "Khoá giờ để AI không chia lại"}>
                                            <Switch
                                              size="small"
                                              checked={t.isLocked}
                                              checkedChildren={<LockOutlined />}
                                              unCheckedChildren={<UnlockOutlined />}
                                              onChange={(checked) => handleToggleWeekLock(day, t.id, checked)}
                                            />
                                          </Tooltip>
                                        </Space>

                                        <InputNumber
                                          min={0}
                                          max={8}
                                          step={0.5}
                                          size="small"
                                          value={t.duration}
                                          onChange={(val) => handleUpdateWeekDuration(day, t.id, val)}
                                          style={{ width: "90px" }}
                                          addonAfter="h"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Thêm nhanh Task cho ngày này */}
                            <div style={{ display: "flex", gap: "4px" }}>
                              <Input
                                placeholder="Thêm nhanh công việc..."
                                value={quickTaskNames[day] || ""}
                                onChange={(e) => setQuickTaskNames({ ...quickTaskNames, [day]: e.target.value })}
                                onPressEnter={() => handleAddQuickWeekTask(day)}
                                size="small"
                              />
                              <Button
                                type="primary"
                                icon={<PlusOutlined />}
                                onClick={() => handleAddQuickWeekTask(day)}
                                size="small"
                              />
                            </div>
                          </AntdCard>
                        </Col>
                      );
                    })}
                  </Row>
                </Card>
              </div>
            )}

            {/* GIAO DIỆN REDMINE TICKETS DASHBOARD */}
            {activeModule === "dashboard" && (
              <div>
                {/* Stat Cards */}
                <Row gutter={[16, 16]} style={{ marginBottom: "24px" }}>
                  <Col xs={12} sm={6}>
                    <div className="glass-stat-card">
                      <div className="label">Tổng số Ticket</div>
                      <div className="value">{userRedmineTickets.length}</div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="glass-stat-card">
                      <div className="label">Mới & Đang mở</div>
                      <div className="value" style={{ color: "var(--warning-color)" }}>
                        {userRedmineTickets.filter(t => ["new", "feedback", "open", "assigned", "reopened", "chưa xử lý", "mới"].includes(t.status?.name?.toLowerCase())).length}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="glass-stat-card">
                      <div className="label">Đang thực hiện</div>
                      <div className="value" style={{ color: "var(--primary-color)" }}>
                        {userRedmineTickets.filter(t => ["in progress", "đang thực hiện", "đang làm"].includes(t.status?.name?.toLowerCase())).length}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <div className="glass-stat-card">
                      <div className="label">Ưu tiên cao</div>
                      <div className="value" style={{ color: "var(--danger-color)" }}>
                        {userRedmineTickets.filter(t => ["high", "urgent", "immediate", "cao", "khẩn cấp"].includes(t.priority?.name?.toLowerCase())).length}
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Heatmap & Project Targets Overview */}
                <Row gutter={[24, 24]} style={{ marginBottom: "24px" }}>
                  <Col xs={24} lg={16}>
                    <Card className="glass-panel" style={{ height: "100%" }} title={<span className="panel-title"><FireOutlined /> Tần suất log time (6 tháng gần nhất)</span>} styles={{ body: { padding: "16px 20px" } }}>
                      <LogTimeHeatmap entries={spentTimeEntries} themeMode={themeMode} />
                    </Card>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Card 
                      className="glass-panel" 
                      style={{ height: "100%" }}
                      title={<span className="panel-title"><AimOutlined /> Mục tiêu giờ dự án</span>}
                      extra={<Button size="small" type="link" onClick={() => setActiveModule("settings")}>Cài đặt</Button>}
                      styles={{ body: { padding: "16px 20px" } }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        {Object.keys(projectTargets).length === 0 ? (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: "12px" }}>Chưa thiết lập mục tiêu</span>} />
                        ) : (
                          Object.entries(projectTargets).map(([proj, target]) => {
                            const actual = spentTimeEntries
                              .filter(e => e.spent_on && dayjs(e.spent_on).isSame(dayjs(), "month") && (e.project?.name === proj || e.project?.id?.toString() === proj))
                              .reduce((s, e) => s + (e.hours || 0), 0);
                            const percent = Math.min(100, (actual / (target as number)) * 100);
                            return (
                              <div key={proj}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "12px" }}>
                                  <Text strong ellipsis style={{ maxWidth: "70%" }}>{proj}</Text>
                                  <Text type="secondary">{actual.toFixed(1)} / {target}h</Text>
                                </div>
                                <Progress 
                                  percent={percent} 
                                  size="small" 
                                  strokeColor={percent >= 100 ? "var(--success-color)" : (percent >= 50 ? "var(--primary-color)" : "var(--warning-color)")} 
                                />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </Card>
                  </Col>
                </Row>

                {/* Charts Row */}
                <Row gutter={[24, 24]} style={{ marginBottom: "24px" }}>
                  {/* Pie Chart: Trạng thái */}
                  <Col xs={24} md={8}>
                    <Card className="glass-panel" style={{ height: "100%" }} title={<span className="panel-title"><PieChartOutlined /> Phân bố trạng thái</span>} styles={{ body: { padding: "12px 16px" } }}>
                      {userRedmineTickets.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" />
                      ) : (() => {
                        const statusData = Array.from(new Set(userRedmineTickets.map((t: any) => t.status?.name).filter(Boolean))).map((name, i) => ({
                          name,
                          value: userRedmineTickets.filter((t: any) => t.status?.name === name).length,
                          fill: CHART_COLORS[i % CHART_COLORS.length],
                        }));
                        return (
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie data={statusData} cx="50%" cy="45%" innerRadius={48} outerRadius={72} paddingAngle={2} dataKey="value" stroke="var(--card-bg)">
                                {statusData.map((entry: any, index: number) => <Cell key={index} fill={entry.fill} />)}
                              </Pie>
                              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
                              <RechartsTooltip formatter={(val: any, name: any) => [`${val} ticket`, name]} contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--glass-border)", borderRadius: 8 }} cursor={{ fill: "var(--surface-muted)" }} />
                            </PieChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </Card>
                  </Col>

                  {/* Bar Chart: Độ ưu tiên */}
                  <Col xs={24} md={8}>
                    <Card className="glass-panel" style={{ height: "100%" }} title={<span className="panel-title"><BarChartOutlined /> Phân bố độ ưu tiên</span>} styles={{ body: { padding: "12px 16px" } }}>
                      {userRedmineTickets.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" />
                      ) : (() => {
                        const PRIORITY_COLORS: Record<string, string> = {
                          high: STATUS_COLORS.danger, urgent: STATUS_COLORS.danger, immediate: STATUS_COLORS.danger, cao: STATUS_COLORS.danger, "khẩn cấp": STATUS_COLORS.danger,
                          normal: STATUS_COLORS.warning, "trung bình": STATUS_COLORS.warning,
                          low: STATUS_COLORS.success, thấp: STATUS_COLORS.success,
                        };
                        const priorityData = Array.from(new Set(userRedmineTickets.map((t: any) => t.priority?.name).filter(Boolean))).map((name: any) => ({
                          name,
                          tickets: userRedmineTickets.filter((t: any) => t.priority?.name === name).length,
                          fill: PRIORITY_COLORS[name?.toLowerCase()] || CHART_COLORS[3],
                        }));
                        return (
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={priorityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                              <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                              <RechartsTooltip formatter={(val: any) => [`${val} ticket`, "Số lượng"]} contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--glass-border)", borderRadius: 8 }} cursor={{ fill: "var(--surface-muted)" }} />
                              <Bar dataKey="tickets" radius={[6, 6, 0, 0]}>
                                {priorityData.map((entry: any, i: number) => <Cell key={i} fill={entry.fill} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </Card>
                  </Col>

                  {/* Bar Chart: Ticket theo Dự án */}
                  <Col xs={24} md={8}>
                    <Card className="glass-panel" style={{ height: "100%" }} title={<span className="panel-title"><ProjectOutlined /> Ticket theo dự án (top 8)</span>} styles={{ body: { padding: "12px 16px" } }}>
                      {userRedmineTickets.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" />
                      ) : (() => {
                        const projectData = Array.from(new Set(userRedmineTickets.map((t: any) => t.project?.name).filter(Boolean))).map((name: any, i: number) => ({
                          name: name.length > 12 ? name.substring(0, 12) + "…" : name,
                          fullName: name,
                          tickets: userRedmineTickets.filter((t: any) => t.project?.name === name).length,
                          fill: CHART_COLORS[i % CHART_COLORS.length],
                        })).sort((a, b) => b.tickets - a.tickets).slice(0, 8);
                        return (
                          <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={projectData} layout="vertical" margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                              <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                              <YAxis dataKey="name" type="category" width={90} interval={0} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                              <RechartsTooltip formatter={(val: any) => [`${val} ticket`, "Số lượng"]} labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.fullName || ""} contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--glass-border)", borderRadius: 8 }} cursor={{ fill: "var(--surface-muted)" }} />
                              <Bar dataKey="tickets" radius={[0, 6, 6, 0]}>
                                {projectData.map((entry: any, i: number) => <Cell key={i} fill={entry.fill} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </Card>
                  </Col>
                </Row>

                {/* Spent Time Chart: hours theo ngày tháng này */}
                {spentTimeEntries.length > 0 && (() => {
                  const thisMonthEntries = spentTimeEntries.filter(e => e.spent_on && dayjs(e.spent_on).isSame(dayjs(), "month"));
                  if (thisMonthEntries.length === 0) return null;
                  // Group by date
                  const dateMap: Record<string, number> = {};
                  thisMonthEntries.forEach((e: any) => {
                    const d = e.spent_on;
                    dateMap[d] = (dateMap[d] || 0) + (e.hours || 0);
                  });
                  const chartData = Object.entries(dateMap)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, hours]) => ({
                      date: dayjs(date).format("DD/MM"),
                      hours: Math.round(hours * 10) / 10,
                    }));
                  return (
                    <Card className="glass-panel" title={<span className="panel-title"><LineChartOutlined /> Xu hướng log time hàng ngày (tháng này)</span>} style={{ marginBottom: "24px" }} styles={{ body: { padding: "12px 16px" } }}>
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={chartData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
                          <defs>
                            <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--primary-color)" stopOpacity={0.4}/>
                              <stop offset="95%" stopColor="var(--primary-color)" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                          <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                          <RechartsTooltip formatter={(val: any) => [`${val}h`, "Số giờ"]} contentStyle={{ background: "var(--card-bg)", border: "1px solid var(--glass-border)", borderRadius: 8 }} cursor={{ fill: "var(--surface-muted)" }} />
                          <Area type="monotone" dataKey="hours" stroke="var(--primary-color)" strokeWidth={2} fillOpacity={1} fill="url(#colorHours)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </Card>
                  );
                })()}

                {/* Tickets Table Panel */}
                <Card
                  className="glass-panel"
                  title={
                    <div className="panel-header">
                      <span className="panel-title"><DashboardOutlined /> Ticket Redmine của tôi</span>
                      <Button
                        type="default"
                        icon={<ReloadOutlined />}
                        onClick={handleRefreshDashboardTickets}
                        loading={isLoadingDashboard}
                      >
                        Làm mới
                      </Button>
                    </div>
                  }
                  styles={{ body: { padding: "16px 0 0 0" } }}
                >
                  {/* Search & Filters */}
                  <div style={{ display: "flex", gap: "12px", marginBottom: "16px", padding: "0 20px", flexWrap: "wrap" }}>
                    <Input
                      placeholder="Tìm kiếm theo ID, chủ đề hoặc dự án..."
                      prefix={<SearchOutlined style={{ color: "var(--text-secondary)" }} />}
                      value={dashboardSearch}
                      onChange={(e) => setDashboardSearch(e.target.value)}
                      allowClear
                      style={{ width: "280px", maxWidth: "100%" }}
                    />
                    
                    <Select
                      value={dashboardStatusFilter}
                      onChange={val => setDashboardStatusFilter(val)}
                      style={{ width: "160px" }}
                    >
                      <Option value="all">Tất cả Trạng thái</Option>
                      {Array.from(new Set(userRedmineTickets.map(t => t.status?.name).filter(Boolean))).map(st => (
                        <Option key={st} value={st}>{st}</Option>
                      ))}
                    </Select>

                    <Select
                      value={dashboardPriorityFilter}
                      onChange={val => setDashboardPriorityFilter(val)}
                      style={{ width: "160px" }}
                    >
                      <Option value="all">Tất cả Độ ưu tiên</Option>
                      {Array.from(new Set(userRedmineTickets.map(t => t.priority?.name).filter(Boolean))).map(pr => (
                        <Option key={pr} value={pr}>{pr}</Option>
                      ))}
                    </Select>
                  </div>

                  <Table
                    dataSource={
                      userRedmineTickets.filter((ticket) => {
                        const matchSearch = ticket.subject?.toLowerCase().includes(dashboardSearch.toLowerCase()) || 
                                            ticket.id?.toString().includes(dashboardSearch) ||
                                            ticket.project?.name?.toLowerCase().includes(dashboardSearch.toLowerCase());
                        const matchStatus = dashboardStatusFilter === "all" || ticket.status?.name?.toLowerCase() === dashboardStatusFilter.toLowerCase();
                        const matchPriority = dashboardPriorityFilter === "all" || ticket.priority?.name?.toLowerCase() === dashboardPriorityFilter.toLowerCase();
                        return matchSearch && matchStatus && matchPriority;
                      })
                    }
                    columns={[
                      {
                        title: "Mã ticket",
                        dataIndex: "id",
                        key: "id",
                        width: 100,
                        render: (id) => <a href={`${redmineServer}/issues/${id}`} target="_blank" rel="noreferrer" style={{ fontWeight: "bold" }}>#{id}</a>,
                      },
                      {
                        title: "Dự án",
                        dataIndex: ["project", "name"],
                        key: "projectName",
                        width: 180,
                      },
                      {
                        title: "Chủ đề",
                        dataIndex: "subject",
                        key: "subject",
                        render: (text) => <span style={{ fontWeight: 500 }}>{text}</span>,
                      },
                      {
                        title: "Trạng thái",
                        dataIndex: ["status", "name"],
                        key: "statusName",
                        width: 120,
                        render: (status) => {
                          let color = "var(--primary-color)";
                          if (["in progress", "đang thực hiện"].includes(status?.toLowerCase())) {
                            color = "var(--warning-color)";
                          } else if (["resolved", "đã giải quyết", "feedback", "phản hồi"].includes(status?.toLowerCase())) {
                            color = "var(--success-color)";
                          }
                          return <Tag style={{ borderRadius: "4px", color, borderColor: color, background: "transparent" }}>{status}</Tag>;
                        }
                      },
                      {
                        title: "Độ ưu tiên",
                        dataIndex: ["priority", "name"],
                        key: "priorityName",
                        width: 120,
                        render: (pri) => {
                          let className = "tag-low";
                          if (["high", "urgent", "immediate", "cao", "khẩn cấp"].includes(pri?.toLowerCase())) {
                            className = "tag-high";
                          } else if (["normal", "trung bình"].includes(pri?.toLowerCase())) {
                            className = "tag-medium";
                          }
                          return <Tag className={className}>{pri}</Tag>;
                        }
                      },
                      {
                        title: "Ước lượng",
                        dataIndex: "estimated_hours",
                        key: "estimatedHours",
                        width: 110,
                        render: (val) => val ? `${val}h` : "-",
                      },
                      {
                        title: "Hành động",
                        key: "action",
                        width: 150,
                        align: "center",
                        render: (_, ticket) => (
                          <Button
                            size="small"
                            icon={<PlusCircleOutlined />}
                            onClick={() => handleImportTicket(ticket)}
                          >
                            Thêm vào kế hoạch
                          </Button>
                        )
                      }
                    ]}
                    rowKey="id"
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 1000 }}
                    locale={{ emptyText: <Empty description="Không có ticket nào phù hợp" /> }}
                  />
                </Card>
              </div>
            )}

            {/* GIAO DIỆN SETTINGS */}
            {activeModule === "settings" && (
              <div style={{ maxWidth: "640px", margin: "0 auto" }}>
                <Card
                  className="glass-panel"
                  title={<span className="panel-title"><RobotOutlined /> Trợ lý AI</span>}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <AiSettingsPanel value={aiSettings} onChange={setAiSettings} />

                    <div className="settings-section">
                      <div className="settings-section-title">Redmine</div>
                      <div className="settings-section-desc">Dùng để xem thời gian đã log và log giờ trực tiếp lên Redmine.</div>

                      <div style={{ marginBottom: "16px" }}>
                        <div className="field-label">Redmine Server URL</div>
                        <Input
                          placeholder="Ví dụ: https://redmine.mycompany.com"
                          value={redmineServer}
                          onChange={(e) => setRedmineServer(e.target.value)}
                        />
                      </div>

                      <div style={{ marginBottom: "16px" }}>
                        <div className="field-label">Redmine API Key</div>
                        <Input.Password
                          placeholder={redmineKeyHint ? `Đã lưu (${redmineKeyHint}) — nhập khoá mới để thay` : "Nhập Redmine API key"}
                          value={redmineApiKey}
                          onChange={(e) => setRedmineApiKey(e.target.value)}
                          visibilityToggle={false}
                          autoComplete="new-password"
                        />
                        <span className="field-hint">
                          Lấy ở Redmine › Tài khoản của tôi › API access key. Khoá chỉ lưu trên máy này và không hiển thị lại.
                        </span>
                      </div>

                      <div>
                        <div className="field-label">Dự án mặc định</div>
                        <Input
                          placeholder="Nhập ID/Key dự án mặc định (ví dụ: logtime-project)"
                          value={redmineDefaultProject}
                          onChange={(e) => setRedmineDefaultProject(e.target.value)}
                        />
                        <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
                          Giúp AI tìm đúng issue khi công việc chưa gắn issue.
                        </Text>
                      </div>
                    </div>

                    <div className="settings-section">
                      <div className="settings-section-title">Nhắc nhở & mục tiêu</div>
                      
                      <div style={{ marginBottom: "16px" }}>
                         <div className="field-label">Nhắc nhở cuối ngày</div>
                         <Button 
                           icon={<BellOutlined />} 
                           onClick={handleRequestNotification}
                           disabled={notifPermission === "granted"}
                         >
                           {notifPermission === "granted" ? "Đã bật nhắc nhở" : "Bật nhắc nhở"}
                         </Button>
                         <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
                           Nhắc trong khoảng 16:00–18:00 nếu hôm đó chưa log đủ 8 giờ.
                         </Text>
                      </div>

                      <div style={{ marginBottom: "16px" }}>
                        <div className="field-label">Mục tiêu giờ theo dự án</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <Text type="secondary" style={{ fontSize: "12px" }}>Thiết lập số giờ mục tiêu mỗi tháng cho từng dự án để theo dõi tiến độ.</Text>
                          
                          {Object.entries(projectTargets).map(([p, t]) => (
                            <div key={p} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                              <Input value={p} readOnly style={{ width: "200px", maxWidth: "100%" }} />
                              <InputNumber value={t as number} readOnly style={{ width: "100px" }} addonAfter="h" />
                              <Button 
                                type="text" 
                                danger 
                                icon={<DeleteOutlined />} 
                                onClick={() => {
                                  const next = { ...projectTargets };
                                  delete next[p];
                                  setProjectTargets(next);
                                  localStorage.setItem("logtime_project_targets", JSON.stringify(next));
                                  antdMessage.success(`Đã xóa mục tiêu dự án ${p}`);
                                }} 
                              />
                            </div>
                          ))}
                          
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", background: "var(--surface-subtle)", padding: "12px", borderRadius: "8px", border: "1px dashed var(--glass-border)" }}>
                            <Input 
                              placeholder="Tên hoặc ID dự án" 
                              style={{ width: "200px", maxWidth: "100%" }} 
                              value={projectTargetInput.newProj as any || ""}
                              onChange={(e) => setProjectTargetInput({ ...projectTargetInput, newProj: e.target.value as any })}
                            />
                            <InputNumber 
                              placeholder="Giờ" 
                              style={{ width: "100px" }} 
                              value={projectTargetInput.newHours as any || null}
                              onChange={(val) => setProjectTargetInput({ ...projectTargetInput, newHours: val as any })}
                              addonAfter="h"
                            />
                            <Button 
                              type="primary" 
                              icon={<PlusOutlined />} 
                              onClick={() => {
                                if (projectTargetInput.newProj && projectTargetInput.newHours) {
                                  const next = { ...projectTargets, [projectTargetInput.newProj as any]: projectTargetInput.newHours };
                                  setProjectTargets(next);
                                  localStorage.setItem("logtime_project_targets", JSON.stringify(next));
                                  setProjectTargetInput({});
                                  antdMessage.success("Đã thêm mục tiêu dự án mới!");
                                } else {
                                  antdMessage.warning("Vui lòng nhập đầy đủ tên dự án và số giờ mục tiêu.");
                                }
                              }}
                            >
                              Thêm
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="settings-footer">
                    {isSettingsDirty && <Text type="secondary" style={{ fontSize: 12 }}>Có thay đổi chưa lưu</Text>}
                    <Button
                      onClick={revertSettings}
                      disabled={!isSettingsDirty}
                    >
                      Huỷ thay đổi
                    </Button>
                    <Button type="primary" onClick={handleSaveApiKey} disabled={!isSettingsDirty}>
                      Lưu
                    </Button>
                  </div>
                </Card>
              </div>
            )}

            {activeModule === "spent_time" && (
              <div>
                <Card
                  className="glass-panel"
                  title={
                    <div className="panel-header">
                      <Space wrap>
                        <Segmented
                          value={spentTimeFilter}
                          onChange={(val) => {
                            setSpentTimeFilter(val as typeof spentTimeFilter);
                            setSpentTimePage(1);
                          }}
                          options={[
                            { value: "this_month", label: "Tháng này" },
                            { value: "last_month", label: "Tháng trước" },
                            { value: "all", label: "Tất cả" },
                          ]}
                        />
                        {(() => {
                          const filtered = spentTimeEntries.filter((entry) => {
                            if (spentTimeFilter === "this_month") {
                              return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs(), "month");
                            }
                            if (spentTimeFilter === "last_month") {
                              return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs().subtract(1, "month"), "month");
                            }
                            return true;
                          });
                          const totalHours = filtered.reduce((sum, entry) => sum + (entry.hours || 0), 0);
                          const loggedDays = new Set(filtered.map((e) => e.spent_on));
                          const today = getVietnamToday();
                          const missingDays = generateDatesForFilter(spentTimeFilter, filtered).filter((d) => {
                            const wd = dayjs(d).day();
                            return wd !== 0 && wd !== 6 && d < today && !loggedDays.has(d);
                          }).length;
                          return (
                            <>
                              <Text>Tổng <strong>{totalHours.toFixed(1)} giờ</strong></Text>
                              {missingDays > 0 && !isLoadingSpentTime && (
                                <span className="status-pill missing">{missingDays} ngày làm việc chưa log</span>
                              )}
                            </>
                          );
                        })()}
                      </Space>
                      <Space wrap>
                        <Button
                          type="primary"
                          icon={<FundViewOutlined />}
                          onClick={() => setActivitySummaryDate(dayjs().format("YYYY-MM-DD"))}
                        >
                          Tóm tắt hoạt động hôm nay
                        </Button>
                        <Tooltip title="Tải lại từ Redmine">
                          <Button
                            icon={<ReloadOutlined />}
                            onClick={handleFetchSpentTime}
                            loading={isLoadingSpentTime}
                            aria-label="Tải lại từ Redmine"
                          />
                        </Tooltip>
                        <Tooltip title="Xuất CSV">
                          <Button
                            icon={<DownloadCSVOutlined />}
                            onClick={handleExportSpentTimeCSV}
                            aria-label="Xuất CSV"
                          />
                        </Tooltip>
                      </Space>
                    </div>
                  }
                  style={{ marginBottom: "24px" }}
                >
                  {isLoadingSpentTime ? (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px" }}>
                      <Spin size="large" tip="Đang tải dữ liệu..." />
                    </div>
                  ) : (() => {
                    const filtered = spentTimeEntries.filter((entry) => {
                      if (spentTimeFilter === "this_month") {
                        return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs(), "month");
                      }
                      if (spentTimeFilter === "last_month") {
                        return entry.spent_on && dayjs(entry.spent_on).isSame(dayjs().subtract(1, "month"), "month");
                      }
                      return true;
                    });

                    // 1. Generate full dates for this filter period
                    const allDates = generateDatesForFilter(spentTimeFilter, filtered);

                    if (allDates.length === 0) {
                      return (
                        <div style={{ padding: "40px 0" }}>
                          <EmptyIllustration themeMode={themeMode} description="Không có ngày nào trong khoảng thời gian này." />
                        </div>
                      );
                    }

                    const groupedSpentTime: { [date: string]: any[] } = {};
                    allDates.forEach((dStr) => {
                      groupedSpentTime[dStr] = [];
                    });

                    filtered.forEach((entry) => {
                      const date = entry.spent_on || "Không rõ ngày";
                      if (groupedSpentTime[date] !== undefined) {
                        groupedSpentTime[date].push(entry);
                      } else if (spentTimeFilter === "all") {
                        groupedSpentTime[date] = [entry];
                      }
                    });

                    const sortedDates = Object.keys(groupedSpentTime).sort((a, b) => b.localeCompare(a));
                    
                    // 2. Pagination slicing
                    const startIndex = (spentTimePage - 1) * spentTimePageSize;
                    const endIndex = startIndex + spentTimePageSize;
                    const paginatedDates = sortedDates.slice(startIndex, endIndex);

                    return (
                      <Row gutter={[16, 16]}>
                        {paginatedDates.map((date) => {
                          const entries = groupedSpentTime[date];
                          const localTasks = getTasksForDate(date);
                          const daySummary = dayjs(date).day() % 6 === 0 ? null : getDaySummary(date);
                          const totalDailyHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
                          const dayOfWeek = dayjs(date).day(); // 0: Chủ Nhật, 6: Thứ Bảy
                          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                          const isToday = date === getVietnamToday();
                          const isMissing = !isWeekend && totalDailyHours === 0 && date < getVietnamToday();
                          const dayCardClass = ["glass-panel", "day-card", isWeekend && "is-weekend", isMissing && "is-missing"].filter(Boolean).join(" ");
                          const titleColor = isWeekend ? "var(--text-secondary)" : isMissing ? "var(--danger-color)" : "var(--text-primary)";
                          const tagStyle: React.CSSProperties = {
                            background: isMissing ? "var(--danger-bg)" : "var(--surface-muted)",
                            color: isMissing ? "var(--danger-color)" : isWeekend ? "var(--text-secondary)" : "var(--text-primary)",
                            border: isMissing ? "1px solid var(--danger-border)" : "none",
                            fontWeight: 600,
                            fontSize: "12px",
                            padding: "0 8px",
                            margin: 0,
                            borderRadius: "10px"
                          };
                          const tagText = isWeekend ? "Nghỉ" : isMissing ? "Chưa log" : isToday && totalDailyHours === 0 ? "Hôm nay" : `${totalDailyHours.toFixed(1)} giờ`;

                          const isDayEightHours = totalDailyHours >= 8.0;
                          const progressPercent = isWeekend ? 0 : Math.min(100, (totalDailyHours / 8) * 100);
                          const progressColor = isWeekend
                            ? "var(--text-secondary)"
                            : isDayEightHours
                            ? "var(--success-color)"
                            : "var(--warning-color)";

                          return (
                            <Col xs={24} sm={12} md={8} lg={8} xl={6} key={date}>
                              <Card
                                className={dayCardClass}
                                size="small"
                                style={{ height: "100%" }}
                                title={
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                                    <span style={{ fontWeight: 600, fontSize: "13px", color: titleColor }}>
                                      {formatVietnameseDate(date)}
                                    </span>
                                    <Space size={4}>
                                      {!isWeekend && (
                                        <Tooltip title="Tóm tắt hoạt động (AI agent + thời gian dùng máy)">
                                          <Button
                                            type="text"
                                            size="small"
                                            icon={<FundViewOutlined />}
                                            onClick={() => setActivitySummaryDate(date)}
                                          />
                                        </Tooltip>
                                      )}
                                      <Tag style={tagStyle}>
                                        {tagText}
                                      </Tag>
                                    </Space>
                                  </div>
                                }
                                styles={{ header: { padding: "0 16px", minHeight: "44px", borderBottomColor: isMissing ? "var(--danger-border)" : undefined }, body: { padding: "12px 16px" } }}
                              >
                                {/* Đã log: X / 8.0h */}
                                <div style={{ marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Đã log:</span>
                                  <span style={{ fontWeight: "bold", color: progressColor }}>
                                    {isWeekend ? "–" : `${totalDailyHours.toFixed(1)} / 8.0h`}
                                  </span>
                                </div>

                                {/* Progress Bar */}
                                <Progress
                                  percent={progressPercent}
                                  strokeColor={progressColor}
                                  size="small"
                                  status={!isWeekend && isDayEightHours ? "success" : "normal"}
                                  style={{ marginBottom: "16px" }}
                                />

                                {/* Danh sách các log entry của ngày */}
                                <div className="day-card-list">
                                  {isWeekend ? (
                                    <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-secondary)", fontSize: "13px" }}>
                                      <ClockCircleOutlined style={{ marginRight: "6px" }} />
                                      Cuối tuần - Không yêu cầu log time
                                    </div>
                                  ) : (entries.length === 0 && localTasks.length === 0 && !daySummary) ? (
                                    <div style={{ textAlign: "center", padding: "30px 0" }}>
                                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: "12px" }}>Chưa có gì — thêm nhanh ở ô bên dưới</span>} />
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                      {/* A) Redmine Entries */}
                                      {entries.length > 0 && (
                                        <div>
                                          <div className="section-label" style={{ color: "var(--success-color)" }}>
                                            <CheckCircleOutlined /> Đã log trên Redmine · {totalDailyHours.toFixed(1)}h
                                          </div>
                                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                            {entries.map((entry: any, index: number) => (
                                              <div key={entry.id || index} className="task-chip">
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                                  <Tag className="chip-tag">
                                                    {entry.project?.name || "Không có Project"}
                                                  </Tag>
                                                  {entry.issue?.id && (
                                                    <a
                                                      href={`${redmineServer}/issues/${entry.issue.id}`}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      style={{ color: "var(--primary-color)", fontWeight: 600, fontSize: "12px" }}
                                                    >
                                                      #{entry.issue.id}
                                                    </a>
                                                  )}
                                                  {entry.activity?.name && (
                                                    <Tag className="chip-tag" style={{ background: "transparent", border: "1px solid var(--glass-border)" }}>
                                                      {entry.activity.name}
                                                    </Tag>
                                                  )}
                                                </div>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                                  <div title={entry.comments || undefined} style={{ color: "var(--text-primary)", fontSize: "12px", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {entry.comments || <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>(Không có ghi chú)</span>}
                                                  </div>
                                                  <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                                                    {entry.hours}h
                                                  </span>
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {/* B) Local Planned Tasks */}
                                      {localTasks.length > 0 && (
                                        <div>
                                          <div className="section-label" style={{ color: "var(--warning-color)" }}>
                                            <ScheduleOutlined /> Kế hoạch chưa log · {localTasks.reduce((s, t) => s + (t.duration || 0), 0).toFixed(1)}h
                                          </div>
                                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                            {localTasks.map((t) => (
                                              <div key={t.id} className="task-chip">
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                                  <Text style={{ fontSize: "12px", fontWeight: 500, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: t.name }}>
                                                    {t.name}
                                                  </Text>
                                                  <Space size={4}>
                                                    <Tooltip title="Log lên Redmine">
                                                      <Button
                                                        type="text"
                                                        size="small"
                                                        aria-label="Log lên Redmine"
                                                        icon={<UploadOutlined style={{ fontSize: "12px" }} />}
                                                        onClick={() => handleSyncSingleTaskToRedmine(date, t)}
                                                        style={{ height: "22px", width: "22px", padding: 0 }}
                                                      />
                                                    </Tooltip>
                                                    <Tooltip title="Xóa task">
                                                      <Button
                                                        type="text"
                                                        size="small"
                                                        danger
                                                        icon={<DeleteOutlined style={{ fontSize: "12px" }} />}
                                                        onClick={() => handleDeleteWeekTask(date, t.id)}
                                                        style={{ height: "22px", width: "22px", padding: 0 }}
                                                      />
                                                    </Tooltip>
                                                  </Space>
                                                </div>

                                                <div style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between" }}>
                                                  <Text type="secondary" style={{ fontSize: "11px" }}>
                                                    {t.redmineIssue ? `#${t.redmineIssue}` : "Chưa gắn issue"}
                                                  </Text>
                                                  <InputNumber
                                                    min={0}
                                                    max={8}
                                                    step={0.5}
                                                    size="small"
                                                    value={t.duration}
                                                    onChange={(val) => handleUpdateWeekDuration(date, t.id, val)}
                                                    style={{ width: "72px", fontSize: "11px" }}
                                                    suffix="h"
                                                  />
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {/* C) Tóm tắt hoạt động chờ tạo task */}
                                      {daySummary && (
                                        <DaySummaryTree
                                          summary={daySummary}
                                          projects={redmineProjectList}
                                          onCreateRows={(rows) => handleCreateSummaryRows(date, rows)}
                                          onOpen={() => setActivitySummaryDate(date)}
                                          onRemove={() => handleDaySummaryChange(date, null)}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Quick Add input (chỉ cho ngày thường) */}
                                {!isWeekend && (
                                  <div style={{ display: "flex", gap: "4px" }}>
                                    <Input
                                      placeholder="Thêm nhanh công việc..."
                                      value={quickTaskNames[date] || ""}
                                      onChange={(e) => setQuickTaskNames({ ...quickTaskNames, [date]: e.target.value })}
                                      onPressEnter={() => handleAddQuickWeekTask(date)}
                                      size="small"
                                    />
                                    <Button
                                      type="primary"
                                      icon={<PlusOutlined />}
                                      onClick={() => handleAddQuickWeekTask(date)}
                                      size="small"
                                    />
                                  </div>
                                )}
                              </Card>
                            </Col>
                          );
                        })}

                        {/* Pagination component — phải nằm trong Row nhưng là full-width Col */}
                        <Col span={24}>
                          <div style={{ display: "flex", justifyContent: "center", marginTop: "8px", paddingBottom: "20px" }}>
                            <Pagination
                              current={spentTimePage}
                              pageSize={spentTimePageSize}
                              total={sortedDates.length}
                              onChange={(page, pageSize) => {
                                setSpentTimePage(page);
                                if (pageSize) {
                                  setSpentTimePageSize(pageSize);
                                }
                              }}
                              showSizeChanger
                              pageSizeOptions={["12", "24", "48"]}
                              showTotal={(total) => `${total} ngày`}
                            />
                          </div>
                        </Col>
                      </Row>
                    );
                  })()}
                </Card>
              </div>
            )}

            {activeModule === "team" && (
              <div>
                <Card
                  className="glass-panel"
                  title={
                    <div className="panel-header">
                      <div>
                        <span className="panel-title">
                          <TeamOutlined /> Thời gian làm việc của nhóm
                        </span>
                        <span className="panel-subtitle">
                          Tổng hợp spent time của các thành viên trong dự án — tháng {dayjs().format("MM/YYYY")}
                        </span>
                      </div>
                      <Button 
                        type="default" 
                        icon={<ReloadOutlined />} 
                        onClick={handleFetchTeamSpentTime}
                        loading={isLoadingTeam}
                      >
                        Làm mới
                      </Button>
                    </div>
                  }
                  style={{ marginBottom: "24px" }}
                >
                  {teamError ? (
                    <Alert
                      type="error"
                      showIcon
                      message="Không thể tải dữ liệu nhóm"
                      description={
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <span>{teamError}</span>
                          <Text type="secondary" style={{ fontSize: "12px" }}>
                            Tính năng này yêu cầu tài khoản của bạn có quyền xem time entries của người dùng khác trên Redmine.
                          </Text>
                        </div>
                      }
                    />
                  ) : isLoadingTeam ? (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "300px" }}>
                      <Spin size="large" tip="Đang tải dữ liệu nhóm..." />
                    </div>
                  ) : (() => {
                    const thisMonthEntries = teamTimeEntries.filter(
                      (e) => e.spent_on && dayjs(e.spent_on).isSame(dayjs(), "month")
                    );

                    if (thisMonthEntries.length === 0) {
                      return (
                        <Empty description="Không có dữ liệu ghi nhận thời gian của nhóm trong tháng này" />
                      );
                    }

                    const userMap: Record<number, { name: string; hours: number; dates: Set<string>; lastDate: string }> = {};

                    thisMonthEntries.forEach(entry => {
                      const userId = entry.user?.id;
                      const userName = entry.user?.name || `Thành viên #${userId}`;
                      const hours = entry.hours || 0;
                      const date = entry.spent_on;

                      if (!userId) return;

                      if (!userMap[userId]) {
                        userMap[userId] = {
                          name: userName,
                          hours: 0,
                          dates: new Set<string>(),
                          lastDate: '',
                        };
                      }

                      userMap[userId].hours += hours;
                      if (date) {
                        userMap[userId].dates.add(date);
                        if (!userMap[userId].lastDate || date > userMap[userId].lastDate) {
                          userMap[userId].lastDate = date;
                        }
                      }
                    });

                    const dataSource = Object.entries(userMap).map(([userId, info]) => {
                      const totalHours = info.hours;
                      const distinctDays = info.dates.size;
                      const avg = distinctDays > 0 ? totalHours / distinctDays : 0;
                      return {
                        key: userId,
                        userId: Number(userId),
                        name: info.name,
                        totalHoursThisMonth: Math.round(totalHours * 10) / 10,
                        averageHoursPerDay: Math.round(avg * 10) / 10,
                        lastSpentOn: info.lastDate ? dayjs(info.lastDate).format("DD/MM/YYYY") : "Chưa có",
                      };
                    }).sort((a, b) => b.totalHoursThisMonth - a.totalHoursThisMonth);

                    const teamColumns = [
                      {
                        title: "Thành viên",
                        dataIndex: "name",
                        key: "name",
                        render: (text: string) => (
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <Avatar style={{ backgroundColor: "var(--surface-muted)", color: "var(--text-primary)", verticalAlign: "middle", fontSize: "12px", fontWeight: 600 }}>
                              {(() => {
                                const words = text.trim().split(/\s+/);
                                return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : text.substring(0, 2)).toUpperCase();
                              })()}
                            </Avatar>
                            <Text strong style={{ color: "var(--text-primary)" }}>{text}</Text>
                          </div>
                        ),
                      },
                      {
                        title: "Tổng giờ (Tháng này)",
                        dataIndex: "totalHoursThisMonth",
                        key: "totalHoursThisMonth",
                        render: (hours: number) => {
                          const maxHours = Math.max(...dataSource.map(d => d.totalHoursThisMonth));
                          const percent = maxHours > 0 ? (hours / maxHours) * 100 : 0;
                          return (
                            <div style={{ minWidth: "120px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <Text strong style={{ color: hours >= 80 ? "var(--success-color)" : "var(--text-primary)" }}>
                                  {hours.toFixed(1)}h
                                </Text>
                              </div>
                              <Progress 
                                percent={percent} 
                                size="small" 
                                showInfo={false} 
                                strokeColor={hours >= 80 ? "var(--success-color)" : "var(--primary-color)"}
                                style={{ margin: 0 }}
                              />
                            </div>
                          );
                        },
                      },
                      {
                        title: "Trung bình / Ngày",
                        dataIndex: "averageHoursPerDay",
                        key: "averageHoursPerDay",
                        render: (hours: number) => (
                          <Tag style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: "var(--surface-muted)", border: "none", fontWeight: 500, color: hours >= 7.5 ? "var(--success-color)" : (hours >= 5 ? "var(--warning-color)" : "var(--text-secondary)") }}>
                            {hours.toFixed(1)}h/ngày
                          </Tag>
                        ),
                      },
                      {
                        title: "Ngày log gần nhất",
                        dataIndex: "lastSpentOn",
                        key: "lastSpentOn",
                        render: (text: string) => <Text style={{ color: "var(--text-primary)" }}>{text}</Text>,
                      },
                    ];

                    return (
                      <Table
                        dataSource={dataSource}
                        columns={teamColumns}
                        pagination={false}
                        rowKey="key"
                        scroll={{ x: 640 }}
                      />
                    );
                  })()}
                </Card>
              </div>
            )}

          </Content>

          <Footer style={{ textAlign: "center", color: "var(--text-secondary)", background: "transparent", borderTop: "1px solid var(--glass-border)", padding: "16px", fontSize: "12px" }}>
            LogTime AI · Estuary Solutions
          </Footer>
        </Layout>

        {/* Modal Xác thực Ánh xạ Đơn lẻ */}
        <Modal
          title={
            <span style={{ fontSize: "16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <RobotOutlined style={{ color: "var(--primary-color)" }} />
              Gắn issue Redmine
            </span>
          }
          open={isMappingModalOpen}
          onOk={handleConfirmMapping}
          onCancel={() => {
            setIsMappingModalOpen(false);
            setMappingTask(null);
          }}
          okText={manualMatchType === "subtask" ? "Tạo task con & gắn" : manualMatchType === "none" ? "Bỏ gắn issue" : "Gắn issue"}
          cancelText="Hủy"
          width={800}
          confirmLoading={isSyncingRedmine}
        >
          {isAiLoading ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Badge status="processing" color="var(--primary-color)" />
              <div style={{ marginTop: "12px", color: "var(--text-secondary)" }}>AI đang tìm issue phù hợp trên Redmine…</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", margin: "16px 0" }}>
              {/* Task info vs AI Suggestion */}
              <Row gutter={16}>
                <Col span={12}>
                  <Card size="small" title="Công việc hiện tại" style={{ height: "100%", background: "rgba(0,0,0,0.02)" }}>
                    <div style={{ marginBottom: "8px" }}>
                      <Text type="secondary">Tên task:</Text>
                      <div style={{ fontWeight: 600 }}>{mappingTask?.name}</div>
                    </div>
                    <div>
                      <Text type="secondary">Thời gian:</Text>
                      <div>{mappingTask?.duration} giờ</div>
                    </div>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card 
                    size="small" 
                    title="Đề xuất của AI" 
                    style={{ height: "100%", background: "var(--bubble-assistant-bg)" }}
                  >
                    <div style={{ marginBottom: "8px" }}>
                      <Text type="secondary">Kiểu ánh xạ:</Text>
                      <div>
                        {manualMatchType === "direct" && <Tag color="success">Khớp Trực tiếp</Tag>}
                        {manualMatchType === "subtask" && <Tag color="warning">Tạo Subtask mới</Tag>}
                        {manualMatchType === "none" && <Tag color="default">Không ánh xạ</Tag>}
                      </div>
                    </div>
                    {aiSuggestion?.reason && (
                      <div>
                        <Text type="secondary">Lý do:</Text>
                        <div style={{ fontSize: "12px", fontStyle: "italic", color: "var(--text-secondary)" }}>{aiSuggestion.reason}</div>
                      </div>
                    )}
                  </Card>
                </Col>
              </Row>

              {/* Form config thủ công */}
              <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "16px" }}>
                <div style={{ fontWeight: 600, marginBottom: "12px" }}>Thiết lập cấu hình ánh xạ:</div>
                
                <Row gutter={16} style={{ marginBottom: "12px" }}>
                  <Col span={12}>
                    <div style={{ marginBottom: "6px" }}>Loại ánh xạ:</div>
                    <Select value={manualMatchType} onChange={(val) => setManualMatchType(val)} style={{ width: "100%" }}>
                      <Option value="direct">Ánh xạ trực tiếp vào Issue có sẵn</Option>
                      <Option value="subtask">Tạo subtask con dưới Issue cha</Option>
                      <Option value="none">Không ánh xạ (Bỏ qua)</Option>
                    </Select>
                  </Col>
                  <Col span={12}>
                    <div style={{ marginBottom: "6px" }}>Dự án Redmine:</div>
                    <Input 
                      placeholder="ID hoặc Key dự án" 
                      value={manualProject} 
                      onChange={(e) => setManualProject(e.target.value)} 
                    />
                  </Col>
                </Row>

                {manualMatchType === "direct" && (
                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ marginBottom: "6px" }}>Mã Issue Redmine trực tiếp:</div>
                    <InputNumber 
                      placeholder="Nhập ID Issue (VD: 1234)" 
                      value={manualIssueId} 
                      onChange={(val) => setManualIssueId(val || undefined)} 
                      style={{ width: "100%" }} 
                    />
                  </div>
                )}

                {manualMatchType === "subtask" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" }}>
                    <Row gutter={16}>
                      <Col span={12}>
                        <div>Mã Issue Cha:</div>
                        <InputNumber 
                          placeholder="Nhập ID Issue cha (VD: 5678)" 
                          value={manualParentIssueId} 
                          onChange={(val) => setManualParentIssueId(val || undefined)} 
                          style={{ width: "100%", marginTop: "6px" }} 
                        />
                      </Col>
                      <Col span={12}>
                        <div>Tiêu đề Subtask mới:</div>
                        <Input 
                          value={manualSubject} 
                          onChange={(e) => setManualSubject(e.target.value)} 
                          style={{ marginTop: "6px" }}
                        />
                      </Col>
                    </Row>
                    <div>
                      <div>Mô tả Subtask:</div>
                      <Input.TextArea 
                        rows={2} 
                        value={manualDescription} 
                        onChange={(e) => setManualDescription(e.target.value)} 
                        style={{ marginTop: "6px" }}
                      />
                    </div>
                    <div>
                      <div>Số giờ ước lượng:</div>
                      <InputNumber 
                        min={0} 
                        value={manualEstimatedHours} 
                        onChange={(val) => setManualEstimatedHours(val || undefined)} 
                        style={{ width: "100%", marginTop: "6px" }} 
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Tìm kiếm Issue trực tiếp */}
              <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "16px" }}>
                <div style={{ fontWeight: 600, marginBottom: "8px" }}>Tra cứu Issue trên Redmine:</div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                  <Input 
                    placeholder="Gõ từ khóa tìm kiếm issue..." 
                    onPressEnter={(e) => handleSearchRedmineIssues((e.target as any).value)}
                    id="modal-search-input"
                  />
                  <Button 
                    type="primary" 
                    icon={<SearchOutlined />} 
                    onClick={() => {
                      const el = document.getElementById("modal-search-input") as HTMLInputElement;
                      if (el) handleSearchRedmineIssues(el.value);
                    }}
                    loading={isSearchingIssues}
                  >
                    Tìm
                  </Button>
                </div>

                <div style={{ maxHeight: "180px", overflowY: "auto", border: "1px solid var(--glass-border)", borderRadius: "6px", background: "rgba(0,0,0,0.01)" }}>
                  {searchIssuesResults.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Gõ từ khoá rồi nhấn Enter để tìm issue.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {searchIssuesResults.map((issue) => (
                        <div 
                          key={issue.id} 
                          style={{ 
                            padding: "8px 12px", 
                            borderBottom: "1px solid var(--glass-border)", 
                            display: "flex", 
                            justifyContent: "space-between", 
                            alignItems: "center" 
                          }}
                        >
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
                            <span style={{ fontWeight: "bold", marginRight: "8px" }}>#{issue.id}</span>
                            <span>{issue.subject}</span>
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginLeft: "8px" }}>({issue.project?.name})</span>
                          </div>
                          <Space>
                            <Button 
                              size="small" 
                              type="dashed"
                              onClick={() => {
                                setManualMatchType("direct");
                                setManualIssueId(issue.id);
                                setManualProject(issue.project?.name || issue.project?.id?.toString() || "");
                                antdMessage.success(`Đã chọn gán trực tiếp vào #${issue.id}`);
                              }}
                            >
                              Gắn vào issue này
                            </Button>
                            <Button 
                              size="small" 
                              type="dashed"
                              onClick={() => {
                                setManualMatchType("subtask");
                                setManualParentIssueId(issue.id);
                                setManualProject(issue.project?.name || issue.project?.id?.toString() || "");
                                antdMessage.success(`Đã chọn gán làm con của #${issue.id}`);
                              }}
                            >
                              Tạo task con
                            </Button>
                          </Space>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Modal Gợi ý Log Time sau Pomodoro */}
        <Modal
          title={<span style={{ fontWeight: 600 }}>🍅 Hoàn thành phiên tập trung!</span>}
          open={showPomodoroLogModal}
          onOk={() => {
            const newTask: Task = {
              id: Math.random().toString(36).substring(2, 9),
              name: lastFinishedTask || "Phiên tập trung Pomodoro",
              importance: "medium",
              category: "Coding",
              duration: 0.5,
              isLocked: true
            };
            handleAddTasksToDate(dayjs().format("YYYY-MM-DD"), [newTask]);
            setShowPomodoroLogModal(false);
            antdMessage.success("Đã thêm 0.5h vào kế hoạch hôm nay.");
          }}
          onCancel={() => setShowPomodoroLogModal(false)}
          okText="Thêm 0.5h vào kế hoạch"
          cancelText="Bỏ qua"
        >
          Bạn vừa tập trung 25 phút cho <b>{lastFinishedTask || "công việc"}</b>.
          Thêm 0.5h (khoá giờ) vào kế hoạch hôm nay?
        </Modal>

        {/* Modal Tóm tắt AI tuần */}
        <Modal
          title={<span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}><RobotOutlined style={{ color: "var(--primary-color)" }} /> Tóm tắt báo cáo công việc tuần</span>}
          open={weeklySummaryModalOpen}
          onOk={() => setWeeklySummaryModalOpen(false)}
          onCancel={() => setWeeklySummaryModalOpen(false)}
          width={700}
          footer={[<Button key="ok" type="primary" onClick={() => setWeeklySummaryModalOpen(false)}>Đóng</Button>]}
        >
          {isGeneratingSummary ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Spin size="large" tip="AI đang tổng hợp dữ liệu và viết tóm tắt tuần..." />
            </div>
          ) : (
            <div style={{ padding: "10px 0" }}>
              <Input.TextArea 
                value={weeklySummaryText} 
                rows={15} 
                readOnly 
                style={{ 
                  background: "var(--bubble-assistant-bg)", 
                  color: "var(--text-primary)", 
                  border: "1px solid var(--glass-border)",
                  fontFamily: "Inter, sans-serif",
                  fontSize: "14px",
                  lineHeight: "1.6"
                }}
              />
              <div style={{ marginTop: "16px", textAlign: "right" }}>
                <Button 
                  icon={<CopyOutlined />} 
                  type="primary"
                  onClick={() => {
                    navigator.clipboard.writeText(weeklySummaryText);
                    antdMessage.success("Đã copy tóm tắt tuần vào clipboard!");
                  }}
                >
                  Sao chép báo cáo
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Modal Ánh xạ Hàng loạt */}
        <Modal
          title={
            <span style={{ fontSize: "16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <RobotOutlined style={{ color: "var(--primary-color)" }} />
              Gắn issue tự động cho các việc chưa gắn
            </span>
          }
          open={isBulkMappingModalOpen}
          onOk={handleConfirmBulkMapping}
          onCancel={() => {
            setIsBulkMappingModalOpen(false);
            setBulkMappingSuggestions([]);
          }}
          okText={`Áp dụng ${bulkMappingSuggestions.filter((x) => x.approved).length} gợi ý`}
          cancelText="Hủy"
          width={900}
          confirmLoading={isSyncingRedmine}
        >
          {isBulkMappingLoading ? (
            <div style={{ padding: "50px 0", textAlign: "center" }}>
              <Badge status="processing" color="var(--primary-color)" />
              <div style={{ marginTop: "12px", color: "var(--text-secondary)" }}>AI đang tìm issue phù hợp cho {tasks.filter((t) => !t.redmineIssue).length} việc…</div>
            </div>
          ) : (
            <div style={{ margin: "16px 0" }}>
              <div style={{ marginBottom: "12px", color: "var(--text-secondary)", fontSize: "13px" }}>
                AI đã tìm issue phù hợp cho từng việc chưa gắn. Kiểm tra lại, tắt những gợi ý không đúng, rồi bấm Áp dụng. Chưa có gì được gửi lên Redmine cho tới khi bạn áp dụng.
              </div>
              
              <Table
                dataSource={bulkMappingSuggestions}
                rowKey={(record) => record.task.id}
                pagination={false}
                scroll={{ y: 350 }}
                size="small"
                columns={[
                  {
                    title: "Duyệt",
                    dataIndex: "approved",
                    key: "approved",
                    width: 70,
                    render: (approved, record, index) => (
                      <Switch
                        checked={approved}
                        size="small"
                        onChange={(checked) => {
                          const updated = [...bulkMappingSuggestions];
                          updated[index] = { ...record, approved: checked };
                          setBulkMappingSuggestions(updated);
                        }}
                      />
                    ),
                  },
                  {
                    title: "Tên công việc",
                    dataIndex: ["task", "name"],
                    key: "taskName",
                    width: 200,
                  },
                  {
                    title: "Gợi ý AI",
                    key: "aiSuggestion",
                    width: 250,
                    render: (_, record) => {
                      const type = record.suggestion?.type;
                      const issueId = record.suggestion?.issueId;
                      const parentId = record.suggestion?.parentIssueId;
                      const reason = record.suggestion?.reason || "Không tìm thấy issue phù hợp.";
                      
                      return (
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {type === "direct" && <Tag color="success">Trực tiếp #{issueId}</Tag>}
                            {type === "subtask" && <Tag color="processing">Tạo con của #{parentId}</Tag>}
                            {type === "none" && <Tag color="warning">Không ánh xạ</Tag>}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "4px" }}>
                            {reason}
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    title: "Khớp thủ công",
                    key: "manualMatch",
                    render: (_, record, index) => (
                      <Space direction="vertical" size={4} style={{ width: "100%" }}>
                        <Select
                          value={record.manualMatchType}
                          size="small"
                          style={{ width: "130px" }}
                          onChange={(val: any) => {
                            const updated = [...bulkMappingSuggestions];
                            updated[index] = {
                              ...record,
                              manualMatchType: val,
                              approved: val !== "none",
                              manualIssueId: val === "direct" ? record.suggestion?.issueId : undefined,
                              manualParentIssueId: val === "subtask" ? record.suggestion?.parentIssueId : undefined,
                            };
                            setBulkMappingSuggestions(updated);
                          }}
                          options={[
                            { value: "direct", label: "Ánh xạ trực tiếp" },
                            { value: "subtask", label: "Tạo Subtask con" },
                            { value: "none", label: "Không ánh xạ" },
                          ]}
                        />
                        {record.manualMatchType === "direct" && (
                          <InputNumber
                            placeholder="Mã Issue"
                            size="small"
                            style={{ width: "130px" }}
                            value={record.manualIssueId}
                            onChange={(val) => {
                              const updated = [...bulkMappingSuggestions];
                              updated[index] = { ...record, manualIssueId: val || undefined };
                              setBulkMappingSuggestions(updated);
                            }}
                          />
                        )}
                        {record.manualMatchType === "subtask" && (
                          <Space direction="vertical" size={2}>
                            <InputNumber
                              placeholder="Mã Issue Cha"
                              size="small"
                              style={{ width: "130px" }}
                              value={record.manualParentIssueId}
                              onChange={(val) => {
                                const updated = [...bulkMappingSuggestions];
                                updated[index] = { ...record, manualParentIssueId: val || undefined };
                                setBulkMappingSuggestions(updated);
                              }}
                            />
                            <Input
                              placeholder="Project Key"
                              size="small"
                              style={{ width: "130px" }}
                              value={record.manualProject}
                              onChange={(e) => {
                                const updated = [...bulkMappingSuggestions];
                                updated[index] = { ...record, manualProject: e.target.value };
                                setBulkMappingSuggestions(updated);
                              }}
                            />
                          </Space>
                        )}
                      </Space>
                    ),
                  },
                ]}
              />

            </div>
          )}
        </Modal>
        {/* Pomodoro Timer Floating Widget */}
        <div style={{ 
          position: "fixed", 
          bottom: "30px", 
          right: "30px", 
          zIndex: 1000,
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
        }}>
          {pomodoroVisible ? (
            pomodoroMinimized ? (
              <div 
                className="glass-panel glow-active"
                style={{ 
                  padding: "8px 16px", 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "12px",
                  cursor: "pointer",
                  borderRadius: "30px",
                  boxShadow: "var(--glow-shadow-1)",
                  border: `1px solid ${pomodoroMode === "work" ? "#ef4444" : "#10b981"}`
                }}
                onClick={() => setPomodoroMinimized(false)}
              >
                <Badge status="processing" color={pomodoroMode === "work" ? "#ef4444" : "#10b981"} />
                <span style={{ fontSize: "16px", fontWeight: 700, fontFamily: "monospace" }} className={pomodoroRunning ? "pomodoro-timer-active" : ""}>
                   {Math.floor(pomodoroSeconds / 60)}:{(pomodoroSeconds % 60).toString().padStart(2, "0")}
                </span>
                <Button 
                  type="text" 
                  size="small" 
                  icon={<CloseOutlined style={{ fontSize: "10px" }} />} 
                  onClick={(e) => { e.stopPropagation(); setPomodoroVisible(false); }} 
                />
              </div>
            ) : (
              <Card 
                className="glass-panel" 
                style={{ 
                  width: "260px", 
                  boxShadow: "var(--glow-shadow-2)", 
                  border: `1px solid ${pomodoroMode === "work" ? "#ef444455" : "#10b98155"}`,
                  borderRadius: "20px"
                }}
                title={
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                      {pomodoroMode === "work" ? "🍅" : "☕"} Pomodoro
                    </span>
                    <Space size={4}>
                      <Button type="text" size="small" icon={<MinusOutlined />} onClick={() => setPomodoroMinimized(true)} />
                      <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setPomodoroVisible(false)} />
                    </Space>
                  </div>
                }
                size="small"
                styles={{ body: { padding: "20px" } }}
              >
                <div style={{ textAlign: "center" }}>
                   <div style={{ position: "relative", display: "inline-block", marginBottom: "20px" }}>
                     <Progress
                       type="circle"
                       percent={(pomodoroSeconds / (pomodoroMode === "work" ? 25*60 : 5*60)) * 100}
                       format={() => (
                         <div style={{ display: "flex", flexDirection: "column" }} className={pomodoroRunning ? "pomodoro-timer-active" : ""}>
                           <span style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace" }}>
                             {Math.floor(pomodoroSeconds / 60)}:{(pomodoroSeconds % 60).toString().padStart(2, "0")}
                           </span>
                         </div>
                       )}
                       width={140}
                       strokeColor={pomodoroMode === "work" ? "#ef4444" : "#10b981"}
                       trailColor="rgba(0,0,0,0.05)"
                       strokeWidth={6}
                     />
                   </div>

                   <Input 
                     placeholder="Tên công việc đang làm..." 
                     value={pomodoroTask} 
                     onChange={e => setPomodoroTask(e.target.value)}
                     disabled={pomodoroRunning}
                     size="middle"
                     style={{ 
                       marginBottom: "16px", 
                       textAlign: "center",
                       borderRadius: "8px",
                       background: "rgba(0,0,0,0.02)", 
                       border: "1px solid var(--glass-border)" 
                     }}
                   />

                   <Space size="middle">
                     <Button 
                       type="primary" 
                       shape="round"
                       icon={pomodoroRunning ? <PauseOutlined /> : <PlayCircleOutlined />} 
                       onClick={() => setPomodoroRunning(!pomodoroRunning)}
                       style={{ 
                         background: pomodoroMode === "work" ? "#ef4444" : "#10b981",
                         borderColor: pomodoroMode === "work" ? "#ef4444" : "#10b981",
                         height: "40px",
                         paddingLeft: "24px",
                         paddingRight: "24px"
                       }}
                     >
                       {pomodoroRunning ? "Tạm dừng" : "Bắt đầu"}
                     </Button>
                     <Tooltip title="Đặt lại">
                       <Button 
                         shape="circle"
                         icon={<ReloadOutlined />} 
                         onClick={() => { setPomodoroRunning(false); setPomodoroSeconds(pomodoroMode === "work" ? 25*60 : 5*60); }}
                         style={{ height: "40px", width: "40px" }}
                       />
                     </Tooltip>
                   </Space>

                   <div style={{ marginTop: "16px", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px" }}>
                     <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                       {pomodoroMode === "work" ? "💻 Tập trung làm việc" : "☕ Nghỉ ngơi giải lao"}
                     </div>
                     <Badge 
                       count={pomodoroSessions} 
                       overflowCount={99} 
                       style={{ backgroundColor: "var(--primary-light)", color: "var(--primary-color)", boxShadow: "none", border: "1px solid var(--glass-border)" }} 
                       title={`Số phiên đã hoàn thành: ${pomodoroSessions}`}
                     />
                   </div>
                </div>
              </Card>
            )
          ) : (
            <Tooltip title="Pomodoro — hẹn giờ tập trung 25 phút" placement="left">
              <Button
                type="primary"
                shape="circle"
                size="large"
                aria-label="Mở Pomodoro"
                icon={<ClockCircleOutlined />}
                onClick={() => setPomodoroVisible(true)}
                style={{
                  width: "48px",
                  height: "48px",
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center", 
                  background: "#ef4444", 
                  borderColor: "#ef4444",
                  boxShadow: "0 8px 25px rgba(239, 68, 68, 0.4)",
                  fontSize: "24px"
                }}
              />
            </Tooltip>
          )}
        </div>
      </Layout>
      {logConfirmEntries && (
        <LogTimeConfirmModal
          entries={logConfirmEntries}
          existingEntries={spentTimeEntries}
          aiConfig={aiConfig}
          redmineServer={redmineServer}
          defaultProject={redmineDefaultProject}
          onCancel={() => setLogConfirmEntries(null)}
          onDone={handleLogConfirmDone}
          onTaskIssueChange={handleTaskIssueChange}
        />
      )}
      {activitySummaryDate && (
        <ActivitySummaryModal
          date={activitySummaryDate}
          aiConfig={aiConfig}
          existingEntries={spentTimeEntries}
          plannedTasks={getTasksForDate(activitySummaryDate)}
          onAddTasks={handleAddTasksToDate}
          onSummaryChange={handleDaySummaryChange}
          onClose={() => setActivitySummaryDate(null)}
        />
      )}
    </ConfigProvider>
  );
}
