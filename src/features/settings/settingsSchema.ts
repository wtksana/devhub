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
    if (forbiddenSensitiveKeys.includes(key) && !isAllowedSensitivePath(nextPath, value)) {
      throw new Error(`sensitive field is not allowed in settings.json: ${[...path, key].join(".")}`);
    }
    assertNoSensitiveKeys(child, nextPath);
  }
}

function isAllowedSensitivePath(path: string[], parent: unknown): boolean {
  const parentKind =
    parent && typeof parent === "object" && !Array.isArray(parent) && "kind" in parent ? parent.kind : undefined;
  return (
    (path.length === 4 &&
      path[0] === "connections" &&
      path[2] === "auth" &&
      (path[3] === "password" || path[3] === "passphrase")) ||
    (path.length === 3 &&
      path[0] === "connections" &&
      path[2] === "password" &&
      (parentKind === "redis" || parentKind === "mysql" || parentKind === "postgresql"))
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

const groupSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const sshConnectionSchema = z.object({
  kind: z.literal("ssh").optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  group: groupSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  auth: authSchema,
});

const redisConnectionSchema = z.object({
  kind: z.literal("redis"),
  id: z.string().min(1),
  name: z.string().min(1),
  group: groupSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.number().int().min(0),
  password: z.string().optional(),
});

const databaseConnectionSchema = z.object({
  kind: z.union([z.literal("mysql"), z.literal("postgresql")]),
  id: z.string().min(1),
  name: z.string().min(1),
  group: groupSchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string(),
  database: z.string().optional(),
});

const connectionSchema = z.union([redisConnectionSchema, databaseConnectionSchema, sshConnectionSchema]);

const defaultTerminalLogHighlight = {
  auto_detect_tail: true,
  case_sensitive: false,
  rules: [
    { pattern: "\\bERROR\\b|Exception|Traceback", color: "#e06c75" },
    { pattern: "\\bWARN\\b", color: "#e5c07b" },
    { pattern: "\\bINFO\\b", color: "#56b6c2" },
    { pattern: "\\b\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}\\b", color: "#7f848e" },
  ],
};

const defaultTerminal = {
  term: "xterm-256color",
  colorterm: "truecolor",
  log_highlight: defaultTerminalLogHighlight,
};

const defaultLogging = {
  enabled: true,
  level: "info" as const,
  retention_days: 14,
  include_sql: false,
};

export const devHubSettingsSchema = z.object({
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]),
    language: z.enum(["system", "zh-CN", "en-US"]),
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
  terminal: z.object({
    term: z.string().min(1),
    colorterm: z.string(),
    log_highlight: z.object({
      auto_detect_tail: z.boolean(),
      case_sensitive: z.boolean(),
      rules: z.array(z.object({
        pattern: z.string().min(1),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })),
    }),
  }),
  logging: z.object({
    enabled: z.boolean().default(defaultLogging.enabled),
    level: z.enum(["debug", "info", "warn", "error"]).default(defaultLogging.level),
    retention_days: z.coerce.number().int().min(1).max(365).default(defaultLogging.retention_days),
    include_sql: z.boolean().default(defaultLogging.include_sql),
  }).default(defaultLogging),
  connection_groups: z.array(z.string().min(1)),
  connections: z.array(connectionSchema),
});

export function parseSettings(value: unknown): DevHubSettings {
  assertNoSensitiveKeys(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const settings = value as Record<string, unknown>;
    if (settings.appearance && typeof settings.appearance === "object" && !Array.isArray(settings.appearance)) {
      settings.appearance = {
        language: "system",
        ui_font_size: 16,
        ...settings.appearance,
      };
    }
    settings.sftp = {
      file_size_unit: "bytes",
      ...(settings.sftp && typeof settings.sftp === "object" && !Array.isArray(settings.sftp) ? settings.sftp : {}),
    };
    settings.terminal = {
      ...defaultTerminal,
      ...(settings.terminal && typeof settings.terminal === "object" && !Array.isArray(settings.terminal) ? settings.terminal : {}),
    };
    settings.logging = {
      ...defaultLogging,
      ...(settings.logging && typeof settings.logging === "object" && !Array.isArray(settings.logging) ? settings.logging : {}),
    };
    if (settings.terminal && typeof settings.terminal === "object" && !Array.isArray(settings.terminal)) {
      const terminal = settings.terminal as Record<string, unknown>;
      terminal.log_highlight = {
        ...defaultTerminalLogHighlight,
        ...(terminal.log_highlight && typeof terminal.log_highlight === "object" && !Array.isArray(terminal.log_highlight)
          ? terminal.log_highlight
          : {}),
      };
    }
    settings.connection_groups = Array.isArray(settings.connection_groups) ? settings.connection_groups : [];
  }
  return devHubSettingsSchema.parse(value);
}
