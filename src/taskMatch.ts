// So khớp tên công việc với tên task Redmine (bỏ dấu tiếng Việt, so theo từ).
const normalizeWords = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

export const MATCH_THRESHOLD = 0.6;

/**
 * Chọn issue khớp rõ nhất với tên công việc: cần ≥ 60% từ của tên công việc có trong tên issue,
 * và phải là duy nhất (hai issue khớp ngang nhau thì không chọn).
 */
export function matchTaskByName(taskName: string, issues: any[]): any | undefined {
  const words = normalizeWords(taskName);
  if (words.length === 0 || issues.length === 0) return undefined;
  const scored = issues
    .map((issue) => {
      const issueWords = new Set(normalizeWords(issue.subject || ""));
      const hits = words.filter((w) => issueWords.has(w)).length;
      return { issue, score: hits / words.length };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best.score < MATCH_THRESHOLD) return undefined;
  if (second && second.score === best.score) return undefined;
  return best.issue;
}
