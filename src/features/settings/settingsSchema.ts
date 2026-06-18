import { z } from "zod";
import type { DevHubSettings } from "./settingsTypes";

const forbiddenSensitiveKeys = [
  "password",
  "passphrase",
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
    const nextPath = [...path, key];
    if (forbiddenSensitiveKeys.includes(key) && !isAllowedSensitivePath(nextPath)) {
      throw new Error(`sensitive field is not allowed in settings.json: ${[...path, key].join(".")}`);
    }
    assertNoSensitiveKeys(child, nextPath);
  }
}

function isAllowedSensitivePath(path: string[]): boolean {
  return (
    path.length === 4 &&
    path[0] === "connections" &&
    path[2] === "auth" &&
    (path[3] === "password" || path[3] === "passphrase")
  );
}

const authSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("password"),
    password: z.string(),
  }),
  z.object({
    type: z.literal("private_key"),
    private_key_path: z.string().min(1),
    passphrase: z.string().optional(),
  }),
]);

const connectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  group: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  auth: authSchema,
});

export const devHubSettingsSchema = z.object({
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]),
    ui_font_family: z.string().min(1),
    ui_font_size: z.number().min(10).max(24),
    terminal_font_family: z.string().min(1),
    terminal_font_size: z.number().min(8).max(40),
  }),
  layout: z.object({
    connection_sidebar_width: z.number().min(220).max(520),
  }),
  sftp: z.object({
    file_size_unit: z.enum(["bytes", "auto"]),
  }),
  connection_groups: z.array(z.string().min(1)),
  connections: z.array(connectionSchema),
});

export function parseSettings(value: unknown): DevHubSettings {
  assertNoSensitiveKeys(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const settings = value as Record<string, unknown>;
    if (settings.appearance && typeof settings.appearance === "object" && !Array.isArray(settings.appearance)) {
      settings.appearance = {
        ui_font_size: 16,
        ...settings.appearance,
      };
    }
    settings.sftp = {
      file_size_unit: "bytes",
      ...(settings.sftp && typeof settings.sftp === "object" && !Array.isArray(settings.sftp) ? settings.sftp : {}),
    };
    settings.connection_groups = Array.isArray(settings.connection_groups) ? settings.connection_groups : [];
  }
  return devHubSettingsSchema.parse(value);
}
