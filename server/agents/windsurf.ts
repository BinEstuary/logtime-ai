// Lịch sử chat Cascade của Windsurf.
// Prompt được lưu trong ~/.codeium/windsurf/cascade/*.pb (protobuf, entropy ~8 bit/byte, không đọc được dạng văn bản).
// state.vscdb của Windsurf chỉ có chỉ mục phiên (chat.ChatSessionStore.index) nên không chứa nội dung prompt.
// Không giải mã/đoán dữ liệu: trả về unavailable với lý do rõ ràng.
import fs from 'fs'
import path from 'path'
import type { AgentSourceResult } from './common'

const ID = 'windsurf'
const LABEL = 'Windsurf'

export async function readWindsurfHistory(_date: string, homeDir: string): Promise<AgentSourceResult> {
  const unavailable = (error: string): AgentSourceResult => ({ id: ID, label: LABEL, available: false, error, projects: [] })
  try {
    const cascadeDir = path.join(homeDir, '.codeium', 'windsurf', 'cascade')
    if (!fs.existsSync(cascadeDir)) {
      return unavailable('Không tìm thấy ~/.codeium/windsurf/cascade')
    }
    return unavailable(
      'Lịch sử Cascade (~/.codeium/windsurf/cascade/*.pb) được lưu dạng nhị phân mã hóa, chưa đọc được nội dung prompt'
    )
  } catch {
    return unavailable('Không đọc được lịch sử Windsurf')
  }
}
