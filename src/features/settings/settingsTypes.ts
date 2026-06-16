export type ThemeName = "dark" | "light" | "system";
export type AiPanelPosition = "left" | "right" | "hidden";

export interface AppearanceSettings {
  theme: ThemeName;
  ui_font_family: string;
  terminal_font_family: string;
  terminal_font_size: number;
}

export interface LayoutSettings {
  ai_panel: AiPanelPosition;
  connection_sidebar_width: number;
  open_ai_panel_by_default: boolean;
}

export interface PasswordAuthSettings {
  type: "password";
  password_ref: string;
}

export interface PrivateKeyAuthSettings {
  type: "private_key";
  private_key_path: string;
  passphrase_ref?: string;
}

export type ConnectionAuthSettings = PasswordAuthSettings | PrivateKeyAuthSettings;

export interface ConnectionSettings {
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  auth: ConnectionAuthSettings;
}

export interface AiSettings {
  provider: "openai_compatible";
  base_url: string;
  model: string;
  api_key_ref: string;
}

export interface DevHubSettings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  connections: ConnectionSettings[];
  ai: AiSettings;
}
