// Lưu kết quả tóm tắt hoạt động theo ngày (localStorage) để hiển thị lại trên thẻ ngày và tạo task sau.
import type { Task } from "./aiService";

export interface SummaryRow {
  key: string;
  workspace: string;
  name: string;
  hours: number;
  evidence: string;
  redmineProject?: string;
  /** Task (issue) cụ thể của dự án, có thể là task con */
  redmineIssue?: number;
  /** Đã thêm thành task trong kế hoạch của ngày */
  added?: boolean;
}

export interface StoredDaySummary {
  date: string;
  overview: string;
  createdAt: string;
  rows: SummaryRow[];
}

const storageKey = (date: string) => `logtime_activity_summary_${date}`;

export function loadDaySummary(date: string): StoredDaySummary | null {
  try {
    const raw = localStorage.getItem(storageKey(date));
    return raw ? (JSON.parse(raw) as StoredDaySummary) : null;
  } catch {
    return null;
  }
}

export function saveDaySummary(summary: StoredDaySummary | null, date: string) {
  try {
    if (summary) localStorage.setItem(storageKey(date), JSON.stringify(summary));
    else localStorage.removeItem(storageKey(date));
  } catch {
    /* localStorage không khả dụng */
  }
}

export function summaryRowToTask(row: SummaryRow): Task {
  return {
    id: Math.random().toString(36).substring(2, 9),
    name: row.name.trim(),
    importance: "medium",
    category: "Coding",
    duration: row.hours,
    isLocked: true,
    aiReason: `Tóm tắt hoạt động (${row.workspace}): ${row.evidence}`,
    redmineProject: row.redmineProject,
    redmineIssue: row.redmineIssue,
  };
}
