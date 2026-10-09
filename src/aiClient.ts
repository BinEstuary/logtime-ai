import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export type AiProvider = "groq" | "gemini" | "openai" | "anthropic" | "openrouter" | "deepseek" | "mistral" | "custom";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface ProviderInfo {
  label: string;
  /** Proxy qua Vite/Electron để tránh CORS; không có thì gọi thẳng tới baseUrl người dùng nhập */
  proxyPath?: string;
  defaultBaseUrl?: string;
  needsKey: boolean;
  models: string[];
  keyHint: string;
}

export const PROVIDERS: Record<AiProvider, ProviderInfo> = {
  groq: {
    label: "Groq",
    proxyPath: "/api-groq",
    needsKey: true,
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    keyHint: "Lấy key tại console.groq.com",
  },
  gemini: {
    label: "Google Gemini",
    proxyPath: "/api-gemini",
    needsKey: true,
    models: ["gemini-3.8-flash"],
    keyHint: "Lấy key tại aistudio.google.com",
  },
  openai: {
    label: "OpenAI",
    proxyPath: "/api-openai",
    needsKey: true,
    models: ["gpt-4.1-mini", "gpt-4.1"],
    keyHint: "Lấy key tại platform.openai.com",
  },
  anthropic: {
    label: "Anthropic Claude",
    proxyPath: "/api-anthropic",
    needsKey: true,
    models: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    keyHint: "Lấy key tại console.anthropic.com",
  },
  openrouter: {
    label: "OpenRouter",
    proxyPath: "/api-openrouter",
    needsKey: true,
    models: ["openai/gpt-4.1-mini", "anthropic/claude-haiku-5-5", "meta-llama/llama-3.3-70b-instruct"],
    keyHint: "Một key dùng được nhiều model — lấy tại openrouter.ai",
  },
  deepseek: {
    label: "DeepSeek",
    proxyPath: "/api-deepseek",
    needsKey: true,
    models: ["deepseek-chat"],
    keyHint: "Lấy key tại platform.deepseek.com",
  },
  mistral: {
    label: "Mistral",
    proxyPath: "/api-mistral",
    needsKey: true,
    models: ["mistral-small-latest", "mistral-large-latest"],
    keyHint: "Lấy key tại console.mistral.ai",
  },
  custom: {
    label: "Ollama / Tuỳ chỉnh",
    defaultBaseUrl: "http://localhost:11434/v1",
    needsKey: false,
    models: [],
    keyHint: "Không bắt buộc với Ollama",
  },
};

export const AI_PROVIDER_IDS = Object.keys(PROVIDERS) as AiProvider[];

export interface AiSettings {
  provider: AiProvider;
  providers: Partial<Record<AiProvider, { apiKey?: string; model?: string; baseUrl?: string }>>;
}

const SETTINGS_KEY = "logtime_ai_settings";

export function loadAiSettings(): AiSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as AiSettings;
      if (PROVIDERS[parsed.provider]) return { provider: parsed.provider, providers: parsed.providers || {} };
    }
  } catch {
    // dữ liệu hỏng thì dùng mặc định
  }
  // Chuyển từ cách lưu cũ (key Groq/Gemini riêng lẻ)
  const legacyProvider = localStorage.getItem("logtime_ai_provider");
  return {
    provider: legacyProvider === "gemini" ? "gemini" : "groq",
    providers: {
      groq: { apiKey: localStorage.getItem("logtime_custom_apikey") || "" },
      gemini: { apiKey: localStorage.getItem("logtime_gemini_apikey") || "" },
    },
  };
}

export function saveAiSettings(settings: AiSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Cấu hình đầy đủ của provider đang chọn, đã điền giá trị mặc định */
export function resolveAiConfig(settings: AiSettings, provider: AiProvider = settings.provider): AiConfig {
  const info = PROVIDERS[provider];
  const saved = settings.providers[provider] || {};
  return {
    provider,
    apiKey: saved.apiKey?.trim() || "",
    model: saved.model?.trim() || info.models[0] || "",
    baseUrl: saved.baseUrl?.trim() || info.defaultBaseUrl || "",
  };
}

function createClient(ai: AiConfig): OpenAI {
  const info = PROVIDERS[ai.provider];
  if (info.needsKey && !ai.apiKey) {
    throw new Error(`Chưa có API Key ${info.label}. Vào Cài đặt để nhập API Key của bạn.`);
  }
  const baseURL = info.proxyPath ? window.location.origin + info.proxyPath : ai.baseUrl.replace(/\/+$/, "");
  if (!baseURL) throw new Error("Chưa nhập Base URL cho AI tuỳ chỉnh. Vào Cài đặt để nhập.");
  return new OpenAI({
    // SDK bắt buộc có apiKey; Ollama bỏ qua giá trị này
    apiKey: ai.apiKey || "none",
    baseURL,
    dangerouslyAllowBrowser: true,
  });
}

/** Một số model (Claude, model nhỏ) bọc JSON trong ```json … ``` hoặc thêm chữ xung quanh */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start !== -1 && end > start ? body.slice(start, end + 1) : body;
}

/** Gọi chat completion ở chế độ JSON, trả về chuỗi JSON của câu trả lời */
export async function chatJson(ai: AiConfig, messages: ChatCompletionMessageParam[]): Promise<string> {
  const client = createClient(ai);
  if (!ai.model) throw new Error("Chưa chọn model AI. Vào Cài đặt để chọn model.");
  const response = await client.chat.completions.create({
    model: ai.model,
    messages,
    response_format: { type: "json_object" },
  });
  return extractJson(response.choices[0]?.message.content || "");
}

/** Danh sách model thật từ provider (GET /models) */
export async function listModels(ai: AiConfig): Promise<string[]> {
  const client = createClient(ai);
  const ids: string[] = [];
  for await (const model of client.models.list()) ids.push(model.id.replace(/^models\//, ""));
  return ids.sort();
}
