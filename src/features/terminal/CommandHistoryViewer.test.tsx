import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { CommandHistoryViewer } from "./CommandHistoryViewer";

describe("CommandHistoryViewer", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function renderViewer() {
    return render(
      <I18nProvider language="zh-CN">
        <CommandHistoryViewer />
      </I18nProvider>,
    );
  }

  it("shows command histories and deletes the selected command", async () => {
    window.localStorage.setItem(
      "devhub.terminal.commandHistory.prod-web-01",
      JSON.stringify(["nginx -t", "systemctl status nginx"]),
    );

    renderViewer();

    expect(screen.getByRole("heading", { name: "命令历史" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "nginx -t" })).toBeInTheDocument();
    expect(screen.getAllByText("prod-web-01").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "nginx -t" }));
    await userEvent.click(within(screen.getByLabelText("命令详情")).getByRole("button", { name: "删除" }));

    expect(screen.queryByRole("button", { name: "nginx -t" })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("devhub.terminal.commandHistory.prod-web-01") || "[]")).toEqual([
      "systemctl status nginx",
    ]);
  });

  it("filters command histories by connection and keyword", async () => {
    window.localStorage.setItem("devhub.terminal.commandHistory.prod-web-01", JSON.stringify(["nginx -t"]));
    window.localStorage.setItem("devhub.terminal.commandHistory.test-web-01", JSON.stringify(["docker ps"]));

    renderViewer();

    await userEvent.selectOptions(screen.getByLabelText("连接筛选"), "test-web-01");
    expect(screen.queryByRole("button", { name: "nginx -t" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "docker ps" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("命令关键字筛选"), "nginx");
    expect(screen.queryByRole("button", { name: "docker ps" })).not.toBeInTheDocument();
    expect(screen.getByText("暂无保存的命令历史")).toBeInTheDocument();
  });
});
