// Danh sách các bộ đọc lịch sử AI agent (mỗi nguồn trả về AgentSourceResult cho một ngày).
import type { AgentSourceResult } from './common'
import { readCodexHistory } from './codex'
import { readGeminiCliHistory } from './gemini'
import { readKiroHistory } from './kiro'
import { readGooseHistory } from './goose'
import { readOpenCodeHistory } from './opencode'
import { readZedHistory } from './zed'
import { readCopilotCliHistory } from './copilot-cli'
import { readClineFamilyHistory } from './cline'
import { readCursorHistory } from './cursor'
import { readWindsurfHistory } from './windsurf'
import { readCopilotChatHistory } from './copilot-chat'

export const AGENT_READERS = {
  codex: readCodexHistory,
  'gemini-cli': readGeminiCliHistory,
  kiro: readKiroHistory,
  goose: readGooseHistory,
  opencode: readOpenCodeHistory,
  zed: readZedHistory,
  'copilot-cli': readCopilotCliHistory,
  cline: readClineFamilyHistory,
  cursor: readCursorHistory,
  windsurf: readWindsurfHistory,
  'copilot-chat': readCopilotChatHistory,
} as const satisfies Record<string, (date: string, homeDir: string) => Promise<AgentSourceResult>>

export type AgentReaderId = keyof typeof AGENT_READERS
export const AGENT_READER_IDS = Object.keys(AGENT_READERS) as AgentReaderId[]
export type { AgentSourceResult, AgentProjectActivity } from './common'
