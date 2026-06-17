export type ThemeName = "dark" | "light" | "system";

export interface AppearanceSettings {
  theme: ThemeName;
  ui_font_family: string;
  ui_font_size: number;
  terminal_font_family: string;
  terminal_font_size: number;
}

export interface LayoutSettings {
  connection_sidebar_width: number;
}

export interface PasswordAuthSettings {
  type: "password";
  password: string;
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

export interface DevHubSettings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  connections: ConnectionSettings[];
}
