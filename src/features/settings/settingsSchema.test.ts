import { describe, expect, it } from "vitest";
import { parseSettings } from "./settingsSchema";

describe("settings schema", () => {
  it("accepts a valid portable settings file", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Inter",
        ui_font_size: 13,
        terminal_font_family: "JetBrains Mono",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      sftp: {
        file_size_unit: "auto",
      },
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
            passphrase_ref: "ssh:prod-web-01:passphrase",
          },
        },
      ],
    });

    expect(settings.connections[0].auth.type).toBe("private_key");
    expect(settings.sftp.file_size_unit).toBe("auto");
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
        ui_font_family: "Inter",
        ui_font_size: 13,
        terminal_font_family: "JetBrains Mono",
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
        ui_font_family: "Inter",
        ui_font_size: 13,
        terminal_font_family: "JetBrains Mono",
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
        ui_font_family: "Inter",
        terminal_font_family: "JetBrains Mono",
        terminal_font_size: 14,
      },
      layout: {
        connection_sidebar_width: 280,
      },
      connections: [],
    });

    expect(settings.appearance.ui_font_size).toBe(13);
    expect(settings.sftp.file_size_unit).toBe("bytes");
  });
});
