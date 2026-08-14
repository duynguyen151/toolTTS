import { z } from "zod";

const BaselineAiEnvironmentSchema = z.object({
  TOOL_AI_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  TOOL_AI_PROVIDER: z.literal("opencode-zen").default("opencode-zen"),
  TOOL_AI_BASE_URL: z.url().default("https://opencode.ai/zen/v1"),
  TOOL_AI_API_KEY: z.string().optional(),
  TOOL_AI_MODEL: z.string().trim().min(1).default("deepseek-v4-flash-free"),
  TOOL_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export interface BaselineAiConfig {
  readonly enabled: boolean;
  readonly provider: "opencode-zen";
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly timeoutMs: number;
}

export function readBaselineAiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BaselineAiConfig {
  const parsed = BaselineAiEnvironmentSchema.parse(environment);
  return {
    enabled: parsed.TOOL_AI_ENABLED,
    provider: parsed.TOOL_AI_PROVIDER,
    baseUrl: parsed.TOOL_AI_BASE_URL,
    apiKey: parsed.TOOL_AI_API_KEY,
    model: parsed.TOOL_AI_MODEL,
    timeoutMs: parsed.TOOL_AI_TIMEOUT_MS,
  };
}
