// Tiền tố đặt trước tên task khi tạo task con trên Redmine, ví dụ "BE -" → "BE - Cập nhật API".
export const TASK_PREFIX_KEY = "logtime_task_prefix";

export function loadTaskPrefix(): string {
  try {
    return localStorage.getItem(TASK_PREFIX_KEY) || "";
  } catch {
    return "";
  }
}

export function saveTaskPrefix(prefix: string) {
  try {
    localStorage.setItem(TASK_PREFIX_KEY, prefix);
  } catch {
    /* localStorage không khả dụng */
  }
}

/** Ghép tiền tố vào tên task, luôn có đúng một dấu cách giữa tiền tố và tên; không ghép lặp nếu đã có sẵn */
export function applyTaskPrefix(prefix: string, name: string): string {
  const trimmedName = name.trim();
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) return trimmedName;
  if (trimmedName.startsWith(`${trimmedPrefix} `)) return trimmedName;
  return `${trimmedPrefix} ${trimmedName}`;
}
