// Phần cấu hình AI trong màn Cài đặt: chọn provider, model, API key và Base URL (cho Ollama / endpoint tuỳ chỉnh).
import { useEffect, useState } from "react";
import { AutoComplete, Button, Input, Select, Tooltip, Typography } from "antd";
import { EyeInvisibleOutlined, EyeOutlined, ReloadOutlined } from "@ant-design/icons";
import { AI_PROVIDER_IDS, PROVIDERS, listModels, resolveAiConfig, type AiProvider, type AiSettings } from "./aiClient";

const { Text } = Typography;

interface Props {
  value: AiSettings;
  onChange: (value: AiSettings) => void;
}

export default function AiSettingsPanel({ value, onChange }: Props) {
  const provider = value.provider;
  const info = PROVIDERS[provider];
  const config = resolveAiConfig(value);
  const saved = value.providers[provider] || {};

  // Kết quả gắn với provider/key/Base URL đã dùng để lấy, nên đổi cấu hình là kết quả cũ tự ẩn đi
  const fetchKey = `${provider}|${config.apiKey}|${config.baseUrl}`;
  const [fetched, setFetched] = useState<{ key: string; models: string[]; error: string }>();
  const [loadingModels, setLoadingModels] = useState(false);
  const current = fetched?.key === fetchKey ? fetched : undefined;
  const liveModels = current?.models ?? [];
  const modelError = current?.error ?? "";

  const updateProvider = (patch: { apiKey?: string; model?: string; baseUrl?: string }) => {
    onChange({ ...value, providers: { ...value.providers, [provider]: { ...saved, ...patch } } });
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      setFetched({ key: fetchKey, models: await listModels(config), error: "" });
    } catch (e) {
      setFetched({ key: fetchKey, models: [], error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingModels(false);
    }
  };

  // Tự lấy danh sách model thật khi đổi provider / key / Base URL (chờ người dùng gõ xong)
  const canFetch = info.needsKey ? !!config.apiKey : !!config.baseUrl;
  useEffect(() => {
    if (!canFetch) return;
    const timer = setTimeout(fetchModels, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const modelOptions = Array.from(new Set([...info.models, ...liveModels])).map((m) => ({ value: m }));

  return (
    <>
      <div>
        <div className="field-label">Nhà cung cấp AI</div>
        <Select
          value={provider}
          onChange={(p: AiProvider) => onChange({ ...value, provider: p })}
          options={AI_PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label }))}
          style={{ width: "100%" }}
        />
      </div>

      {!info.proxyPath && (
        <div>
          <div className="field-label">Base URL</div>
          <Input
            placeholder={info.defaultBaseUrl}
            value={saved.baseUrl ?? ""}
            onChange={(e) => updateProvider({ baseUrl: e.target.value })}
          />
          <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
            Endpoint tương thích OpenAI (Ollama, LM Studio, vLLM…). Trình duyệt gọi thẳng tới địa chỉ này, nên với
            Ollama ngoài localhost cần đặt biến <code>OLLAMA_ORIGINS</code> cho phép domain của app.
          </Text>
        </div>
      )}

      <div>
        <div className="field-label">API Key ({info.label}){!info.needsKey && " — không bắt buộc"}</div>
        <Input.Password
          placeholder={`Nhập API Key ${info.label}`}
          value={saved.apiKey ?? ""}
          onChange={(e) => updateProvider({ apiKey: e.target.value })}
          iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
        />
        <Text type="secondary" style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
          {info.keyHint}. Key chỉ được lưu trên máy này.
        </Text>
      </div>

      <div>
        <div className="field-label">Model</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <AutoComplete
            value={saved.model ?? ""}
            placeholder={info.models[0] || "Ví dụ: qwen2.5:7b"}
            options={modelOptions}
            onChange={(model: string) => updateProvider({ model })}
            filterOption={(input, option) => (option?.value ?? "").toLowerCase().includes(input.toLowerCase())}
            style={{ flex: 1 }}
          />
          <Tooltip title="Lấy danh sách model từ provider">
            <Button icon={<ReloadOutlined />} loading={loadingModels} disabled={!canFetch} onClick={fetchModels} />
          </Tooltip>
        </div>
        <Text type={modelError ? "warning" : "secondary"} style={{ fontSize: "12px", display: "block", marginTop: "4px" }}>
          {modelError
            ? `Không lấy được danh sách model: ${modelError}`
            : liveModels.length
              ? `${liveModels.length} model khả dụng. Có thể gõ tên model khác.`
              : info.models[0]
                ? `Để trống sẽ dùng "${info.models[0]}". Có thể gõ tên model khác.`
                : "Bắt buộc nhập tên model (ví dụ: qwen2.5:7b)."}
        </Text>
      </div>
    </>
  );
}
