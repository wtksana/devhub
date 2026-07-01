import { describe, expect, it } from "vitest";
import { parseSettings } from "./settingsSchema";
import type { ConnectionSettings, SshConnectionSettings } from "./settingsTypes";

function expectSshConnection(connection: ConnectionSettings): SshConnectionSettings {
  if (!("auth" in connection)) {
    throw new Error("expected SSH connection");
  }
  return connection;
}

describe("settings schema", () => {
  it("accepts a valid portable settings file", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      sftp: {
        file_size_unit: "auto",
      },
      terminal: {
        log_highlight: {
          auto_detect_tail: true,
          case_sensitive: false,
          rules: [{ pattern: "\\bERROR\\b", color: "#e06c75" }],
        },
      },
      connection_groups: ["production"],
      connections: [
        {
          id: "prod-web-01",
          name: "prod-web-01",
          group: "production",
          host: "10.0.0.10",
          port: 22,
          username: "deploy",
          auth: {
            type: "private_key",
            private_key_path: "C:\\Users\\user\\.ssh\\id_ed25519",
            passphrase: "key-passphrase",
          },
        },
      ],
    });

    expect(expectSshConnection(settings.connections[0]).auth.type).toBe("private_key");
    expect(settings.sftp.file_size_unit).toBe("auto");
    expect(settings.terminal.log_highlight.rules).toEqual([{ pattern: "\\bERROR\\b", color: "#e06c75" }]);
    expect(settings.connection_groups).toEqual(["production"]);
  });

  it("rejects sensitive values inside settings json", () => {
    expect(() =>
      parseSettings({
        connections: [
          {
            id: "bad",
            name: "bad",
            host: "127.0.0.1",
            port: 22,
            username: "root",
            password: "plain-text-password",
          },
        ],
      }),
    ).toThrow(/sensitive/i);
  });

  it("accepts SSH password auth with the real password in settings json", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [
        {
          id: "dev",
          name: "Dev",
          host: "127.0.0.1",
          port: 22,
          username: "root",
          auth: {
            type: "password",
            password: "plain-password",
          },
        },
      ],
    });

    expect(expectSshConnection(settings.connections[0]).auth).toEqual({
      type: "password",
      password: "plain-password",
    });
  });

  it("accepts database connections with the real password in settings json", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [
        {
          kind: "mysql",
          id: "mysql-local",
          name: "Local MySQL",
          host: "127.0.0.1",
          port: 3306,
          username: "root",
          password: "mysql-password",
          database: "app",
        },
        {
          kind: "postgresql",
          id: "postgres-local",
          name: "Local PostgreSQL",
          host: "127.0.0.1",
          port: 5432,
          username: "postgres",
          password: "postgres-password",
        },
      ],
    });

    expect(settings.connections).toEqual([
      {
        kind: "mysql",
        id: "mysql-local",
        name: "Local MySQL",
        host: "127.0.0.1",
        port: 3306,
        username: "root",
        password: "mysql-password",
        database: "app",
      },
      {
        kind: "postgresql",
        id: "postgres-local",
        name: "Local PostgreSQL",
        host: "127.0.0.1",
        port: 5432,
        username: "postgres",
        password: "postgres-password",
      },
    ]);
  });

  it("accepts Redis connections with the real password in settings json", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [
        {
          kind: "redis",
          id: "redis-local",
          name: "Local Redis",
          host: "127.0.0.1",
          port: 6379,
          database: 0,
          password: "redis-password",
        },
      ],
    });

    expect(settings.connections[0]).toEqual({
      kind: "redis",
      id: "redis-local",
      name: "Local Redis",
      host: "127.0.0.1",
      port: 6379,
      database: 0,
      password: "redis-password",
    });
  });

  it("accepts nullable optional connection fields", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [
        {
          id: "dev",
          name: "Dev",
          group: null,
          host: "127.0.0.1",
          port: 22,
          username: "root",
          auth: {
            type: "password",
            password: "",
          },
        },
      ],
    });

    expect(settings.connections[0].group).toBeUndefined();
  });

  it("fills defaults for newly added appearance fields", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [],
    });

    expect(settings.appearance.ui_font_size).toBe(16);
    expect(settings.appearance.language).toBe("system");
    expect(settings.sftp.file_size_unit).toBe("bytes");
    expect(settings.terminal.term).toBe("xterm-256color");
    expect(settings.terminal.colorterm).toBe("truecolor");
    expect(settings.terminal.log_highlight.auto_detect_tail).toBe(true);
    expect(settings.terminal.log_highlight.case_sensitive).toBe(false);
    expect(settings.terminal.log_highlight.rules.length).toBeGreaterThan(0);
    expect(settings.connection_groups).toEqual([]);
  });

  it("fills default logging settings", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [],
    });

    expect(settings.logging).toEqual({
      enabled: true,
      level: "info",
      retention_days: 14,
      include_sql: false,
    });
  });

  it("accepts logging settings", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      logging: {
        enabled: false,
        level: "debug",
        retention_days: 3,
        include_sql: true,
      },
      connections: [],
    });

    expect(settings.logging).toEqual({
      enabled: false,
      level: "debug",
      retention_days: 3,
      include_sql: true,
    });
  });

  it("accepts terminal log highlight settings", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Consolas",
        ui_font_size: 16,
        terminal_font_family: "Consolas",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      terminal: {
        term: "screen-256color",
        colorterm: "24bit",
        log_highlight: {
          auto_detect_tail: false,
          case_sensitive: true,
          rules: [
            { pattern: "\\bERROR\\b", color: "#ff0000" },
          ],
        },
      },
      connections: [],
    });

    expect(settings.terminal.term).toBe("screen-256color");
    expect(settings.terminal.colorterm).toBe("24bit");
    expect(settings.terminal.log_highlight).toEqual({
      auto_detect_tail: false,
      case_sensitive: true,
      rules: [
        { pattern: "\\bERROR\\b", color: "#ff0000" },
      ],
    });
  });
});
