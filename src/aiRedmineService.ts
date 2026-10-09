import { chatJson, type AiConfig } from "./aiClient";

export interface RedmineMatchSuggestion {
  type: "direct" | "subtask" | "none";
  issueId?: number;
  issueSubject?: string;
  projectId?: number | string;
  projectName?: string;
  parentIssueId?: number;
  parentIssueSubject?: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Phân tích danh sách issue tiềm năng để gợi ý khớp trực tiếp hoặc làm subtask.
 */
export async function analyzeRedmineMapping(
  taskName: string,
  candidates: any[],
  ai: AiConfig
): Promise<RedmineMatchSuggestion> {
  const systemPrompt = `Bạn là một chuyên gia phân tích công việc Redmine và hỗ trợ quản lý dự án.
Nhiệm vụ của bạn là nhận tên công việc hiện tại (\`taskName\`) và danh sách các Issue (\`candidates\`) hiện có từ Redmine.
Hãy phân tích xem công việc này có khớp trực tiếp với một Issue nào đó không, hoặc nếu không khớp trực tiếp thì có nên tạo một Subtask (con) dưới một Issue cha (Parent task) nào đó không.

Nguyên tắc phân tích:
1. **Direct Match (Khớp trực tiếp)**: Nếu tên công việc và một issue trong danh sách candidates có ý nghĩa trùng khớp hoàn toàn hoặc gần như giống hệt nhau (ví dụ: "fix bug login" và "Sửa lỗi đăng nhập"), hãy chọn issue đó.
2. **Subtask Match (Khớp làm subtask)**: Nếu công việc là một phần nhỏ hơn, một hành động con (ví dụ: "Viết API cho module X", "Vẽ giao diện module X") nằm dưới một Issue lớn hơn hoặc Epic/Task Group trong danh sách candidates (ví dụ: "Module X", "Phát triển tính năng X"), hãy gợi ý tạo một subtask dưới issue cha này.
3. **Chỉ log vào task lá**: Nếu một issue là cha của issue khác trong danh sách (có issue khác mang \`parentId\` trỏ tới nó), không chọn nó làm Direct Match — hãy chọn task con phù hợp, hoặc gợi ý Subtask dưới nó.
4. **None (Không khớp)**: Nếu không tìm thấy bất kỳ issue nào liên quan để làm cha hoặc khớp trực tiếp, trả về type: "none".

Hãy trả về kết quả dưới định dạng JSON với cấu trúc sau:
\`\`\`json
{
  "type": "direct" | "subtask" | "none",
  "issueId": 1234, // ID của issue khớp trực tiếp (nếu type là direct)
  "issueSubject": "Tên issue khớp trực tiếp", // (nếu type là direct)
  "projectId": 98, // ID dự án của issue đó
  "projectName": "Tên dự án",
  "parentIssueId": 5678, // ID của issue cha (nếu type là subtask)
  "parentIssueSubject": "Tên issue cha", // (nếu type là subtask)
  "confidence": "high" | "medium" | "low",
  "reason": "Giải thích ngắn gọn bằng tiếng Việt tại sao bạn gợi ý lựa chọn này."
}
\`\`\`

Lưu ý: Chỉ trả về JSON hợp lệ, không viết thêm text gì ngoài JSON đó.`;

  const resultText = await chatJson(ai, [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Tên công việc: "${taskName}"\nDanh sách các Issue ứng viên:\n${JSON.stringify(
        candidates.map((issue) => ({
          id: issue.id,
          subject: issue.subject,
          project: issue.project,
          tracker: issue.tracker,
          status: issue.status,
          parentId: issue.parent?.id,
        }))
      )}`,
    },
  ]);
  try {
    return JSON.parse(resultText) as RedmineMatchSuggestion;
  } catch (error) {
    console.error("Lỗi parse suggestion từ AI:", error, resultText);
    return {
      type: "none",
      confidence: "low",
      reason: "Không thể phân tích dữ liệu trả về từ AI.",
    };
  }
}

/**
 * Trích xuất từ khóa tìm kiếm từ tên công việc để tìm kiếm rộng trên Redmine.
 */
export async function extractSearchQuery(
  taskName: string,
  ai: AiConfig
): Promise<string> {
  const systemPrompt = `Nhiệm vụ của bạn là trích xuất 1 đến 3 từ khóa tiếng Việt hoặc tiếng Anh cốt lõi từ tiêu đề công việc thô để dùng làm từ khóa tìm kiếm (search query) trên Redmine.
Từ khóa phải mô tả chủ đề chính của công việc (ví dụ: "BE - Thông báo vào google chat khi số lượng voucher sắp hết" -> "voucher" hoặc "thông báo google chat").
Không giữ lại các tiền tố như "BE -", "FE -", "Fix bug -", "Hotfix:".

Trả về JSON định dạng:
\`\`\`json
{
  "query": "từ khóa tìm kiếm"
}
\`\`\`
Chỉ trả về JSON.`;

  try {
    const resultText = await chatJson(ai, [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Tiêu đề: "${taskName}"` },
    ]);
    const data = JSON.parse(resultText);
    return data.query || taskName;
  } catch (e) {
    console.error("Lỗi trích xuất từ khóa:", e);
    return taskName;
  }
}
