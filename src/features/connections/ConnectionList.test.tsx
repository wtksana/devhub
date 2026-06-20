import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionList } from "./ConnectionList";
import type { ConnectionSettings } from "../settings/settingsTypes";
import { pickPrivateKeyFile } from "../../lib/fileDialog";
import { I18nProvider } from "../../i18n/I18nProvider";
import { callBackend } from "../../lib/tauri";

vi.mock("../../lib/fileDialog", () => ({
  pickPrivateKeyFile: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

const pickPrivateKeyFileMock = vi.mocked(pickPrivateKeyFile);
const callBackendMock = vi.mocked(callBackend);

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

const redisConnections: ConnectionSettings[] = [
  {
    kind: "redis",
    id: "redis-local",
    name: "本地 Redis",
    group: "local",
    host: "127.0.0.1",
    port: 6379,
    database: 1,
    password: "redis-password",
  },
];

describe("ConnectionList", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderConnectionList(props: Partial<React.ComponentProps<typeof ConnectionList>> = {}) {
    return render(
      <I18nProvider language="zh-CN">
        <ConnectionList
          connections={[]}
          onOpenTerminal={vi.fn()}
          onOpenNewTerminal={vi.fn()}
          onOpenSftp={vi.fn()}
          onOpenRedis={vi.fn()}
          onOpenDatabase={vi.fn()}
          onAddConnection={vi.fn()}
          onUpdateConnection={vi.fn()}
          connectionGroups={[]}
          onUpdateConnectionGroups={vi.fn()}
          {...props}
        />
      </I18nProvider>,
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

  it("submits a Redis connection and stores the real password", async () => {
    const onAddConnection = vi.fn();
    callBackendMock.mockResolvedValue("PONG");

    renderConnectionList({ onAddConnection });

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "redis");
    expect(screen.getByRole("dialog", { name: "添加 Redis 连接" })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "本地 Redis");
    await userEvent.type(within(dialog).getByLabelText("分组"), "local");
    await userEvent.type(within(dialog).getByLabelText("主机"), "127.0.0.1");
    expect(within(dialog).getByLabelText("端口")).toHaveValue(6379);
    await userEvent.clear(within(dialog).getByLabelText("数据库"));
    await userEvent.type(within(dialog).getByLabelText("数据库"), "1");
    await userEvent.type(within(dialog).getByLabelText("Redis 密码"), "redis-password");
    await userEvent.click(within(dialog).getByRole("button", { name: "测试连接" }));

    expect(callBackendMock).toHaveBeenCalledWith("test_redis_connection_config", {
      connection: {
        kind: "redis",
        id: "redis-form-test",
        name: "本地 Redis",
        host: "127.0.0.1",
        port: 6379,
        database: 1,
        group: "local",
        password: "redis-password",
      },
    });
    expect(await within(dialog).findByRole("status")).toHaveTextContent("本地 Redis 测试成功：PONG");
    expect(screen.queryByText("本地 Redis 测试成功：PONG", { selector: ".connection-list__status" })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "保存连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({
      kind: "redis",
      id: expect.stringMatching(/^redis-/),
      name: "本地 Redis",
      group: "local",
      host: "127.0.0.1",
      port: 6379,
      database: 1,
      password: "redis-password",
    });
  });

  it("submits a MySQL connection with username and password", async () => {
    const onAddConnection = vi.fn();

    renderConnectionList({ onAddConnection });

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "mysql");
    expect(screen.getByRole("dialog", { name: "添加 MySQL 连接" })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "开发 MySQL");
    await userEvent.type(within(dialog).getByLabelText("分组"), "database");
    await userEvent.type(within(dialog).getByLabelText("主机"), "127.0.0.1");
    expect(within(dialog).getByLabelText("端口")).toHaveValue(3306);
    await userEvent.type(within(dialog).getByLabelText("用户名"), "root");
    await userEvent.type(within(dialog).getByLabelText("密码"), "mysql-password");
    await userEvent.type(within(dialog).getByLabelText("默认数据库"), "app");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({
      kind: "mysql",
      id: expect.stringMatching(/^mysql-/),
      name: "开发 MySQL",
      group: "database",
      host: "127.0.0.1",
      port: 3306,
      username: "root",
      password: "mysql-password",
      database: "app",
    });
  });

  it("submits a PostgreSQL connection with default port and optional database", async () => {
    const onAddConnection = vi.fn();

    renderConnectionList({ onAddConnection });

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "postgresql");
    expect(screen.getByRole("dialog", { name: "添加 PostgreSQL 连接" })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "开发 PostgreSQL");
    await userEvent.type(within(dialog).getByLabelText("主机"), "127.0.0.1");
    expect(within(dialog).getByLabelText("端口")).toHaveValue(5432);
    await userEvent.type(within(dialog).getByLabelText("用户名"), "postgres");
    await userEvent.type(within(dialog).getByLabelText("密码"), "postgres-password");
    await userEvent.click(within(dialog).getByRole("button", { name: "保存连接" }));

    expect(onAddConnection).toHaveBeenCalledWith({
      kind: "postgresql",
      id: expect.stringMatching(/^postgresql-/),
      name: "开发 PostgreSQL",
      host: "127.0.0.1",
      port: 5432,
      username: "postgres",
      password: "postgres-password",
    });
  });

  it("clears password when switching connection types before saving", async () => {
    const onAddConnection = vi.fn();

    renderConnectionList({ onAddConnection });

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "切换 MySQL");
    await userEvent.type(within(dialog).getByLabelText("主机"), "127.0.0.1");
    await userEvent.type(within(dialog).getByLabelText("用户名"), "root");
    await userEvent.type(within(dialog).getByLabelText("密码"), "ssh-password");

    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "mysql");
    expect(within(dialog).getByLabelText("密码")).toHaveValue("");
    await userEvent.type(within(dialog).getByLabelText("密码"), "mysql-password");

    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "redis");
    expect(within(dialog).getByLabelText("Redis 密码")).toHaveValue("");
    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "mysql");
    expect(within(dialog).getByLabelText("密码")).toHaveValue("");
  });

  it("prefills fields when copying a database connection", async () => {
    const onAddConnection = vi.fn();

    renderConnectionList({
      connections: [
        {
          kind: "mysql",
          id: "mysql-local",
          name: "本地 MySQL",
          group: "database",
          host: "127.0.0.1",
          port: 3306,
          username: "root",
          password: "mysql-password",
          database: "app",
        },
      ],
      onAddConnection,
    });

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("本地 MySQL") });
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    const dialog = screen.getByRole("dialog", { name: "复制 MySQL 连接" });

    expect(within(dialog).getByLabelText("连接类型")).toHaveValue("mysql");
    expect(within(dialog).getByLabelText("连接名称")).toHaveValue("本地 MySQL");
    expect(within(dialog).getByLabelText("分组")).toHaveValue("database");
    expect(within(dialog).getByLabelText("主机")).toHaveValue("127.0.0.1");
    expect(within(dialog).getByLabelText("端口")).toHaveValue(3306);
    expect(within(dialog).getByLabelText("用户名")).toHaveValue("root");
    expect(within(dialog).getByLabelText("密码")).toHaveValue("mysql-password");
    expect(within(dialog).getByLabelText("默认数据库")).toHaveValue("app");
  });

  it("opens database connections without SSH or Redis actions", async () => {
    const onOpenTerminal = vi.fn();
    const onOpenRedis = vi.fn();
    const onOpenSftp = vi.fn();
    const onOpenDatabase = vi.fn();

    renderConnectionList({
      connections: [
        {
          kind: "postgresql",
          id: "postgres-local",
          name: "本地 PostgreSQL",
          host: "127.0.0.1",
          port: 5432,
          username: "postgres",
          password: "postgres-password",
        },
      ],
      onOpenTerminal,
      onOpenRedis,
      onOpenSftp,
      onOpenDatabase,
    });

    const connectionItem = screen.getByText("本地 PostgreSQL").closest("li");
    expect(connectionItem).not.toBeNull();
    expect(within(connectionItem as HTMLElement).getByText("postgresql://postgres@127.0.0.1:5432")).toBeInTheDocument();
    expect(within(connectionItem as HTMLElement).getByRole("img", { name: "PostgreSQL 连接" })).toBeInTheDocument();

    await userEvent.dblClick(connectionItem as HTMLElement);
    expect(onOpenDatabase).toHaveBeenCalledWith("postgres-local");
    expect(onOpenTerminal).not.toHaveBeenCalled();
    expect(onOpenRedis).not.toHaveBeenCalled();

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("本地 PostgreSQL") });
    expect(screen.queryByRole("menuitem", { name: "连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "新标签连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "SFTP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "测试连接" })).not.toBeInTheDocument();
    expect(onOpenSftp).not.toHaveBeenCalled();
  });

  it("validates Redis connection fields before testing from the dialog", async () => {
    renderConnectionList();

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加 SSH 连接" });
    await userEvent.selectOptions(within(dialog).getByLabelText("连接类型"), "redis");
    await userEvent.type(within(dialog).getByLabelText("连接名称"), "未填写主机 Redis");
    await userEvent.click(within(dialog).getByRole("button", { name: "测试连接" }));

    expect(callBackendMock).not.toHaveBeenCalled();
    expect(await within(dialog).findByRole("status")).toHaveTextContent("请填写主机");
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

  it("shows Redis connections and opens them instead of terminal or SFTP", async () => {
    const onOpenTerminal = vi.fn();
    const onOpenSftp = vi.fn();
    const onOpenRedis = vi.fn();

    renderConnectionList({ connections: redisConnections, onOpenTerminal, onOpenSftp, onOpenRedis });

    const connectionItem = screen.getByText("本地 Redis").closest("li");
    expect(connectionItem).not.toBeNull();
    expect(within(connectionItem as HTMLElement).getByText("redis://127.0.0.1:6379/1")).toBeInTheDocument();
    const icon = within(connectionItem as HTMLElement).getByRole("img", { name: "Redis 连接" });
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("src", expect.stringContaining("devicon--redis"));

    await userEvent.dblClick(connectionItem as HTMLElement);
    expect(onOpenRedis).toHaveBeenCalledWith("redis-local");
    expect(callBackendMock).not.toHaveBeenCalledWith("test_redis_connection", { connectionId: "redis-local" });
    expect(onOpenTerminal).not.toHaveBeenCalled();

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("本地 Redis") });
    expect(screen.getByRole("menuitem", { name: "测试连接" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "SFTP" })).not.toBeInTheDocument();
    expect(onOpenSftp).not.toHaveBeenCalled();
  });
});
