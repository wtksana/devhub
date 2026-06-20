export type ThemeName = "dark" | "light" | "system";
export type LanguageSetting = "system" | "zh-CN" | "en-US";
export type SftpFileSizeUnit = "bytes" | "auto";

export interface AppearanceSettings {
  theme: ThemeName;
  language: LanguageSetting;
  ui_font_family: string;
  ui_font_size: number;
  terminal_font_family: string;
  terminal_font_size: number;
}

export interface LayoutSettings {
  connection_sidebar_width: number;
}

export interface SftpSettings {
  file_size_unit: SftpFileSizeUnit;
}

export interface TerminalLogHighlightRule {
  pattern: string;
  color: string;
}

export interface TerminalLogHighlightSettings {
  auto_detect_tail: boolean;
  case_sensitive: boolean;
  rules: TerminalLogHighlightRule[];
}

export interface TerminalSettings {
  log_highlight: TerminalLogHighlightSettings;
}

export interface PasswordAuthSettings {
  type: "password";
  password: string;
}

export interface PrivateKeyAuthSettings {
  type: "private_key";
  private_key_path: string;
  passphrase?: string;
}

export type ConnectionAuthSettings = PasswordAuthSettings | PrivateKeyAuthSettings;

export interface SshConnectionSettings {
  kind?: "ssh";
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  auth: ConnectionAuthSettings;
}

export interface RedisConnectionSettings {
  kind: "redis";
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  database: number;
  password?: string;
}

export interface DatabaseConnectionSettings {
  kind: "mysql" | "postgresql";
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
}

export type ConnectionSettings = SshConnectionSettings | RedisConnectionSettings | DatabaseConnectionSettings;

export interface DevHubSettings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  sftp: SftpSettings;
  terminal: TerminalSettings;
  connection_groups: string[];
  connections: ConnectionSettings[];
}
