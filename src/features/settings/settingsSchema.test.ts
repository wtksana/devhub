import { describe, expect, it } from "vitest";
import { parseSettings } from "./settingsSchema";

describe("settings schema", () => {
  it("accepts a valid portable settings file", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Inter",
        terminal_font_family: "JetBrains Mono",
        terminal_font_size: 14,
      },
      layout: {
        ai_panel: "right",
        connection_sidebar_width: 280,
        open_ai_panel_by_default: true,
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
      ai: {
        provider: "openai_compatible",
        base_url: "https://api.example.com/v1",
        model: "gpt-4.1",
        api_key_ref: "ai:default",
      },
    });

    expect(settings.connections[0].auth.type).toBe("private_key");
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
});
