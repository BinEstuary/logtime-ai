import OpenAI from "openai";

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
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEFAULT_API_KEY = "";
const BASE_URL = window.location.origin + "/api-z"; // Using Vite proxy to avoid CORS
const MODEL_NAME = "glm-4.7-flash";

function getOpenAIClient(customApiKey?: string) {
  const apiKey = customApiKey || DEFAULT_API_KEY;
  return new OpenAI({
    apiKey: apiKey,
    baseURL: BASE_URL,
    dangerouslyAllowBrowser: true, // Required for running in browser
  });
}

/**
 * Phân bổ thời gian cho danh sách task sao cho tổng bằng 8.0 giờ.
 */
export async function distributeTasksWithAI(
  tasks: Task[],
  customApiKey?: string
): Promise<{ tasks: Task[]; explanation: string }> {
  const openai = getOpenAIClient(customApiKey);

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

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Hãy phân bổ danh sách task sau: ${userContent}` },
    ],
    response_format: { type: "json_object" },
  });

  const resultText = response.choices[0].message.content || "";
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
  customApiKey?: string
): Promise<{ tasks: Task[]; aiMessage: string }> {
  const openai = getOpenAIClient(customApiKey);

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

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages: messages as any,
    response_format: { type: "json_object" },
  });

  const resultText = response.choices[0].message.content || "";
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
  customApiKey?: string
): Promise<{ date: string; tasks: Task[]; explanation: string }> {
  const openai = getOpenAIClient(customApiKey);

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

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Hãy phân tích văn bản sau:\n${rawText}` },
    ],
    response_format: { type: "json_object" },
  });

  const resultText = response.choices[0].message.content || "";
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
  customApiKey?: string
): Promise<{ weeklyTasks: { [date: string]: Task[] }; explanation: string }> {
  const openai = getOpenAIClient(customApiKey);

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

  const response = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Hãy phân bổ danh sách task tuần sau:\n${JSON.stringify(inputPayload)}` },
    ],
    response_format: { type: "json_object" },
  });

  const resultText = response.choices[0].message.content || "";
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

