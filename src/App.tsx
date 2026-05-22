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
  EyeOutlined,
  EyeInvisibleOutlined,
  HistoryOutlined,
  SunOutlined,
  MoonOutlined,
  CalendarOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import confetti from "canvas-confetti";
import type { Task, ChatMessage } from "./aiService";
import {
  distributeTasksWithAI,
  adjustTasksWithChat,
  parseRawTasksWithAI,
  distributeWeekTasksWithAI,
} from "./aiService";
import {
  DashboardOutlined,
  SearchOutlined,
  PlusCircleOutlined,
} from "@ant-design/icons";
import {
  analyzeRedmineMapping,
  extractSearchQuery,
} from "./aiRedmineService";

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
  return `${dayName}, Ngày ${d.format("DD/MM/YYYY")}`;
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

export default function App() {
  // Giao diện: Chế độ sáng/tối và Tab hiển thị
  const [themeMode, setThemeMode] = useState<"dark" | "light">("dark");
  const [viewMode, setViewMode] = useState<"daily" | "weekly">("daily");

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
  const [customApiKey, setCustomApiKey] = useState("");
  const [redmineServer, setRedmineServer] = useState("");
  const [redmineApiKey, setRedmineApiKey] = useState("");
  const [redmineDefaultProject, setRedmineDefaultProject] = useState("");

  // Active module: "daily" | "weekly" | "dashboard" | "settings" | "spent_time"
  const [activeModule, setActiveModule] = useState<"daily" | "weekly" | "dashboard" | "settings" | "spent_time">("daily");

  // Redmine Tickets Dashboard states
  const [userRedmineTickets, setUserRedmineTickets] = useState<any[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);

  // Spent Time states
  const [spentTimeEntries, setSpentTimeEntries] = useState<any[]>([]);
  const [isLoadingSpentTime, setIsLoadingSpentTime] = useState(false);
  const [spentTimeFilter, setSpentTimeFilter] = useState<"all" | "this_month" | "last_month">("all");
  const [spentTimePage, setSpentTimePage] = useState(1);
  const [spentTimePageSize, setSpentTimePageSize] = useState(10);

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
    const savedApiKey = localStorage.getItem("logtime_custom_apikey");

    if (savedApiKey) {
      setCustomApiKey(savedApiKey);
    }

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
          content: "Xin chào! Mình là trợ lý AI phân bổ LogTime. Hãy thêm các task bạn đã làm hôm nay, đánh dấu độ quan trọng hoặc khóa những task có giờ cố định. Sau đó nhấn **Phân bổ thời gian bằng AI** để mình chia đủ 8 tiếng nhé!",
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
          setRedmineApiKey(data.apiKey || "");
        }
      })
      .catch((err) => console.error("Lỗi khi tải cấu hình Redmine:", err));

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
      antdMessage.error("Không thể tải danh sách thời gian đã báo cáo");
    } finally {
      setIsLoadingSpentTime(false);
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
    }
  }, [activeModule, redmineServer, redmineApiKey]);

  useEffect(() => {
    if (activeModule === "spent_time") {
      handleFetchSpentTime();
    }
  }, [activeModule, redmineServer, redmineApiKey]);

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
    if (viewMode === "weekly") {
      loadWeeklyData();
    }
  }, [selectedDate, viewMode]);

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
  const saveDailyState = (updatedTasks: Task[], updatedExplanation: string, updatedChat: ChatMessage[]) => {
    localStorage.setItem(`logtime_tasks_${selectedDate}`, JSON.stringify(updatedTasks));
    localStorage.setItem(`logtime_explanation_${selectedDate}`, updatedExplanation);
    localStorage.setItem(`logtime_chat_${selectedDate}`, JSON.stringify(updatedChat));
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
  const isEightHours = totalHours === 8.0;

  // Thêm task thủ công ngày
  const handleAddTask = () => {
    if (!inputName.trim()) {
      antdMessage.warning("Vui lòng nhập tên công việc!");
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
    antdMessage.success("Đã thêm công việc thành công!");
  };

  // Nạp nhanh mẫu công việc ngày
  const handleQuickPopulate = () => {
    const newTasks = TEMPLATE_TASKS.map((t) => ({
      ...t,
      id: Math.random().toString(36).substring(2, 9),
    }));
    handleSetTasks(newTasks);
    antdMessage.success("Đã nạp danh sách công việc mẫu thành công!");
  };

  // Xóa task
  const handleDeleteTask = (id: string) => {
    const newTasks = tasks.filter((t) => t.id !== id);
    handleSetTasks(newTasks);
    antdMessage.info("Đã xóa công việc.");
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
      antdMessage.warning("Vui lòng thêm ít nhất một công việc trước khi phân bổ!");
      return;
    }

    setIsAnalyzing(true);
    try {
      const response = await distributeTasksWithAI(tasks, customApiKey);
      
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

      setExplanation(response.explanation);
      setChatHistory(newChat);
      setTasks(response.tasks);
      saveDailyState(response.tasks, response.explanation, newChat);

      if (calculateTotalHours(response.tasks) === 8.0) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
        antdMessage.success("AI đã phân bổ đủ 8 tiếng một ngày tuyệt vời!");
      }
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
      antdMessage.warning("Danh sách công việc trống, vui lòng thêm công việc trước khi điều chỉnh!");
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
        customApiKey
      );

      const nextHistory: ChatMessage[] = [
        ...updatedHistory,
        { role: "assistant", content: response.aiMessage },
      ];

      setChatHistory(nextHistory);
      setTasks(response.tasks);
      saveDailyState(response.tasks, explanation, nextHistory);

      if (calculateTotalHours(response.tasks) === 8.0) {
        confetti({
          particleCount: 50,
          spread: 45,
          colors: ["#5e5d59", "#b5c4b1", "#e9c46a"],
        });
        antdMessage.success("Đã điều chỉnh thành công và duy trì đủ 8.0 tiếng!");
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
      antdMessage.warning("Vui lòng nhập văn bản thô!");
      return;
    }

    setIsParsingRaw(true);
    try {
      const response = await parseRawTasksWithAI(rawInputText, customApiKey);
      
      setSelectedDate(response.date);

      const newChat: ChatMessage[] = [
        ...chatHistory,
        {
          role: "system",
          content: `AI phân tích văn bản thô cho ngày ${response.date}`,
        },
        {
          role: "assistant",
          content: `Đã xử lý danh sách công việc cho ngày ${response.date}! ${response.explanation}`,
        },
      ];

      setExplanation(response.explanation);
      setChatHistory(newChat);
      setTasks(response.tasks);
      
      saveDailyState(response.tasks, response.explanation, newChat);
      setRawInputText("");

      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
      });
      antdMessage.success(`Đã phân tích xong và chuyển sang ngày ${response.date}!`);
    } catch (error: any) {
      antdMessage.error(error.message || "Đã xảy ra lỗi khi phân tích văn bản thô.");
    } finally {
      setIsParsingRaw(false);
    }
  };

  // Xóa lịch sử chat
  const handleClearChat = () => {
    const initialChat: ChatMessage[] = [
      {
        role: "assistant",
        content: "Mình đã sẵn sàng trợ giúp điều chỉnh lại logtime cho bạn.",
      },
    ];
    setChatHistory(initialChat);
    saveDailyState(tasks, explanation, initialChat);
    antdMessage.info("Đã xóa lịch sử hội thoại.");
  };

  // Xuất file CSV ngày
  const handleExportCSV = () => {
    if (tasks.length === 0) {
      antdMessage.warning("Không có dữ liệu để xuất!");
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
    antdMessage.success("Đã tải xuống file CSV!");
  };

  // Copy báo cáo ngày
  const handleExportText = () => {
    if (tasks.length === 0) {
      antdMessage.warning("Không có dữ liệu để xuất!");
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
    antdMessage.success("Đã sao chép báo cáo logtime vào clipboard!");
  };

  // Lưu API Key & cấu hình Redmine
  const handleSaveApiKey = async () => {
    localStorage.setItem("logtime_custom_apikey", customApiKey);
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
        antdMessage.success("Đã cập nhật cấu hình API Key & Redmine thành công!");
      } else {
        antdMessage.error("Không thể lưu cấu hình Redmine: " + data.error);
      }
    } catch (e: any) {
      antdMessage.error("Lỗi khi kết nối server: " + e.message);
    }
  };

  // Đồng bộ thời gian lên Redmine cho các task của ngày hiện tại
  const handleSyncToRedmine = async () => {
    // Check weekend (0 = Sunday, 6 = Saturday)
    const dayOfWeek = dayjs(selectedDate).day();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      antdMessage.error("Không được phép log time vào Thứ Bảy và Chủ Nhật!");
      return;
    }

    const syncableTasks = tasks.filter(
      (t) => t.duration > 0 && (t.redmineIssue || t.redmineProject || redmineDefaultProject)
    );

    if (syncableTasks.length === 0) {
      antdMessage.warning(
        "Không có công việc hợp lệ để đồng bộ (công việc cần có số giờ > 0 và được gán mã Issue/Dự án)!"
      );
      return;
    }

    setIsSyncingRedmine(true);
    let successCount = 0;
    let failCount = 0;
    let errors: string[] = [];

    for (const task of syncableTasks) {
      try {
        const res = await fetch("/api/redmine/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hours: task.duration,
            comment: task.name,
            date: selectedDate,
            issue: task.redmineIssue,
            project: task.redmineProject || redmineDefaultProject || undefined,
          }),
        });
        const data = await res.json();
        if (data.success) {
          successCount++;
        } else {
          failCount++;
          errors.push(`${task.name}: ${data.error}`);
        }
      } catch (err: any) {
        failCount++;
        errors.push(`${task.name}: ${err.message}`);
      }
    }

    setIsSyncingRedmine(false);

    if (failCount === 0) {
      antdMessage.success(`Đồng bộ thành công ${successCount} công việc lên Redmine!`);
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.7 },
      });
    } else {
      Modal.error({
        title: "Đồng bộ Redmine hoàn tất với lỗi",
        content: (
          <div>
            <p>Đồng bộ thành công: {successCount} công việc.</p>
            <p>Thất bại: {failCount} công việc.</p>
            <div style={{ marginTop: "12px", maxHeight: "150px", overflowY: "auto", background: "rgba(0,0,0,0.05)", padding: "8px", borderRadius: "4px" }}>
              {errors.map((err, i) => (
                <div key={i} style={{ color: "red", fontSize: "12px", marginBottom: "4px" }}>{err}</div>
              ))}
            </div>
          </div>
        ),
      });
    }
  };

  // --- LOGIC CHO PHẦN LOGTIME TUẦN (NHIỀU NGÀY) ---

  // Thêm nhanh công việc vào một ngày cụ thể trong tuần
  const handleAddQuickWeekTask = (date: string) => {
    const taskName = quickTaskNames[date] || "";
    if (!taskName.trim()) {
      antdMessage.warning("Vui lòng nhập tên công việc!");
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

    const updatedTasks = [...(weeklyTasks[date] || []), newTask];
    const newWeeklyTasks = { ...weeklyTasks, [date]: updatedTasks };
    
    setWeeklyTasks(newWeeklyTasks);
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updatedTasks));

    // Nếu trùng với ngày đang xem ở Daily View, cập nhật luôn
    if (date === selectedDate) {
      setTasks(updatedTasks);
    }

    // Reset input của ngày đó
    setQuickTaskNames({ ...quickTaskNames, [date]: "" });
    antdMessage.success(`Đã thêm công việc vào ngày ${dayjs(date).format("DD/MM")}`);
  };

  // Xóa task nhanh ở bảng tuần
  const handleDeleteWeekTask = (date: string, taskId: string) => {
    const updatedTasks = (weeklyTasks[date] || []).filter((t) => t.id !== taskId);
    const newWeeklyTasks = { ...weeklyTasks, [date]: updatedTasks };

    setWeeklyTasks(newWeeklyTasks);
    localStorage.setItem(`logtime_tasks_${date}`, JSON.stringify(updatedTasks));

    if (date === selectedDate) {
      setTasks(updatedTasks);
    }
    antdMessage.info("Đã xóa công việc khỏi tuần.");
  };

  // Toggle Lock nhanh ở bảng tuần
  const handleToggleWeekLock = (date: string, taskId: string, checked: boolean) => {
    const updatedTasks = (weeklyTasks[date] || []).map((t) => {
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
    const updatedTasks = (weeklyTasks[date] || []).map((t) => {
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
      antdMessage.warning("Vui lòng thêm ít nhất một công việc vào bất kỳ ngày nào trong tuần!");
      return;
    }

    setIsWeeklyAnalyzing(true);
    try {
      const response = await distributeWeekTasksWithAI(weeklyTasks, customApiKey);

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

      confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.5 },
      });
      antdMessage.success("AI đã tự động phân bổ đủ 8.0 tiếng cho từng ngày trong tuần thành công!");
    } catch (error: any) {
      antdMessage.error(error.message || "Không thể gọi AI phân bổ tuần.");
    } finally {
      setIsWeeklyAnalyzing(false);
    }
  };

  // Chuyển sang xem/chỉnh sửa chi tiết một ngày
  const handleViewDayDetail = (date: string) => {
    setSelectedDate(date);
    setViewMode("daily");
    antdMessage.info(`Đã chuyển sang chế độ ngày chi tiết cho ngày ${dayjs(date).format("DD/MM/YYYY")}`);
  };

  // Cột bảng của giao diện Ngày
  const columns = [
    {
      title: "Tên công việc",
      dataIndex: "name",
      key: "name",
      render: (text: string) => <span style={{ fontWeight: 500 }}>{text}</span>,
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
      title: "Thời gian (giờ)",
      dataIndex: "duration",
      key: "duration",
      width: 130,
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
      title: "Mã Issue Redmine",
      dataIndex: "redmineIssue",
      key: "redmineIssue",
      width: 140,
      render: (val: number | undefined, record: Task) => (
        <InputNumber
          placeholder="Issue ID"
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
      title: "Dự án Redmine",
      dataIndex: "redmineProject",
      key: "redmineProject",
      width: 130,
      render: (val: string | undefined, record: Task) => (
        <Input
          placeholder="Project ID/Key"
          value={val || ""}
          onChange={(e) => {
            const newVal = e.target.value;
            const newTasks = tasks.map((t) => {
              if (t.id === record.id) {
                return { ...t, redmineProject: newVal || undefined };
              }
              return t;
            });
            handleSetTasks(newTasks);
          }}
        />
      ),
    },
    {
      title: "Khóa giờ",
      dataIndex: "isLocked",
      key: "isLocked",
      width: 100,
      align: "center" as const,
      render: (locked: boolean, record: Task) => (
        <Tooltip title={locked ? "Mở khóa để AI tự động chia lại" : "Khóa giờ cố định"}>
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
      title: "Chi tiết từ AI",
      dataIndex: "aiReason",
      key: "aiReason",
      render: (text: string) => (
        <Text type="secondary" italic style={{ fontSize: "13px" }}>
          {text || "Chưa có phân tích"}
        </Text>
      ),
    },
    {
      title: "Hành động",
      key: "action",
      width: 120,
      align: "center" as const,
      render: (_: any, record: Task) => (
        <Space>
          <Tooltip title="Ánh xạ Redmine (AI)">
            <Button
              type="text"
              icon={<RobotOutlined style={{ color: record.redmineIssue ? "var(--success-color)" : "var(--text-secondary)" }} />}
              onClick={() => handleStartAiMapping(record)}
            />
          </Tooltip>
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteTask(record.id)}
          />
        </Space>
      ),
    },
  ];

  // Import ticket từ Redmine Dashboard vào Planner
  const handleImportTicket = (ticket: any) => {
    if (tasks.some((t) => t.redmineIssue === ticket.id)) {
      antdMessage.warning("Công việc này đã có trong danh sách hôm nay!");
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
    antdMessage.success(`Đã nạp ticket #${ticket.id} vào danh sách hôm nay!`);
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

      const queryKeyword = await extractSearchQuery(task.name, customApiKey);
      
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

      const suggestion = await analyzeRedmineMapping(task.name, allCandidates, customApiKey);
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
      antdMessage.info("Tất cả công việc đã được gán mã Issue Redmine!");
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
        const queryKeyword = await extractSearchQuery(task.name, customApiKey);
        
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

        const suggestion = await analyzeRedmineMapping(task.name, allCandidates, customApiKey);
        
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
          width={260}
          className="app-sider"
          style={{
            background: themeMode === "dark" ? "#191918" : "#f0eee6",
            borderRight: "1px solid var(--glass-border)",
            position: "fixed",
            height: "100vh",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
          }}
        >
          <div style={{ padding: "20px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid var(--glass-border)", height: "70px" }}>
            <RobotOutlined style={{ fontSize: "28px", color: "var(--primary-color)" }} />
            <span style={{ fontSize: "18px", fontWeight: "bold", fontFamily: "Lora, serif", color: "var(--text-primary)" }}>LogTime AI</span>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[activeModule]}
            onClick={({ key }) => setActiveModule(key as any)}
            style={{ background: "transparent", borderRight: 0, marginTop: "16px" }}
            items={[
              { key: "daily", icon: <HistoryOutlined />, label: "LogTime Hàng Ngày" },
              { key: "weekly", icon: <CalendarOutlined />, label: "Quản Lý Theo Tuần" },
              { key: "dashboard", icon: <DashboardOutlined />, label: "Dashboard Redmine" },
              { key: "spent_time", icon: <ClockCircleOutlined />, label: "Thời Gian Đã Báo Cáo" },
              { key: "settings", icon: <SettingOutlined />, label: "Cấu hình" },
            ]}
          />
        </Sider>

        <Layout className="main-layout-wrapper" style={{ minHeight: "100vh" }}>
          {/* App Header */}
          <Header className="app-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", height: "70px", padding: "0 24px" }}>
            <div style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
              {activeModule === "daily" && `Daily Planner - ${dayjs(selectedDate).format("DD/MM/YYYY")}`}
              {activeModule === "weekly" && `Weekly Overview (${mondayFormatted} - ${sundayFormatted})`}
              {activeModule === "dashboard" && "Redmine Tickets Dashboard"}
              {activeModule === "spent_time" && "Báo cáo Thời gian (Spent Time)"}
              {activeModule === "settings" && "Advanced Settings"}
            </div>
            
            <Space size="large">
              {/* Toggle Light/Dark Mode */}
              <Tooltip title={themeMode === "dark" ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}>
                <Switch
                  checkedChildren={<MoonOutlined />}
                  unCheckedChildren={<SunOutlined />}
                  checked={themeMode === "dark"}
                  onChange={handleToggleTheme}
                  style={{ background: themeMode === "dark" ? "var(--primary-color)" : "rgba(0, 0, 0, 0.25)" }}
                />
              </Tooltip>

              {/* Chọn Ngày - Chỉ hiển thị khi ở tab Planner/Dashboard/Weekly */}
              {activeModule !== "settings" && activeModule !== "spent_time" && (
                <DatePicker
                  value={dayjs(selectedDate)}
                  onChange={(date) => setSelectedDate(date ? date.format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD"))}
                  allowClear={false}
                  format="DD/MM/YYYY"
                  style={{ width: "160px" }}
                />
              )}
            </Space>
          </Header>

          {/* Content Layout */}
          <Content className="app-content">
            
            {/* GIAO DIỆN XEM HÀNG NGÀY (DAILY VIEW) */}
            {activeModule === "daily" && (
              <Row gutter={[24, 24]}>
                {/* Cột chính bên trái */}
                <Col xs={24} lg={16}>
                  <Row gutter={[16, 16]} style={{ marginBottom: "20px" }}>
                    <Col xs={12} sm={8}>
                      <div className="glass-stat-card">
                        <div className="label">Tổng thời gian logged</div>
                        <div className="value" style={{ color: isEightHours ? "var(--success-color)" : "var(--warning-color)" }}>
                          {totalHours} / 8.0 giờ
                        </div>
                      </div>
                    </Col>

                    <Col xs={12} sm={8}>
                      <div className="glass-stat-card">
                        <div className="label">Tổng số công việc</div>
                        <div className="value">{tasks.length} tasks</div>
                      </div>
                    </Col>

                    <Col xs={24} sm={8}>
                      <div className="glass-stat-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%" }}>
                        <div className="label" style={{ marginBottom: "8px" }}>Trạng thái tiến độ</div>
                        <Progress
                          percent={Math.min(100, (totalHours / 8) * 100)}
                          status={isEightHours ? "success" : "active"}
                          strokeColor={isEightHours ? "var(--success-color)" : "var(--warning-color)"}
                          showInfo={false}
                          style={{ margin: 0 }}
                        />
                      </div>
                    </Col>
                  </Row>

                  {/* Bảng công việc */}
                  <Card
                    className="glass-panel"
                    title={
                      <Space style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: "12px" }}>
                        <span style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
                          Danh sách công việc ngày {dayjs(selectedDate).format("DD/MM/YYYY")}
                        </span>
                        <Space flex-wrap="wrap">
                          {tasks.length === 0 && (
                            <Button type="dashed" icon={<HistoryOutlined />} onClick={handleQuickPopulate}>
                              Nạp công việc mẫu
                            </Button>
                          )}
                          <Button
                            type="default"
                            icon={<RobotOutlined />}
                            onClick={handleStartBulkAiMapping}
                            loading={isBulkMappingLoading}
                            disabled={tasks.filter(t => !t.redmineIssue).length === 0}
                          >
                            Tự động ánh xạ toàn bộ (AI)
                          </Button>
                          <Button
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            onClick={handleAIDistribute}
                            loading={isAnalyzing}
                            className={!isEightHours && tasks.length > 0 ? "glow-active" : ""}
                          >
                            Phân bổ thời gian bằng AI
                          </Button>
                        </Space>
                      </Space>
                    }
                    styles={{ header: { borderBottom: "1px solid var(--glass-border)", padding: "16px 24px" }, body: { padding: "12px 0 0 0" } }}
                    style={{ marginBottom: "24px" }}
                  >
                    <Table
                      dataSource={tasks}
                      columns={columns}
                      rowKey="id"
                      pagination={false}
                      scroll={{ x: 1200 }}
                      locale={{
                        emptyText: (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                              <span style={{ color: "var(--text-secondary)" }}>
                                Hôm nay chưa có công việc nào. Hãy nhập nhanh văn bản thô hoặc điền form ở dưới.
                              </span>
                            }
                          />
                        ),
                      }}
                      rowClassName={(record) => (record.isLocked ? "task-locked-row" : "task-unlocked-row")}
                    />
                  </Card>

                  {/* Form thêm mới Task */}
                  <Card
                    className="glass-panel"
                    title={<span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>Thêm công việc mới</span>}
                    styles={{ header: { borderBottom: "1px solid var(--glass-border)", padding: "12px 24px" }, body: { padding: "20px" } }}
                  >
                    <Row gutter={[16, 16]}>
                      <Col xs={24} md={12}>
                        <div style={{ marginBottom: "6px", color: "var(--text-secondary)" }}>Tên công việc:</div>
                        <Input
                          placeholder="Ví dụ: Họp Standup, Code API..."
                          value={inputName}
                          onChange={(e) => setInputName(e.target.value)}
                          onPressEnter={handleAddTask}
                        />
                      </Col>

                      <Col xs={12} md={6}>
                        <div style={{ marginBottom: "6px", color: "var(--text-secondary)" }}>Mã Issue Redmine:</div>
                        <InputNumber
                          placeholder="Ví dụ: 12345"
                          value={inputRedmineIssue}
                          onChange={(val) => setInputRedmineIssue(val || undefined)}
                          style={{ width: "100%" }}
                        />
                      </Col>

                      <Col xs={12} md={6}>
                        <div style={{ marginBottom: "6px", color: "var(--text-secondary)" }}>Dự án Redmine:</div>
                        <Input
                          placeholder="ID dự án (nếu không có Issue)"
                          value={inputRedmineProject}
                          onChange={(e) => setInputRedmineProject(e.target.value)}
                          onPressEnter={handleAddTask}
                        />
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]} align="bottom" style={{ marginTop: "16px" }}>
                      <Col xs={12} sm={6} md={6}>
                        <div style={{ marginBottom: "6px", color: "var(--text-secondary)" }}>Độ ưu tiên:</div>
                        <Select value={inputImportance} onChange={setInputImportance} style={{ width: "100%" }}>
                          <Option value="high">Cao</Option>
                          <Option value="medium">Trung bình</Option>
                          <Option value="low">Thấp</Option>
                        </Select>
                      </Col>

                      <Col xs={12} sm={6} md={6}>
                        <div style={{ marginBottom: "6px", color: "var(--text-secondary)" }}>Danh mục:</div>
                        <Select value={inputCategory} onChange={setInputCategory} style={{ width: "100%" }}>
                          <Option value="Coding">Coding</Option>
                          <Option value="Meeting">Meeting</Option>
                          <Option value="Review">Review</Option>
                          <Option value="Research">Research</Option>
                          <Option value="Documentation">Docs</Option>
                          <Option value="Other">Khác</Option>
                        </Select>
                      </Col>

                      <Col xs={12} sm={6} md={6}>
                        <div style={{ marginBottom: "6px", color: "var(--text-secondary)" }}>Số giờ sẵn:</div>
                        <InputNumber
                          min={0}
                          max={8}
                          step={0.5}
                          value={inputDuration}
                          onChange={(val) => setInputDuration(val || 0)}
                          style={{ width: "100%" }}
                        />
                      </Col>

                      <Col xs={12} sm={6} md={6}>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={handleAddTask}
                          style={{ width: "100%" }}
                        >
                          Thêm công việc
                        </Button>
                      </Col>
                    </Row>
                  </Card>

                  {/* Truyền nhanh từ văn bản thô */}
                  <Card
                    className="glass-panel"
                    title={<span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>Truyền nhanh danh sách công việc thô</span>}
                    styles={{ header: { borderBottom: "1px solid var(--glass-border)", padding: "12px 24px" }, body: { padding: "20px" } }}
                    style={{ marginTop: "24px" }}
                  >
                    <div style={{ marginBottom: "12px" }}>
                      <Text type="secondary" style={{ fontSize: "13px" }}>
                        Nhập ngày và danh sách công việc bằng văn bản thô (AI sẽ tự nhận diện ngày, trích xuất task và phân bổ đủ 8.0 tiếng).
                      </Text>
                    </div>
                    <Input.TextArea
                      rows={6}
                      placeholder={`Ví dụ:\nNgày 4 tháng 5 năm 2026\n- Kiểm tra khảo sát ML\n- Tắt khách vãng lai và mới ĐK minh Long\n- Ovaltine popup\n- Kiểm tra đổi qua disable nút\n- Davipharm tin tức video`}
                      value={rawInputText}
                      onChange={(e) => setRawInputText(e.target.value)}
                      style={{ marginBottom: "16px" }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        onClick={handleParseRawTasks}
                        loading={isParsingRaw}
                      >
                        Phân tích & Phân bổ bằng AI
                      </Button>
                    </div>
                  </Card>
                </Col>

                {/* Cột phụ bên phải */}
                <Col xs={24} lg={8}>
                  <Card
                    className="glass-panel"
                    title={
                      <Space style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                        <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
                          <RobotOutlined style={{ color: "var(--primary-color)" }} />
                          Trợ lý AI LogTime
                        </span>
                        <Button
                          type="text"
                          size="small"
                          icon={<ClearOutlined />}
                          onClick={handleClearChat}
                          style={{ color: "var(--text-secondary)" }}
                        />
                      </Space>
                    }
                    styles={{ header: { borderBottom: "1px solid var(--glass-border)", padding: "14px 24px" }, body: { padding: "16px" } }}
                    style={{ marginBottom: "24px" }}
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
                            <span>Đang xử lý phân bổ lại thời gian...</span>
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                      
                      <div style={{ display: "flex", gap: "8px" }}>
                        <Input
                          placeholder="Yêu cầu AI điều chỉnh công việc..."
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onPressEnter={handleSendChat}
                          disabled={isChatting}
                        />
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={handleSendChat}
                          loading={isChatting}
                        />
                      </div>
                    </div>
                  </Card>

                  {/* Xuất báo cáo */}
                  <Card
                    className="glass-panel"
                    title={<span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>Báo cáo & Xuất dữ liệu</span>}
                    styles={{ header: { borderBottom: "1px solid var(--glass-border)", padding: "12px 24px" }, body: { padding: "20px" } }}
                  >
                    <Space direction="vertical" style={{ width: "100%" }} size="middle">
                      <Text type="secondary">
                        Xuất hoặc sao chép logtime ngày để đồng bộ vào các hệ thống quản trị công việc.
                      </Text>
                      
                      {explanation && (
                        <div style={{ background: "var(--bubble-assistant-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", padding: "12px" }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--primary-color)", marginBottom: "4px" }}>Đánh giá ngày:</div>
                          <Text style={{ fontSize: "13px" }}>{explanation}</Text>
                        </div>
                      )}

                      <Row gutter={12}>
                        <Col span={12}>
                          <Button
                            type="default"
                            icon={<CopyOutlined />}
                            onClick={handleExportText}
                            style={{ width: "100%" }}
                            disabled={tasks.length === 0}
                          >
                            Copy bảng log
                          </Button>
                        </Col>
                        <Col span={12}>
                          <Button
                            type="default"
                            icon={<DownloadOutlined />}
                            onClick={handleExportCSV}
                            style={{ width: "100%" }}
                            disabled={tasks.length === 0}
                          >
                            Tải CSV
                          </Button>
                        </Col>
                      </Row>

                      <Row gutter={12} style={{ marginTop: "12px" }}>
                        <Col span={24}>
                          <Button
                            type="primary"
                            icon={<ThunderboltOutlined />}
                            onClick={handleSyncToRedmine}
                            style={{ width: "100%" }}
                            loading={isSyncingRedmine}
                            disabled={tasks.length === 0}
                          >
                            Đồng bộ Redmine
                          </Button>
                        </Col>
                      </Row>
                    </Space>
                  </Card>
                </Col>
              </Row>
            )}

            {/* GIAO DIỆN XEM THEO TUẦN (WEEKLY VIEW) */}
            {activeModule === "weekly" && (
              <div>
                <Card
                  className="glass-panel"
                  title={
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", flexWrap: "wrap", gap: "12px" }}>
                      <div>
                        <span style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)" }}>
                          Lịch trình LogTime Tuần
                        </span>
                        <Text type="secondary" style={{ marginLeft: "12px", fontSize: "14px" }}>
                          ({mondayFormatted} - {sundayFormatted})
                        </Text>
                      </div>
                      {weeklyExplanation && (
                        <div style={{ maxWidth: "60%", background: "var(--bubble-assistant-bg)", border: "1px solid var(--glass-border)", borderRadius: "8px", padding: "8px 16px" }}>
                          <Text style={{ fontSize: "13px" }}>💡 <b>Nhận xét tuần:</b> {weeklyExplanation}</Text>
                        </div>
                      )}
                      <div>
                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          onClick={handleAIWeeklyDistribute}
                          loading={isWeeklyAnalyzing}
                        >
                          AI Phân Bổ Cả Tuần (Độc lập 8h/ngày)
                        </Button>
                      </div>
                    </div>
                  }
                  styles={{ header: { borderBottom: "1px solid var(--glass-border)", padding: "16px 24px" } }}
                  style={{ marginBottom: "24px" }}
                >
                  <Row gutter={[16, 16]}>
                    {weekDays.map((day, idx) => {
                      const dayTasks = weeklyTasks[day] || [];
                      const dayHours = calculateTotalHours(dayTasks);
                      const isDayEightHours = dayHours === 8.0;
                      const dayName = DAY_NAMES_VI[idx];
                      const isToday = day === dayjs().format("YYYY-MM-DD");

                      return (
                        <Col xs={24} sm={12} md={8} lg={8} xl={6} key={day}>
                          <AntdCard
                            size="small"
                            title={
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                 <span style={{ fontWeight: 600, color: isToday ? "var(--primary-color)" : "inherit" }}>
                                   {dayName} {isToday && <Badge status="processing" color="var(--primary-color)" />}
                                 </span>
                                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                  {dayjs(day).format("DD/MM")}
                                </span>
                              </div>
                            }
                            style={{
                              background: isToday 
                                ? "var(--primary-light)" 
                                : (themeMode === "dark" ? "rgba(255, 255, 255, 0.01)" : "rgba(0, 0, 0, 0.01)"),
                              borderColor: isToday ? "var(--primary-color)" : "var(--glass-border)",
                              boxShadow: isToday ? "var(--glow-shadow-1)" : "none"
                            }}
                            actions={[
                              <Button type="link" size="small" icon={<ArrowRightOutlined />} onClick={() => handleViewDayDetail(day)}>
                                Chi tiết ngày
                              </Button>
                            ]}
                          >
                            {/* Thống kê giờ trong ngày */}
                            <div style={{ marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Đã log:</span>
                              <span style={{ fontWeight: "bold", color: isDayEightHours ? "var(--success-color)" : "var(--warning-color)" }}>
                                {dayHours} / 8.0h
                              </span>
                            </div>
                            <Progress
                              percent={Math.min(100, (dayHours / 8) * 100)}
                              strokeColor={isDayEightHours ? "var(--success-color)" : "var(--warning-color)"}
                              size="small"
                              status={isDayEightHours ? "success" : "normal"}
                              style={{ marginBottom: "16px" }}
                            />

                            {/* Danh sách Task của ngày */}
                            <div style={{ minHeight: "180px", maxHeight: "250px", overflowY: "auto", marginBottom: "16px" }}>
                              {dayTasks.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "30px 0" }}>
                                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: "12px" }}>Không có task</span>} />
                                </div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                  {dayTasks.map((t) => (
                                    <div
                                      key={t.id}
                                      style={{
                                        padding: "8px",
                                        background: themeMode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                                        border: "1px solid var(--glass-border)",
                                        borderRadius: "8px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "4px"
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                        <Text style={{ fontSize: "13px", fontWeight: 500, width: "70%" }} ellipsis={{ tooltip: t.name }}>
                                          {t.name}
                                        </Text>
                                        <Button
                                          type="text"
                                          size="small"
                                          danger
                                          icon={<DeleteOutlined style={{ fontSize: "11px" }} />}
                                          onClick={() => handleDeleteWeekTask(day, t.id)}
                                          style={{ height: "18px", width: "18px", padding: 0 }}
                                        />
                                      </div>

                                      <div style={{ display: "flex", gap: "4px", alignItems: "center", marginTop: "2px", marginBottom: "2px" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Issue:</span>
                                        <InputNumber
                                          placeholder="ID"
                                          size="small"
                                          value={t.redmineIssue}
                                          onChange={(val) => {
                                            const updatedTasks = (weeklyTasks[day] || []).map((task) => {
                                              if (task.id === t.id) {
                                                return { ...task, redmineIssue: val === null ? undefined : val };
                                              }
                                              return task;
                                            });
                                            const newWeeklyTasks = { ...weeklyTasks, [day]: updatedTasks };
                                            setWeeklyTasks(newWeeklyTasks);
                                            localStorage.setItem(`logtime_tasks_${day}`, JSON.stringify(updatedTasks));
                                            if (day === selectedDate) {
                                              setTasks(updatedTasks);
                                            }
                                          }}
                                          style={{ width: "65px", fontSize: "11px" }}
                                        />
                                        <Input
                                          placeholder="Proj"
                                          size="small"
                                          value={t.redmineProject || ""}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            const updatedTasks = (weeklyTasks[day] || []).map((task) => {
                                              if (task.id === t.id) {
                                                return { ...task, redmineProject: val || undefined };
                                              }
                                              return task;
                                            });
                                            const newWeeklyTasks = { ...weeklyTasks, [day]: updatedTasks };
                                            setWeeklyTasks(newWeeklyTasks);
                                            localStorage.setItem(`logtime_tasks_${day}`, JSON.stringify(updatedTasks));
                                            if (day === selectedDate) {
                                              setTasks(updatedTasks);
                                            }
                                          }}
                                          style={{ flex: 1, fontSize: "11px", height: "24px" }}
                                        />
                                      </div>

                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                                        <Space size={4}>
                                          <Tooltip title={t.isLocked ? "Mở khóa giờ" : "Khóa giờ"}>
                                            <Switch
                                              size="small"
                                              checked={t.isLocked}
                                              onChange={(checked) => handleToggleWeekLock(day, t.id, checked)}
                                            />
                                          </Tooltip>
                                          {t.isLocked ? <LockOutlined style={{ fontSize: "11px", color: "#fbbf24" }} /> : null}
                                        </Space>

                                        <InputNumber
                                          min={0}
                                          max={8}
                                          step={0.5}
                                          size="small"
                                          value={t.duration}
                                          onChange={(val) => handleUpdateWeekDuration(day, t.id, val)}
                                          style={{ width: "65px" }}
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
                      <div className="value" style={{ color: "#fca5a5" }}>
                        {userRedmineTickets.filter(t => ["high", "urgent", "immediate", "cao", "khẩn cấp"].includes(t.priority?.name?.toLowerCase())).length}
                      </div>
                    </div>
                  </Col>
                </Row>

                {/* Phân phối Trạng thái & Độ ưu tiên (Progress Bars) */}
                <Row gutter={[24, 24]} style={{ marginBottom: "24px" }}>
                  <Col xs={24} md={12}>
                    <Card className="glass-panel" title={<span style={{ fontSize: "16px", fontWeight: 600 }}>Tỷ lệ Trạng thái công việc</span>}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {Array.from(new Set(userRedmineTickets.map(t => t.status?.name).filter(Boolean))).map((statusName) => {
                          const count = userRedmineTickets.filter(t => t.status?.name === statusName).length;
                          const pct = userRedmineTickets.length > 0 ? Math.round((count / userRedmineTickets.length) * 100) : 0;
                          return (
                            <div key={statusName}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "13px" }}>
                                <span>{statusName}</span>
                                <span style={{ fontWeight: 500 }}>{count} ({pct}%)</span>
                              </div>
                              <Progress percent={pct} showInfo={false} strokeColor="var(--primary-color)" />
                            </div>
                          );
                        })}
                        {userRedmineTickets.length === 0 && (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu trạng thái" />
                        )}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} md={12}>
                    <Card className="glass-panel" title={<span style={{ fontSize: "16px", fontWeight: 600 }}>Tỷ lệ Mức độ Ưu tiên</span>}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {Array.from(new Set(userRedmineTickets.map(t => t.priority?.name).filter(Boolean))).map((priorityName) => {
                          const count = userRedmineTickets.filter(t => t.priority?.name === priorityName).length;
                          const pct = userRedmineTickets.length > 0 ? Math.round((count / userRedmineTickets.length) * 100) : 0;
                          let color = "var(--primary-color)";
                          if (["high", "urgent", "immediate", "cao", "khẩn cấp"].includes(priorityName.toLowerCase())) {
                            color = "#fca5a5";
                          } else if (["normal", "trung bình"].includes(priorityName.toLowerCase())) {
                            color = "var(--warning-color)";
                          } else {
                            color = "var(--success-color)";
                          }
                          return (
                            <div key={priorityName}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "13px" }}>
                                <span>{priorityName}</span>
                                <span style={{ fontWeight: 500 }}>{count} ({pct}%)</span>
                              </div>
                              <Progress percent={pct} showInfo={false} strokeColor={color} />
                            </div>
                          );
                        })}
                        {userRedmineTickets.length === 0 && (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có dữ liệu độ ưu tiên" />
                        )}
                      </div>
                    </Card>
                  </Col>
                </Row>

                {/* Tickets Table Panel */}
                <Card
                  className="glass-panel"
                  title={
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                      <span style={{ fontSize: "18px", fontWeight: 600 }}>Danh sách Ticket trên Redmine của tôi</span>
                      <Button
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        onClick={handleRefreshDashboardTickets}
                        loading={isLoadingDashboard}
                      >
                        Làm mới
                      </Button>
                    </div>
                  }
                  styles={{ body: { padding: "20px 0 0 0" } }}
                >
                  {/* Search & Filters */}
                  <div style={{ display: "flex", gap: "12px", marginBottom: "16px", padding: "0 24px", flexWrap: "wrap" }}>
                    <Input
                      placeholder="Tìm kiếm theo ID, chủ đề hoặc dự án..."
                      prefix={<SearchOutlined style={{ color: "var(--text-secondary)" }} />}
                      value={dashboardSearch}
                      onChange={(e) => setDashboardSearch(e.target.value)}
                      style={{ width: "280px" }}
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
                          return <Tag color={color} style={{ borderRadius: "4px" }}>{status}</Tag>;
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
                            type="primary"
                            size="small"
                            icon={<PlusCircleOutlined />}
                            onClick={() => handleImportTicket(ticket)}
                          >
                            Nạp vào Planner
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
              <div style={{ maxWidth: "600px", margin: "0 auto" }}>
                <Card
                  className="glass-panel"
                  title={<span style={{ fontSize: "18px", fontWeight: 600 }}>Cấu hình hệ thống & Tích hợp Redmine</span>}
                  extra={
                    <Button type="primary" onClick={handleSaveApiKey}>
                      Lưu cấu hình
                    </Button>
                  }
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    <div>
                      <div style={{ marginBottom: "6px", fontWeight: 500 }}>API Key (Z.AI):</div>
                      <Input.Password
                        placeholder="Nhập API Key của bạn"
                        value={customApiKey}
                        onChange={(e) => setCustomApiKey(e.target.value)}
                        iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                      />
                      <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
                        Nếu để trống, hệ thống sẽ sử dụng API Key mặc định của bạn.
                      </Text>
                    </div>

                    <div style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "20px" }}>
                      <div style={{ fontWeight: 600, marginBottom: "16px", fontSize: "14px", color: "var(--primary-color)" }}>Tích hợp Redmine CLI:</div>
                      
                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ marginBottom: "6px", fontWeight: 500 }}>Redmine Server URL:</div>
                        <Input
                          placeholder="Ví dụ: https://redmine.mycompany.com"
                          value={redmineServer}
                          onChange={(e) => setRedmineServer(e.target.value)}
                        />
                      </div>

                      <div style={{ marginBottom: "16px" }}>
                        <div style={{ marginBottom: "6px", fontWeight: 500 }}>Redmine API Key:</div>
                        <Input.Password
                          placeholder="Nhập Redmine API Token"
                          value={redmineApiKey}
                          onChange={(e) => setRedmineApiKey(e.target.value)}
                          iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                        />
                      </div>

                      <div>
                        <div style={{ marginBottom: "6px", fontWeight: 500 }}>Project mặc định:</div>
                        <Input
                          placeholder="Nhập ID/Key dự án mặc định (ví dụ: logtime-project)"
                          value={redmineDefaultProject}
                          onChange={(e) => setRedmineDefaultProject(e.target.value)}
                        />
                        <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
                          Dùng làm fallback nếu công việc không có mã Issue trên Redmine.
                        </Text>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {activeModule === "spent_time" && (
              <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div>
                    <Typography.Title level={4} style={{ margin: 0, fontFamily: "Lora, serif", color: "var(--text-primary)" }}>
                      Lịch sử ghi nhận công việc (Spent Time)
                    </Typography.Title>
                    <Typography.Text type="secondary" style={{ fontSize: "14px" }}>
                      Xem tất cả thời gian đã báo cáo lên Redmine (người dùng hiện tại)
                    </Typography.Text>
                  </div>
                  <Space>
                    <Select
                      value={spentTimeFilter}
                      onChange={(val) => {
                        setSpentTimeFilter(val);
                        setSpentTimePage(1); // Reset page to 1
                      }}
                      style={{ width: 150 }}
                      options={[
                        { value: "all", label: "Tất cả thời gian" },
                        { value: "this_month", label: "Tháng này" },
                        { value: "last_month", label: "Tháng trước" },
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
                      return (
                        <Tag color="default" style={{ fontSize: "14px", padding: "6px 12px", borderRadius: "6px", background: "var(--card-bg)", borderColor: "var(--glass-border)", color: "var(--text-primary)", fontWeight: 500 }}>
                          Tổng cộng: <strong>{totalHours.toFixed(1)} giờ</strong>
                        </Tag>
                      );
                    })()}
                    <Button 
                      type="default" 
                      icon={<ClockCircleOutlined />} 
                      onClick={handleFetchSpentTime}
                      loading={isLoadingSpentTime}
                      style={{ borderRadius: "6px", background: "var(--card-bg)", borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                    >
                      Làm mới
                    </Button>
                  </Space>
                </div>

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
                      <Card className="glass-panel" style={{ textAlign: "center", padding: "40px" }}>
                        <Empty description="Không tìm thấy lịch sử báo cáo thời gian phù hợp với bộ lọc" />
                      </Card>
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
                        const totalDailyHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
                        const dayOfWeek = dayjs(date).day(); // 0: Chủ Nhật, 6: Thứ Bảy
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                        let cardStyle: React.CSSProperties = { 
                          borderRadius: "12px", 
                          border: "1px solid var(--glass-border)",
                          transition: "all 0.3s",
                          height: "100%"
                        };
                        let headerStyle: React.CSSProperties = { 
                          borderBottom: "1px solid var(--glass-border)", 
                          padding: "10px 16px" 
                        };
                        let titleColor = "var(--text-primary)";
                        let tagStyle: React.CSSProperties = {
                          background: "rgba(94, 93, 89, 0.1)", 
                          color: "var(--primary-color)", 
                          border: "none", 
                          fontWeight: 600, 
                          fontSize: "12px", 
                          padding: "2px 8px", 
                          borderRadius: "10px"
                        };
                        let tagText = `${totalDailyHours.toFixed(1)} giờ`;

                        if (isWeekend) {
                          cardStyle = {
                            ...cardStyle,
                            background: "rgba(94, 93, 89, 0.03)",
                            opacity: 0.85
                          };
                          titleColor = "var(--text-secondary)";
                          tagStyle = {
                            ...tagStyle,
                            background: "rgba(94, 93, 89, 0.08)",
                            color: "var(--text-secondary)",
                          };
                          tagText = "Nghỉ";
                        } else if (totalDailyHours === 0) {
                          // Weekday not logged
                          if (themeMode === "dark") {
                            cardStyle = {
                              ...cardStyle,
                              border: "1px solid rgba(220, 38, 38, 0.4)",
                              background: "rgba(220, 38, 38, 0.08)",
                            };
                            headerStyle = { ...headerStyle, borderBottom: "1px solid rgba(220, 38, 38, 0.25)" };
                            titleColor = "#fca5a5";
                            tagStyle = { ...tagStyle, background: "rgba(220, 38, 38, 0.2)", color: "#fca5a5" };
                          } else {
                            cardStyle = {
                              ...cardStyle,
                              border: "1px solid #feb2b2",
                              background: "#fff5f5",
                            };
                            headerStyle = { ...headerStyle, borderBottom: "1px solid #fed7d7" };
                            titleColor = "#991b1b";
                            tagStyle = { ...tagStyle, background: "#fee2e2", color: "#c53030" };
                          }
                          tagText = "Chưa log";
                        }

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
                              className="glass-panel"
                              size="small"
                              style={cardStyle}
                              title={
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                                  <span style={{ fontWeight: 600, fontSize: "13px", color: titleColor }}>
                                    {formatVietnameseDate(date)}
                                  </span>
                                  <Tag style={tagStyle}>
                                    {tagText}
                                  </Tag>
                                </div>
                              }
                              headStyle={headerStyle}
                              bodyStyle={{ padding: "12px 16px" }}
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
                              <div style={{ minHeight: "180px", maxHeight: "250px", overflowY: "auto", marginBottom: "16px" }}>
                                {isWeekend ? (
                                  <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-secondary)", fontSize: "13px" }}>
                                    <ClockCircleOutlined style={{ marginRight: "6px" }} />
                                    Cuối tuần - Không yêu cầu log time
                                  </div>
                                ) : entries.length === 0 ? (
                                  <div style={{ textAlign: "center", padding: "30px 0" }}>
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: "12px" }}>Không có task</span>} />
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    {entries.map((entry: any, index: number) => (
                                      <div
                                        key={entry.id || index}
                                        style={{
                                          padding: "8px",
                                          background: themeMode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)",
                                          border: "1px solid var(--glass-border)",
                                          borderRadius: "8px",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "4px"
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                          <Tag style={{ background: "rgba(0,0,0,0.05)", border: "none", color: "var(--text-secondary)", fontSize: "11px", fontWeight: 500, margin: 0 }}>
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
                                            <Tag style={{ background: "rgba(94,93,89,0.05)", border: "1px solid var(--glass-border)", color: "var(--text-secondary)", fontSize: "11px", margin: 0 }}>
                                              {entry.activity.name}
                                            </Tag>
                                          )}
                                        </div>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                          <div style={{ color: "var(--text-primary)", fontSize: "12px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {entry.comments || <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>(Không có ghi chú)</span>}
                                          </div>
                                          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                                            {entry.hours}h
                                          </span>
                                        </div>
                                      </div>
                                    ))}
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
                            style={{ color: "var(--text-primary)" }}
                          />
                        </div>
                      </Col>
                    </Row>
                  );
                })()}
              </div>
            )}

          </Content>

          <Footer style={{ textAlign: "center", color: "var(--text-secondary)", background: "transparent", borderTop: "1px solid var(--glass-border)", padding: "20px" }}>
            AI LogTime Assistant ©2026 Created by Antigravity
          </Footer>
        </Layout>

        {/* Modal Xác thực Ánh xạ Đơn lẻ */}
        <Modal
          title={
            <span style={{ fontSize: "16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <RobotOutlined style={{ color: "var(--primary-color)" }} />
              Duyệt thủ công ánh xạ Redmine
            </span>
          }
          open={isMappingModalOpen}
          onOk={handleConfirmMapping}
          onCancel={() => {
            setIsMappingModalOpen(false);
            setMappingTask(null);
          }}
          okText="Xác nhận & Áp dụng"
          cancelText="Hủy"
          width={800}
          confirmLoading={isSyncingRedmine}
        >
          {isAiLoading ? (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Badge status="processing" color="var(--primary-color)" />
              <div style={{ marginTop: "12px", color: "var(--text-secondary)" }}>AI đang phân tích task và tìm kiếm issue phù hợp trên Redmine...</div>
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
                      Không có kết quả tìm kiếm. Hãy gõ từ khóa và bấm Tìm.
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
                              Gán trực tiếp
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
                              Gán làm cha
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

        {/* Modal Ánh xạ Hàng loạt */}
        <Modal
          title={
            <span style={{ fontSize: "16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <RobotOutlined style={{ color: "var(--primary-color)" }} />
              Duyệt thủ công ánh xạ hàng loạt bằng AI
            </span>
          }
          open={isBulkMappingModalOpen}
          onOk={handleConfirmBulkMapping}
          onCancel={() => {
            setIsBulkMappingModalOpen(false);
            setBulkMappingSuggestions([]);
          }}
          okText="Áp dụng ánh xạ hàng loạt"
          cancelText="Hủy"
          width={900}
          confirmLoading={isSyncingRedmine}
        >
          {isBulkMappingLoading ? (
            <div style={{ padding: "50px 0", textAlign: "center" }}>
              <Badge status="processing" color="var(--primary-color)" />
              <div style={{ marginTop: "12px", color: "var(--text-secondary)" }}>AI đang trích xuất từ khóa, tìm kiếm và phân tích ánh xạ hàng loạt... Vui lòng đợi.</div>
            </div>
          ) : (
            <div style={{ margin: "16px 0" }}>
              <div style={{ marginBottom: "12px", color: "var(--text-secondary)", fontSize: "13px" }}>
                AI đã tự động phân tích và tìm kiếm các issue phù hợp trên Redmine cho tất cả task chưa được ánh xạ ngày hôm nay. Hãy duyệt lại, chọn loại ánh xạ hoặc tinh chỉnh mã ID trước khi áp dụng.
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

              <div style={{ marginTop: "16px", borderTop: "1px solid var(--glass-border)", paddingTop: "16px" }}>
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ marginBottom: "6px", fontWeight: 500 }}>Redmine API Key:</div>
                  <Input.Password
                    placeholder="Nhập Redmine API Token"
                    value={redmineApiKey}
                    onChange={(e) => setRedmineApiKey(e.target.value)}
                    iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: "6px", fontWeight: 500 }}>Project mặc định:</div>
                  <Input
                    placeholder="Nhập ID/Key dự án mặc định (ví dụ: logtime-project)"
                    value={redmineDefaultProject}
                    onChange={(e) => setRedmineDefaultProject(e.target.value)}
                  />
                  <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
                    Dùng làm fallback nếu công việc không có Mã Issue.
                  </Text>
                </div>
              </div>
            </div>
          )}
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}
