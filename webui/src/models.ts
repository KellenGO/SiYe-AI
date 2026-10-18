export interface Provider {
  id: string;
  name: string;
  url: string;
  /** 已知的常用模型名；留空表示需要手填。 */
  models: string[];
}

export const PROVIDERS: Provider[] = [
  { id: "deepseek", name: "DeepSeek", url: "https://api.deepseek.com", models: ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"] },
  { id: "gemini", name: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", models: ["gemini-3.8-flash"] },
  { id: "openai", name: "OpenAI", url: "https://api.openai.com/v1", models: [] },
];

export function providerOf(baseUrl: string): Provider | undefined {
  try {
    const origin = new URL(baseUrl).origin;
    return PROVIDERS.find((row) => new URL(row.url).origin === origin);
  } catch {
    return undefined;
  }
}
