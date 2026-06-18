import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionList } from "./ConnectionList";
import type { ConnectionSettings } from "../settings/settingsTypes";
import { pickPrivateKeyFile } from "../../lib/fileDialog";

vi.mock("../../lib/fileDialog", () => ({
  pickPrivateKeyFile: vi.fn(),
}));

const pickPrivateKeyFileMock = vi.mocked(pickPrivateKeyFile);

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

const privateKeyConnections: ConnectionSettings[] = [
  {
    id: "key-web-01",
    name: "密钥 Web",
    group: "staging",
    host: "10.0.0.20",
    port: 2222,
    username: "ubuntu",
    auth: {
      type: "private_key",
      private_key_path: "C:\\Users\\ttat\\.ssh\\id_ed25519",
      passphrase: "key-passphrase",
    },
  },
];

const groupedConnections: ConnectionSettings[] = [
  ...connections,
  ...privateKeyConnections,
  {
    id: "ungrouped-web",
    name: "未分组 Web",
    host: "127.0.0.1",
    port: 22,
    username: "root",
    auth: {
      type: "password",
      password: "root-password",
    },
  },
];

describe("ConnectionList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderConnectionList(props: Partial<React.ComponentProps<typeof ConnectionList>> = {}) {
    return render(
      <ConnectionList
        connections={[]}
        onOpenTerminal={vi.fn()}
        onOpenNewTerminal={vi.fn()}
        onOpenSftp={vi.fn()}
        onAddConnection={vi.fn()}
        onUpdateConnection={vi.fn()}
        connectionGroups={[]}
        onUpdateConnectionGroups={vi.fn()}
        {...props}
      />,
    );
  }

  it("shows local terminal by default and opens it from the connection list", async () => {
    const onOpenTerminal = vi.fn();

    renderConnectionList({ onOpenTerminal });

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

    const { container } = renderConnectionList({ connections, onAddConnection });
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

  it("submits a private key connection with group and passphrase", async () => {
    const onAddConnection = vi.fn();

    renderConnectionList({ onAddConnection });

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "密钥服务器");
    await userEvent.type(within(dialog).getByLabelText("分组"), "staging");
    await userEvent.type(within(dialog).getByLabelText("主机"), "10.0.0.20");
    await userEvent.clear(within(dialog).getByLabelText("端口"));
    await userEvent.type(within(dialog).getByLabelText("端口"), "2222");
    await userEvent.type(within(dialog).getByLabelText("用户名"), "ubuntu");
    await userEvent.selectOptions(within(dialog).getByLabelText("认证方式"), "private_key");
    await userEvent.type(within(dialog).getByLabelText("私钥路径"), "C:\\Users\\ttat\\.ssh\\id_ed25519");
    await userEvent.type(within(dialog).getByLabelText("私钥口令"), "key-passphrase");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({
      id: expect.stringMatching(/^ssh-/),
      name: "密钥服务器",
      group: "staging",
      host: "10.0.0.20",
      port: 2222,
      username: "ubuntu",
      auth: {
        type: "private_key",
        private_key_path: "C:\\Users\\ttat\\.ssh\\id_ed25519",
        passphrase: "key-passphrase",
      },
    });
  });

  it("fills the private key path from a file picker", async () => {
    pickPrivateKeyFileMock.mockResolvedValue("C:\\Users\\ttat\\.ssh\\id_ed25519");

    renderConnectionList();

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.selectOptions(within(dialog).getByLabelText("认证方式"), "private_key");
    await userEvent.click(within(dialog).getByRole("button", { name: "选择私钥文件" }));

    expect(pickPrivateKeyFileMock).toHaveBeenCalled();
    expect(within(dialog).getByLabelText("私钥路径")).toHaveValue("C:\\Users\\ttat\\.ssh\\id_ed25519");
  });

  it("renders the local terminal above all connection groups and exposes existing groups in the editor", async () => {
    renderConnectionList({ connections: groupedConnections, connectionGroups: ["production", "staging"] });

    const localItem = screen.getByText("本地终端").closest("li");
    expect(localItem).not.toBeNull();
    expect(localItem?.closest("section[aria-label^='连接分组']")).toBeNull();

    expect(screen.getByRole("heading", { name: "production" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "staging" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未分组" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const groupInput = screen.getByLabelText("分组");

    expect(groupInput).toHaveAttribute("list", "connection-group-options");
    const groupOptions = Array.from(
      document.querySelectorAll<HTMLOptionElement>("#connection-group-options option"),
    ).map((option) => option.value);
    expect(groupOptions).toEqual(["production", "staging"]);
  });

  it("hides the ungrouped section when there are no ungrouped saved connections", () => {
    renderConnectionList({
      connections: [...connections, ...privateKeyConnections],
      connectionGroups: ["production", "staging"],
    });

    expect(screen.getByText("本地终端")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "未分组" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "production" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "staging" })).toBeInTheDocument();
  });

  it("moves a connection into another group from the context menu", async () => {
    const onUpdateConnection = vi.fn();

    renderConnectionList({
      connections: groupedConnections,
      connectionGroups: ["production", "staging"],
      onUpdateConnection,
    });

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "staging" }));

    expect(onUpdateConnection).toHaveBeenCalledWith({
      ...connections[0],
      group: "staging",
    });
  });

  it("removes the group field when moving a connection to the ungrouped context menu item", async () => {
    const onUpdateConnection = vi.fn();

    renderConnectionList({
      connections: groupedConnections,
      connectionGroups: ["production", "staging"],
      onUpdateConnection,
    });

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "未分组" }));

    const updatedConnection = onUpdateConnection.mock.calls[0]?.[0];
    expect(updatedConnection).toEqual({
      id: "prod-web-01",
      name: "生产 Web",
      host: "10.0.0.10",
      port: 22,
      username: "deploy",
      auth: {
        type: "password",
        password: "secret",
      },
    });
    expect(updatedConnection).not.toHaveProperty("group");
  });

  it("opens a blank connection panel context menu for creating groups and choosing sort modes", async () => {
    const onUpdateConnectionGroups = vi.fn();

    renderConnectionList({
      connections: groupedConnections,
      connectionGroups: ["production"],
      onUpdateConnectionGroups,
    });

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("连接分组列表") });
    expect(screen.getByRole("menuitem", { name: "添加连接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "添加分组" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "分组排序" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "连接排序" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem", { name: "按名称" })).toHaveLength(2);
    expect(screen.getAllByRole("menuitem", { name: "按最后连接时间" })).toHaveLength(2);
    expect(screen.getAllByRole("menuitem", { name: "按连接最多次数" })).toHaveLength(2);

    await userEvent.click(screen.getByRole("menuitem", { name: "添加分组" }));
    await userEvent.type(screen.getByLabelText("分组名称"), "aliyun");
    await userEvent.click(screen.getByRole("button", { name: "保存分组" }));

    expect(onUpdateConnectionGroups).toHaveBeenCalledWith(["production", "aliyun"]);
  });

  it("prefills all fields when copying a private key connection", async () => {
    const onAddConnection = vi.fn();

    renderConnectionList({ connections: privateKeyConnections, onAddConnection });

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("密钥 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    const dialog = screen.getByRole("dialog", { name: "复制 SSH 连接" });

    expect(within(dialog).getByLabelText("连接名称")).toHaveValue("密钥 Web");
    expect(within(dialog).getByLabelText("分组")).toHaveValue("staging");
    expect(within(dialog).getByLabelText("主机")).toHaveValue("10.0.0.20");
    expect(within(dialog).getByLabelText("端口")).toHaveValue(2222);
    expect(within(dialog).getByLabelText("用户名")).toHaveValue("ubuntu");
    expect(within(dialog).getByLabelText("认证方式")).toHaveValue("private_key");
    expect(within(dialog).getByLabelText("私钥路径")).toHaveValue("C:\\Users\\ttat\\.ssh\\id_ed25519");
    expect(within(dialog).getByLabelText("私钥口令")).toHaveValue("key-passphrase");
  });

  it("opens a remote terminal by double clicking a connection row and shows an icon before the name", async () => {
    const onOpenTerminal = vi.fn();

    const { container } = renderConnectionList({ connections, onOpenTerminal });
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
