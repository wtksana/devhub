import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionList } from "./ConnectionList";
import type { ConnectionSettings } from "../settings/settingsTypes";

const connections: ConnectionSettings[] = [
  {
    id: "prod-web-01",
    name: "生产 Web",
    group: "production",
    host: "10.0.0.10",
    port: 22,
    username: "deploy",
    auth: {
      type: "password",
      password: "secret",
    },
  },
];

describe("ConnectionList", () => {
  it("shows local terminal by default and opens it from the connection list", async () => {
    const onOpenTerminal = vi.fn();

    render(<ConnectionList connections={[]} onOpenTerminal={onOpenTerminal} onAddConnection={vi.fn()} />);

    expect(screen.getByText("本地终端")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SFTP" })).not.toBeInTheDocument();

    const localItem = screen.getByText("本地终端").closest("li");
    expect(localItem).not.toBeNull();
    await userEvent.dblClick(localItem as HTMLElement);

    expect(onOpenTerminal).toHaveBeenCalledWith("local");
  });

  it("opens a modal add SSH connection form and submits a password connection", async () => {
    const onAddConnection = vi.fn();

    const { container } = render(
      <ConnectionList
        connections={connections}
        onOpenTerminal={vi.fn()}
        onAddConnection={onAddConnection}
      />,
    );
    const connectionList = within(container);

    await userEvent.click(connectionList.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "测试服务器");
    await userEvent.type(within(dialog).getByLabelText("主机"), "192.168.1.10");
    await userEvent.clear(within(dialog).getByLabelText("端口"));
    await userEvent.type(within(dialog).getByLabelText("端口"), "2222");
    await userEvent.type(within(dialog).getByLabelText("用户名"), "root");
    await userEvent.type(within(dialog).getByLabelText("密码"), "root-password");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({
      id: expect.stringMatching(/^ssh-/),
      name: "测试服务器",
      host: "192.168.1.10",
      port: 2222,
      username: "root",
      auth: {
        type: "password",
        password: "root-password",
      },
    });
    expect(screen.queryByRole("dialog", { name: "添加 SSH 连接" })).not.toBeInTheDocument();
  });

  it("opens a remote terminal by double clicking a connection row and shows an icon before the name", async () => {
    const onOpenTerminal = vi.fn();

    const { container } = render(
      <ConnectionList
        connections={connections}
        onOpenTerminal={onOpenTerminal}
        onAddConnection={vi.fn()}
      />,
    );
    const connectionList = within(container);

    const connectionItem = connectionList.getByText("生产 Web").closest("li");
    expect(connectionItem).not.toBeNull();
    expect(within(connectionItem as HTMLElement).getByRole("img", { name: "SSH 连接" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "SFTP" })).not.toBeInTheDocument();

    await userEvent.dblClick(connectionItem as HTMLElement);

    expect(onOpenTerminal).toHaveBeenCalledWith("prod-web-01");
  });
});
