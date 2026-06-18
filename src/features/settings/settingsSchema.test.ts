import { describe, expect, it } from "vitest";
import { parseSettings } from "./settingsSchema";

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

    expect(settings.connections[0].auth.type).toBe("private_key");
    expect(settings.sftp.file_size_unit).toBe("auto");
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

    expect(settings.connections[0].auth).toEqual({
      type: "password",
      password: "plain-password",
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
    expect(settings.connection_groups).toEqual([]);
  });
});
