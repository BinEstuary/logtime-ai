import { chatJson, type AiConfig } from "./aiClient";

export interface Task {
  id: string;
  name: string;
  importance: "high" | "medium" | "low";
  category: string;
  duration: number; // in hours
  isLocked: boolean; // if true, AI must keep the duration
  aiReason?: string;
  redmineIssue?: number; // Mã Issue trên Redmine
  redmineProject?: string; // Tên/ID dự án trên Redmine
  isRecurring?: boolean; // Tự động lặp lại mỗi tuần
  loggedAt?: string; // Đã log thành công lên Redmine (ISO time) — không log lại
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Phân bổ thời gian cho danh sách task sao cho tổng bằng 8.0 giờ.
 */
export async function distributeTasksWithAI(
  tasks: Task[],
  ai: AiConfig
): Promise<{ tasks: Task[]; explanation: string }> {
  const systemPrompt = `Bạn là một trợ lý AI quản lý công việc và logtime chuyên nghiệp. 
Nhiệm vụ của bạn là nhận danh sách các task làm việc và phân bổ thời gian (duration) bằng giờ cho mỗi task sao cho:
1. Tổng số giờ của tất cả các task phải đạt CHÍNH XÁC 8.0 giờ (không được thừa, không được thiếu, ví dụ: 1.5 + 2.0 + 0.5 + 4.0 = 8.0).
2. Các task có thuộc tính \`isLocked: true\` PHẢI giữ nguyên số giờ (\`duration\`) ban đầu không được thay đổi.
3. Phân bổ phần giờ còn lại cho các task chưa khóa (\`isLocked: false\`) dựa trên độ quan trọng (\`importance\` gồm high, medium, low) và tính chất công việc thể hiện qua tên task.
   - \`high\`: được ưu tiên nhiều thời gian hơn.
   - \`medium\`: thời gian trung bình.
   - \`low\`: thời gian ít hơn.
4. Gán một phân loại hợp lý (\`category\`) cho từng task, ví dụ: "Coding", "Meeting", "Review", "Research", "Documentation", "Other".
5. Giải thích lý do phân bổ ngắn gọn bằng tiếng Việt (\`aiReason\`).

Hãy trả về kết quả dưới định dạng JSON là một đối tượng chứa:
1. \`tasks\`: Danh sách các task đã được cập nhật duration, category và aiReason. Giữ nguyên id của từng task.
2. \`explanation\`: Một đoạn văn ngắn gọn (2-3 câu) tóm tắt cách phân bổ thời gian hôm nay và lời khuyên làm việc.

ĐỊNH DẠNG JSON YÊU CẦU:
\`\`\`json
{
  "tasks": [
    {
      "id": "1",
      "duration": 1.5,
      "category": "Coding",
      "aiReason": "Task quan trọng cao, cần tập trung giải quyết bug."
    }
  ],
  "explanation": "Tóm tắt tổng quan..."
}
\`\`\`

Lưu ý: Chỉ trả về JSON hợp lệ, không viết thêm text gì ngoài JSON đó.`;

  const userContent = JSON.stringify(
    tasks.map((t) => ({
      id: t.id,
      name: t.name,
      importance: t.importance,
      duration: t.duration,
      isLocked: t.isLocked,
    }))
  );

  const resultText = await chatJson(ai, [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Hãy phân bổ danh sách task sau: ${userContent}` },
  ]);
  try {
    const data = JSON.parse(resultText);
    const updatedTasks = tasks.map((originalTask) => {
      const match = data.tasks.find((t: any) => t.id === originalTask.id);
      if (match) {
        return {
          ...originalTask,
          duration: match.duration,
          category: match.category || originalTask.category || "Other",
          aiReason: match.aiReason || "",
        };
      }
      return originalTask;
    });

    return {
      tasks: updatedTasks,
      explanation: data.explanation || "Đã phân bổ thời gian thành công.",
    };
  } catch (error) {
    console.error("Lỗi parse JSON từ AI:", error, resultText);
    throw new Error("Không thể phân tích kết quả từ AI. Vui lòng thử lại.");
  }
}

/**
 * Xử lý hội thoại chat và cập nhật phân bổ thời gian dựa trên yêu cầu của người dùng.
 */
export async function adjustTasksWithChat(
  tasks: Task[],
  message: string,
  chatHistory: ChatMessage[],
  ai: AiConfig
): Promise<{ tasks: Task[]; aiMessage: string }> {
  const systemPrompt = `Bạn là một trợ lý AI quản lý công việc và logtime chuyên nghiệp.
Người dùng đang có danh sách task đã được phân bổ giờ như sau:
${JSON.stringify(
  tasks.map((t) => ({
    id: t.id,
    name: t.name,
    importance: t.importance,
    duration: t.duration,
    category: t.category,
    isLocked: t.isLocked,
  }))
)}

Yêu cầu cực kỳ quan trọng:
1. Tổng số giờ của tất cả các task sau khi điều chỉnh PHẢI đạt CHÍNH XÁC 8.0 giờ.
2. Các task có \`isLocked: true\` PHẢI được giữ nguyên số giờ ngoại trừ trường hợp người dùng chỉ định thay đổi trực tiếp chính task đó trong tin nhắn.
3. Khi người dùng yêu cầu thay đổi (ví dụ: tăng task A lên 1 tiếng, giảm task B xuống, hoặc thêm task mới), bạn phải điều chỉnh phân bổ giờ các task còn lại để bù trừ sao cho tổng luôn bằng 8.0 giờ.
4. Trả về câu trả lời dưới định dạng JSON chứa hai trường:
   - \`tasks\`: Danh sách toàn bộ các task (bao gồm các task cũ và có thể có task mới nếu người dùng yêu cầu thêm task) với duration đã cập nhật phù hợp. Giữ nguyên id của các task cũ.
   - \`aiMessage\`: Phản hồi của bạn bằng tiếng Việt thân thiện, giải thích bạn đã điều chỉnh những gì và tại sao, tổng số giờ hiện tại là bao nhiêu.

ĐỊNH DẠNG JSON YÊU CẦU:
\`\`\`json
{
  "tasks": [
    {
      "id": "1",
      "name": "Task A",
      "importance": "high",
      "duration": 2.5,
      "category": "Coding",
      "isLocked": false,
      "aiReason": "Lý do cập nhật..."
    }
  ],
  "aiMessage": "Chào bạn, mình đã tăng thời gian task A lên..."
}
\`\`\`

Lưu ý: Chỉ trả về JSON hợp lệ, không viết thêm text gì ngoài JSON đó.`;

  // Lọc lịch sử chat để tránh quá tải token và chỉ lấy các tin nhắn liên quan
  const formattedHistory = chatHistory.slice(-6).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...formattedHistory,
    { role: "user", content: message },
  ];

  const resultText = await chatJson(ai, messages as any);
  try {
    const data = JSON.parse(resultText);
    
    // Nếu AI trả về danh sách task mới, ta map lại hoặc dùng luôn danh sách của AI
    const rawAiTasks = data.tasks || [];
    
    // Đảm bảo các thuộc tính được giữ đầy đủ
    const updatedTasks: Task[] = rawAiTasks.map((t: any) => ({
      id: t.id || Math.random().toString(36).substring(2, 9),
      name: t.name || "",
      importance: t.importance || "medium",
      duration: Number(t.duration) || 0,
      category: t.category || "Other",
      isLocked: !!t.isLocked,
      aiReason: t.aiReason || "",
    }));

    return {
      tasks: updatedTasks,
      aiMessage: data.aiMessage || "Đã điều chỉnh lịch trình theo yêu cầu.",
    };
  } catch (error) {
    console.error("Lỗi parse JSON từ AI Chat:", error, resultText);
    throw new Error("Không thể xử lý yêu cầu chat của bạn. Vui lòng thử lại.");
  }
}

/**
 * Phân tích danh sách công việc thô bằng văn bản (gồm ngày tháng và các dòng công việc) và phân bổ 8 giờ.
 */
export async function parseRawTasksWithAI(
  rawText: string,
  ai: AiConfig
): Promise<{ date: string; tasks: Task[]; explanation: string }> {
  const systemPrompt = `Bạn là một trợ lý AI quản lý công việc và logtime chuyên nghiệp.
Nhiệm vụ của bạn là phân tích một đoạn văn bản thô do người dùng nhập vào. Đoạn văn bản này thường bao gồm ngày tháng làm việc và danh sách các đầu mục công việc (tasks).

Hãy thực hiện các yêu cầu sau:
1. Xác định ngày làm việc được nhắc tới trong văn bản (ví dụ: "Ngày 4 tháng 5 năm 2026" -> "2026-05-04"). Định dạng ngày trả về PHẢI là "YYYY-MM-DD" (múi giờ mặc định là năm 2026 nếu không ghi rõ năm). Nếu hoàn toàn không phát hiện được ngày nào, hãy lấy ngày hiện tại (2026-05-20).
2. Trích xuất danh sách công việc (tasks).
3. Phân loại danh mục (category) cho từng task (ví dụ: "Coding", "Meeting", "Review", "Research", "Documentation", "Other").
4. Đánh giá độ quan trọng (importance) dựa vào ngữ cảnh tên task (ví dụ: fix bug nghiêm trọng -> high, standup -> low).
5. Phân bổ thời gian (duration) bằng giờ cho từng task sao cho tổng thời gian của tất cả các task bằng CHÍNH XÁC 8.0 giờ.
6. Đưa ra lý do phân bổ ngắn gọn bằng tiếng Việt (\`aiReason\`).
7. Trả về kết quả dưới định dạng JSON có cấu trúc như sau:

\`\`\`json
{
  "date": "2026-05-04",
  "tasks": [
    {
      "id": "t1",
      "name": "Kiểm tra khảo sát ML",
      "importance": "medium",
      "category": "Research",
      "duration": 2.0,
      "isLocked": false,
      "aiReason": "Nghiên cứu khảo sát ML cần thời gian đọc và phân tích tài liệu."
    }
  ],
  "explanation": "Tóm tắt phân bổ hôm nay..."
}
\`\`\`

Lưu ý: Chỉ trả về JSON hợp lệ, không viết thêm text gì ngoài JSON đó.`;

  const resultText = await chatJson(ai, [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Hãy phân tích văn bản sau:\n${rawText}` },
  ]);
  try {
    const data = JSON.parse(resultText);
    const rawTasks = data.tasks || [];
    const formattedTasks: Task[] = rawTasks.map((t: any) => ({
      id: t.id || Math.random().toString(36).substring(2, 9),
      name: t.name || "Công việc không tên",
      importance: t.importance || "medium",
      category: t.category || "Other",
      duration: Number(t.duration) || 0,
      isLocked: !!t.isLocked,
      aiReason: t.aiReason || "",
    }));

    return {
      date: data.date || "2026-05-20",
      tasks: formattedTasks,
      explanation: data.explanation || "Đã phân tích và phân bổ thời gian thành công.",
    };
  } catch (error) {
    console.error("Lỗi parse JSON từ AI parseRawTasks:", error, resultText);
    throw new Error("Không thể phân tích văn bản này. Vui lòng thử nhập đúng định dạng hoặc phân bổ thủ công.");
  }
}

/**
 * Phân bổ thời gian cho tất cả các ngày trong tuần, mỗi ngày độc lập bằng đúng 8.0 giờ.
 */
export async function distributeWeekTasksWithAI(
  weeklyTasks: { [date: string]: Task[] },
  ai: AiConfig
): Promise<{ weeklyTasks: { [date: string]: Task[] }; explanation: string }> {
  const systemPrompt = `Bạn là một trợ lý AI quản lý logtime và công việc tuần chuyên nghiệp.
Nhiệm vụ của bạn là nhận dữ liệu công việc của nhiều ngày trong tuần (được gom theo từng ngày YYYY-MM-DD) và phân bổ thời gian cho từng ngày độc lập sao cho:
1. Đối với MỖI ngày, tổng số giờ của tất cả các task của ngày đó phải đạt CHÍNH XÁC 8.0 giờ (không được thừa, không được thiếu). Nếu một ngày không có task nào, hãy bỏ qua hoặc gán 0 giờ cho ngày đó.
2. Các task có thuộc tính \`isLocked: true\` PHẢI giữ nguyên số giờ (\`duration\`) ban đầu không được thay đổi.
3. Phân bổ phần giờ còn lại cho các task chưa khóa (\`isLocked: false\`) dựa trên độ quan trọng (\`importance\` gồm high, medium, low) và tính chất công việc thể hiện qua tên task.
4. Gán phân loại hợp lý (\`category\`) và ghi chú giải thích lý do ngắn gọn bằng tiếng Việt (\`aiReason\`).
5. Trả về kết quả dưới định dạng JSON là một đối tượng chứa:
   - \`weeklyTasks\`: Một đối tượng map ngày (YYYY-MM-DD) tới danh sách các task của ngày đó đã được cập nhật thời gian.
   - \`explanation\`: Một đoạn văn ngắn gọn (3-4 câu) nhận xét tổng quan về tiến độ và phân bổ công việc cả tuần của người dùng.

ĐỊNH DẠNG JSON YÊU CẦU:
\`\`\`json
{
  "weeklyTasks": {
    "2026-05-04": [
      {
        "id": "task-id",
        "duration": 2.5,
        "category": "Coding",
        "aiReason": "Lý do phân bổ..."
      }
    ]
  },
  "explanation": "Tóm tắt cả tuần..."
}
\`\`\`

Lưu ý: Chỉ trả về JSON hợp lệ, không viết thêm text gì ngoài JSON đó.`;

  // Rút gọn thông tin truyền đi để tiết kiệm token
  const inputPayload: { [date: string]: any[] } = {};
  for (const date of Object.keys(weeklyTasks)) {
    inputPayload[date] = weeklyTasks[date].map((t) => ({
      id: t.id,
      name: t.name,
      importance: t.importance,
      duration: t.duration,
      isLocked: t.isLocked,
    }));
  }

  const resultText = await chatJson(ai, [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Hãy phân bổ danh sách task tuần sau:\n${JSON.stringify(inputPayload)}` },
  ]);
  try {
    const data = JSON.parse(resultText);
    const resultWeeklyTasks = data.weeklyTasks || {};
    
    const updatedWeeklyTasks: { [date: string]: Task[] } = {};
    for (const date of Object.keys(weeklyTasks)) {
      const originalTasks = weeklyTasks[date] || [];
      const aiTasks = resultWeeklyTasks[date] || [];
      
      updatedWeeklyTasks[date] = originalTasks.map((originalTask) => {
        const match = aiTasks.find((t: any) => t.id === originalTask.id);
        if (match) {
          return {
            ...originalTask,
            duration: Number(match.duration) || 0,
            category: match.category || originalTask.category || "Other",
            aiReason: match.aiReason || "",
          };
        }
        return originalTask;
      });
    }

    return {
      weeklyTasks: updatedWeeklyTasks,
      explanation: data.explanation || "Đã phân bổ thời gian tuần thành công.",
    };
  } catch (error) {
    console.error("Lỗi parse JSON từ AI phân bổ tuần:", error, resultText);
    throw new Error("Không thể phân bổ thời gian cho tuần. Vui lòng kiểm tra lại dữ liệu đầu vào.");
  }
}

/**
 * Tạo tóm tắt AI cho tuần làm việc.
 */
export async function generateWeeklySummaryWithAI(
  weeklyTasks: { [date: string]: Task[] },
  spentTimeEntries: any[],
  ai: AiConfig
): Promise<{ summary: string }> {
  // Tính tổng giờ từng ngày
  const dayStats: { date: string; planned: number; logged: number; tasks: string[] }[] = [];
  for (const date of Object.keys(weeklyTasks).sort()) {
    const tasks = weeklyTasks[date] || [];
    const planned = tasks.reduce((s, t) => s + (t.duration || 0), 0);
    const logged = spentTimeEntries
      .filter((e: any) => e.spent_on === date)
      .reduce((s: number, e: any) => s + (e.hours || 0), 0);
    dayStats.push({ date, planned, logged, tasks: tasks.map(t => t.name) });
  }

  const systemPrompt = `Bạn là trợ lý AI phân tích hiệu suất làm việc hàng tuần. 
Hãy viết một bản tóm tắt tuần làm việc ngắn gọn, thân thiện bằng tiếng Việt với các phần:
1. 📊 Tổng quan tuần (tổng giờ kế hoạch, tổng giờ đã log, % hoàn thành)
2. ✅ Điểm mạnh (những ngày làm tốt, tasks hoàn thành)
3. ⚠️ Điểm cần cải thiện (ngày thiếu giờ, task chưa log)
4. 💡 Đề xuất tuần tới (3 gợi ý cụ thể)

Chỉ trả về JSON với trường "summary" là chuỗi markdown.`;

  const userContent = `Dữ liệu tuần:\n${JSON.stringify(dayStats, null, 2)}`;

  const resultText = (await chatJson(ai, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ])) || "{}";
  try {
    const data = JSON.parse(resultText);
    return { summary: data.summary || "Không thể tạo tóm tắt." };
  } catch {
    return { summary: "Không thể tạo tóm tắt tuần. Vui lòng thử lại." };
  }
}

export interface DayActivityTaskSuggestion {
  name: string;
  hours: number;
  evidence: string;
}

export interface DayActivityProjectSummary {
  workspace: string;
  redmineProjectGuess?: string;
  minutes: number;
  tasks: DayActivityTaskSuggestion[];
}

export interface DayActivitySummary {
  overview: string;
  projects: DayActivityProjectSummary[];
}

/**
 * Tóm tắt hoạt động trong ngày (lịch sử AI agent + thời gian dùng máy) theo dự án và gợi ý task để log.
 */
export async function summarizeDayActivityWithAI(
  input: {
    date: string;
    agentHistory: any;
    activity: any;
    loggedEntries: { project?: string; issue?: number; hours: number; comments: string }[];
    plannedTasks: string[];
    knownRedmineProjects: string[];
  },
  ai: AiConfig
): Promise<DayActivitySummary> {
  const loggedHours = input.loggedEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const activeHours = (input.activity?.activeMinutes || 0) / 60;
  const budget = Math.max(0, Math.min(8 - loggedHours, activeHours > 0 ? activeHours : 8));

  const systemPrompt = `Bạn là trợ lý tổng hợp hoạt động làm việc trong ngày để log time lên Redmine.
Dữ liệu gồm: lịch sử làm việc với AI agent (Claude Code: prompt theo thư mục project; Antigravity: hội thoại theo workspace),
thời gian dùng máy (activeMinutes, timeline, app/cửa sổ nếu có), các entry đã log và các task đã có trong kế hoạch.

Hãy:
1. Gom hoạt động theo dự án (workspace/thư mục). Bỏ qua hoạt động vặt, không liên quan công việc.
2. Với mỗi dự án, gợi ý 1-4 task, đặt tên ngắn gọn theo kiểu tiêu đề task Redmine bằng tiếng Việt (ví dụ "Xây dựng màn hình xác nhận log time"), kèm "evidence" là bằng chứng ngắn từ dữ liệu.
3. Số giờ mỗi task là bội số của 0.5, tối thiểu 0.5. TỔNG giờ gợi ý KHÔNG vượt quá ${budget.toFixed(1)}h (8h trừ giờ đã log, và không vượt thời gian thực sự dùng máy).
4. KHÔNG gợi ý lại việc đã log hoặc đã có trong kế hoạch.
5. "redmineProjectGuess": nếu đoán được dự án Redmine tương ứng thì chọn đúng tên trong danh sách dự án Redmine được cung cấp, nếu không chắc thì bỏ trống.
6. "overview": 2-4 câu tiếng Việt tóm tắt ngày làm việc.

Chỉ trả về JSON:
{"overview": "...", "projects": [{"workspace": "logtime", "redmineProjectGuess": "...", "minutes": 120, "tasks": [{"name": "...", "hours": 1.5, "evidence": "..."}]}]}`;

  const resultText =
    (await chatJson(ai, [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(input) },
    ])) || "{}";
  try {
    const data = JSON.parse(resultText);
    const projects: DayActivityProjectSummary[] = (Array.isArray(data.projects) ? data.projects : []).map((p: any) => ({
      workspace: String(p.workspace || "Khác"),
      redmineProjectGuess: p.redmineProjectGuess || undefined,
      minutes: Number(p.minutes) || 0,
      tasks: (Array.isArray(p.tasks) ? p.tasks : [])
        .filter((t: any) => t && t.name)
        .map((t: any) => ({
          name: String(t.name),
          hours: Math.max(0.5, Math.round((Number(t.hours) || 0.5) * 2) / 2),
          evidence: String(t.evidence || ""),
        })),
    }));
    return { overview: String(data.overview || ""), projects };
  } catch {
    return { overview: "Không thể phân tích kết quả AI. Vui lòng thử lại.", projects: [] };
  }
}
