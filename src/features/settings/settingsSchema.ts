import { z } from "zod";
import type { DevHubSettings } from "./settingsTypes";

const forbiddenSensitiveKeys = [
  "password",
  "passphrase",
  "api_key",
  "apiKey",
  "private_key",
  "privateKey",
];

function assertNoSensitiveKeys(value: unknown, path: string[] = []): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, [...path, String(index)]));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSensitiveKeys.includes(key)) {
      throw new Error(`sensitive field is not allowed in settings.json: ${[...path, key].join(".")}`);
    }
    assertNoSensitiveKeys(child, [...path, key]);
  }
}

const authSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("password"),
    password_ref: z.string().min(1),
  }),
  z.object({
    type: z.literal("private_key"),
    private_key_path: z.string().min(1),
    passphrase_ref: z.string().min(1).optional(),
  }),
]);

const connectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  group: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  auth: authSchema,
});

export const devHubSettingsSchema = z.object({
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]),
    ui_font_family: z.string().min(1),
    terminal_font_family: z.string().min(1),
    terminal_font_size: z.number().min(8).max(40),
  }),
  layout: z.object({
    ai_panel: z.enum(["left", "right", "hidden"]),
    connection_sidebar_width: z.number().min(220).max(520),
    open_ai_panel_by_default: z.boolean(),
  }),
  connections: z.array(connectionSchema),
  ai: z.object({
    provider: z.literal("openai_compatible"),
    base_url: z.url(),
    model: z.string().min(1),
    api_key_ref: z.string().min(1),
  }),
});

export function parseSettings(value: unknown): DevHubSettings {
  assertNoSensitiveKeys(value);
  return devHubSettingsSchema.parse(value);
}
