import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { callBackend } from "../../lib/tauri";
import { RedisWorkspace } from "./RedisWorkspace";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);

describe("RedisWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderRedisWorkspace(props: React.ComponentProps<typeof RedisWorkspace>) {
    return render(
      <I18nProvider language="zh-CN">
        <RedisWorkspace {...props} />
      </I18nProvider>,
    );
  }

  it("loads Redis keys for the selected connection and database", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 12000,
      entries: [
        { key: "user:1", key_type: "hash", ttl: -1 },
        { key: "cache:token", key_type: "string", ttl: 3600 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 1 });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("list_redis_keys", {
        request: {
          connection_id: "redis-local",
          database: 1,
          pattern: "*",
          count: 5000,
        },
      });
    });
    expect(screen.getByLabelText("Redis key 列表")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "展开 user" }));
    await userEvent.click(screen.getByRole("button", { name: "展开 cache" }));
    expect(await screen.findByText("user:1")).toBeInTheDocument();
    expect(screen.getByText("hash")).toBeInTheDocument();
    expect(screen.getByText("永不过期")).toBeInTheDocument();
    expect(screen.getByText("3600")).toBeInTheDocument();
    expect(screen.getByText("共 12000 条数据，已加载 2 条")).toBeInTheDocument();
    expect(screen.getByLabelText("加载数量")).toHaveValue(5000);
  });

  it("refreshes Redis keys with the edited database, fuzzy keyword, and load limit", async () => {
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });
    callBackendMock.mockResolvedValueOnce({
      total_count: 320,
      entries: [
        { key: "session:1", key_type: "string", ttl: -1 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await waitFor(() => expect(callBackendMock).toHaveBeenCalledTimes(1));
    await userEvent.clear(screen.getByLabelText("Redis 数据库"));
    await userEvent.type(screen.getByLabelText("Redis 数据库"), "2");
    expect(screen.queryByLabelText("Key pattern")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("关键字模糊匹配"), "session");
    await userEvent.clear(screen.getByLabelText("加载数量"));
    await userEvent.type(screen.getByLabelText("加载数量"), "2000");
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenLastCalledWith("list_redis_keys", {
        request: {
          connection_id: "redis-local",
          database: 2,
          pattern: "*session*",
          count: 2000,
        },
      });
    });
    await userEvent.click(await screen.findByRole("button", { name: "展开 session" }));
    expect(await screen.findByText("session:1")).toBeInTheDocument();
    expect(screen.getByText("共 320 条数据，已加载 1 条")).toBeInTheDocument();
  });

  it("refreshes Redis keys when pressing Enter in the keyword input", async () => {
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "session:enter", key_type: "string", ttl: -1 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await waitFor(() => expect(callBackendMock).toHaveBeenCalledTimes(1));
    await userEvent.type(screen.getByLabelText("关键字模糊匹配"), "session{Enter}");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenLastCalledWith("list_redis_keys", {
        request: {
          connection_id: "redis-local",
          database: 0,
          pattern: "*session*",
          count: 5000,
        },
      });
    });
  });

  it("groups loaded keys by the editable separator", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 4,
      entries: [
        { key: "user:1", key_type: "hash", ttl: -1 },
        { key: "user:2", key_type: "string", ttl: 120 },
        { key: "order_item_1", key_type: "string", ttl: -1 },
        { key: "plain", key_type: "string", ttl: -1 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    expect(await screen.findByRole("button", { name: "展开 user" })).toBeInTheDocument();
    expect(screen.getByLabelText("Key 分隔符")).toHaveValue(":");
    expect(screen.queryByText("user:1")).not.toBeInTheDocument();
    expect(screen.queryByText("user:2")).not.toBeInTheDocument();
    expect(screen.getByText("plain")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开 user" }));
    expect(screen.getByText("user:1")).toBeInTheDocument();
    expect(screen.getByText("user:2")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Key 分隔符"));
    await userEvent.type(screen.getByLabelText("Key 分隔符"), "_");

    expect(await screen.findByRole("button", { name: "展开 order" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "展开 order/item" })).not.toBeInTheDocument();
    expect(screen.queryByText("order_item_1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开 order" }));
    await userEvent.click(screen.getByRole("button", { name: "展开 order/item" }));
    expect(screen.getByText("order_item_1")).toBeInTheDocument();
  });

  it("keeps keys with the same folder prefix together when scan results are interleaved", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 5,
      entries: [
        { key: "dev:dict:first", key_type: "string", ttl: -1 },
        { key: "prod:dict:value", key_type: "string", ttl: -1 },
        { key: "dev:dict:second", key_type: "string", ttl: -1 },
        { key: "dev:dict:nested:value", key_type: "string", ttl: -1 },
        { key: "prod:dict:next", key_type: "string", ttl: -1 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    expect(await screen.findByRole("button", { name: "展开 dev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 prod" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "展开 dev" }));
    await userEvent.click(screen.getByRole("button", { name: "展开 dev/dict" }));
    await userEvent.click(screen.getByRole("button", { name: "展开 prod" }));

    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const devIndex = rows.findIndex((row) => row.includes("dev"));
    const devFirstIndex = rows.findIndex((row) => row.includes("dev:dict:first"));
    const devSecondIndex = rows.findIndex((row) => row.includes("dev:dict:second"));
    const nestedIndex = rows.findIndex((row) => row.includes("nested"));
    const prodIndex = rows.findIndex((row) => row.includes("prod"));

    expect(devIndex).toBeLessThan(devFirstIndex);
    expect(devFirstIndex).toBeLessThan(devSecondIndex);
    expect(devSecondIndex).toBeLessThan(nestedIndex);
    expect(nestedIndex).toBeLessThan(prodIndex);
  });

  it("opens a read-only Redis key detail dialog by double clicking a key row", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "user:1", key_type: "string", ttl: 3600 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "user:1",
      key_type: "string",
      ttl: 3600,
      value: {
        kind: "string",
        value: "{\"name\":\"devhub\"}",
        truncated: false,
        size: 17,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 user" }));
    await userEvent.dblClick(screen.getByText("user:1"));

    expect(callBackendMock).toHaveBeenLastCalledWith("get_redis_key_value", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "user:1",
        limit: 500,
        max_string_bytes: 5 * 1024 * 1024,
      },
    });
    const dialog = await screen.findByRole("dialog", { name: "查看 user:1" });
    expect(dialog).toHaveTextContent("类型 string");
    expect(dialog).toHaveTextContent("TTL 3600");
    expect(dialog).toHaveTextContent("大小 17 B");
    expect(dialog).toHaveTextContent("{\"name\":\"devhub\"}");

    await userEvent.click(screen.getByRole("button", { name: "关闭 Redis key 详情" }));
    expect(screen.queryByRole("dialog", { name: "查看 user:1" })).not.toBeInTheDocument();
  });

  it("shows Redis hash key details in the read-only dialog", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "profile:1", key_type: "hash", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "profile:1",
      key_type: "hash",
      ttl: -1,
      value: {
        kind: "hash",
        entries: [["name", "devhub"]],
        truncated: false,
        length: 1,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 profile" }));
    await userEvent.dblClick(screen.getByText("profile:1"));

    const dialog = await screen.findByRole("dialog", { name: "查看 profile:1" });
    expect(dialog).toHaveTextContent("长度 1");
    expect(dialog).toHaveTextContent("name");
    expect(within(dialog).getByLabelText("字段 name 的值")).toHaveValue("devhub");
  });

  it("saves edited Redis string content and reloads the detail", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "config:theme", key_type: "string", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "config:theme",
      key_type: "string",
      ttl: -1,
      value: {
        kind: "string",
        value: "dark",
        truncated: false,
        size: 4,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "config:theme",
      key_type: "string",
      ttl: -1,
      value: {
        kind: "string",
        value: "light",
        truncated: false,
        size: 5,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 config" }));
    await userEvent.dblClick(screen.getByText("config:theme"));
    const editor = await screen.findByLabelText("Redis string 内容");
    await userEvent.clear(editor);
    await userEvent.type(editor, "light");
    await userEvent.click(screen.getByRole("button", { name: "保存内容" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_string_value", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "config:theme",
        value: "light",
      },
    });
    await waitFor(() => expect(screen.getByLabelText("Redis string 内容")).toHaveValue("light"));
  });

  it("edits Redis hash fields from the detail dialog", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "profile:1", key_type: "hash", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "profile:1",
      key_type: "hash",
      ttl: -1,
      value: {
        kind: "hash",
        entries: [["name", "devhub"]],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "profile:1",
      key_type: "hash",
      ttl: -1,
      value: {
        kind: "hash",
        entries: [["name", "devhub-app"]],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "profile:1",
      key_type: "hash",
      ttl: -1,
      value: {
        kind: "hash",
        entries: [
          ["name", "devhub-app"],
          ["role", "admin"],
        ],
        truncated: false,
        length: 2,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "profile:1",
      key_type: "hash",
      ttl: -1,
      value: {
        kind: "hash",
        entries: [["role", "admin"]],
        truncated: false,
        length: 1,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 profile" }));
    await userEvent.dblClick(screen.getByText("profile:1"));
    const valueInput = await screen.findByLabelText("字段 name 的值");
    await userEvent.clear(valueInput);
    await userEvent.type(valueInput, "devhub-app");
    await userEvent.click(screen.getByRole("button", { name: "保存字段 name" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_hash_field", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "profile:1",
        field: "name",
        value: "devhub-app",
      },
    });
    await waitFor(() => expect(screen.getByLabelText("字段 name 的值")).toHaveValue("devhub-app"));

    await userEvent.type(screen.getByLabelText("新字段名"), "role");
    await userEvent.type(screen.getByLabelText("新字段值"), "admin");
    await userEvent.click(screen.getByRole("button", { name: "添加字段" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_hash_field", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "profile:1",
        field: "role",
        value: "admin",
      },
    });
    await waitFor(() => expect(screen.getByLabelText("字段 role 的值")).toHaveValue("admin"));

    await userEvent.click(screen.getByRole("button", { name: "删除字段 name" }));

    expect(callBackendMock).toHaveBeenCalledWith("delete_redis_hash_field", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "profile:1",
        field: "name",
      },
    });
  });

  it("edits Redis list items from the detail dialog", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "queue", key_type: "list", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "queue",
      key_type: "list",
      ttl: -1,
      value: {
        kind: "list",
        items: ["one"],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "queue",
      key_type: "list",
      ttl: -1,
      value: {
        kind: "list",
        items: ["two"],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "queue",
      key_type: "list",
      ttl: -1,
      value: {
        kind: "list",
        items: ["two", "three"],
        truncated: false,
        length: 2,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "queue",
      key_type: "list",
      ttl: -1,
      value: {
        kind: "list",
        items: ["three"],
        truncated: false,
        length: 1,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.dblClick(await screen.findByText("queue"));
    const itemInput = await screen.findByLabelText("第 0 个元素");
    await userEvent.clear(itemInput);
    await userEvent.type(itemInput, "two");
    await userEvent.click(screen.getByRole("button", { name: "保存第 0 个元素" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_list_item", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "queue",
        index: 0,
        value: "two",
      },
    });

    await userEvent.type(screen.getByLabelText("新元素"), "three");
    await userEvent.click(screen.getByRole("button", { name: "添加元素" }));

    expect(callBackendMock).toHaveBeenCalledWith("append_redis_list_item", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "queue",
        value: "three",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "删除第 0 个元素" }));

    expect(callBackendMock).toHaveBeenCalledWith("delete_redis_list_item", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "queue",
        index: 0,
      },
    });
  });

  it("edits Redis set members from the detail dialog", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "tags", key_type: "set", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "tags",
      key_type: "set",
      ttl: -1,
      value: {
        kind: "set",
        members: ["dev"],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "tags",
      key_type: "set",
      ttl: -1,
      value: {
        kind: "set",
        members: ["dev", "prod"],
        truncated: false,
        length: 2,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "tags",
      key_type: "set",
      ttl: -1,
      value: {
        kind: "set",
        members: ["prod"],
        truncated: false,
        length: 1,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.dblClick(await screen.findByText("tags"));
    await userEvent.type(await screen.findByLabelText("新成员"), "prod");
    await userEvent.click(screen.getByRole("button", { name: "添加成员" }));

    expect(callBackendMock).toHaveBeenCalledWith("add_redis_set_member", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "tags",
        member: "prod",
      },
    });

    await userEvent.click(await screen.findByRole("button", { name: "删除成员 dev" }));

    expect(callBackendMock).toHaveBeenCalledWith("delete_redis_set_member", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "tags",
        member: "dev",
      },
    });
  });

  it("edits Redis zset entries from the detail dialog", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "rank", key_type: "zset", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "rank",
      key_type: "zset",
      ttl: -1,
      value: {
        kind: "zset",
        entries: [["alice", 1]],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "rank",
      key_type: "zset",
      ttl: -1,
      value: {
        kind: "zset",
        entries: [["alice", 2]],
        truncated: false,
        length: 1,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "rank",
      key_type: "zset",
      ttl: -1,
      value: {
        kind: "zset",
        entries: [
          ["alice", 2],
          ["bob", 3],
        ],
        truncated: false,
        length: 2,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "rank",
      key_type: "zset",
      ttl: -1,
      value: {
        kind: "zset",
        entries: [["bob", 3]],
        truncated: false,
        length: 1,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.dblClick(await screen.findByText("rank"));
    const scoreInput = await screen.findByLabelText("成员 alice 的分数");
    await userEvent.clear(scoreInput);
    await userEvent.type(scoreInput, "2");
    await userEvent.click(screen.getByRole("button", { name: "保存成员 alice" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_zset_member", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "rank",
        member: "alice",
        score: "2",
      },
    });

    await userEvent.type(screen.getByLabelText("新成员"), "bob");
    await userEvent.clear(screen.getByLabelText("新分数"));
    await userEvent.type(screen.getByLabelText("新分数"), "3");
    await userEvent.click(screen.getByRole("button", { name: "添加成员" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_zset_member", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "rank",
        member: "bob",
        score: "3",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "删除成员 alice" }));

    expect(callBackendMock).toHaveBeenCalledWith("delete_redis_zset_member", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "rank",
        member: "alice",
      },
    });
  });

  it("sets and removes Redis key ttl from the detail dialog", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "session:1", key_type: "string", ttl: -1 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "session:1",
      key_type: "string",
      ttl: -1,
      value: {
        kind: "string",
        value: "token",
        truncated: false,
        size: 5,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "session:1",
      key_type: "string",
      ttl: 60,
      value: {
        kind: "string",
        value: "token",
        truncated: false,
        size: 5,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      key: "session:1",
      key_type: "string",
      ttl: -1,
      value: {
        kind: "string",
        value: "token",
        truncated: false,
        size: 5,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 session" }));
    await userEvent.dblClick(screen.getByText("session:1"));
    await userEvent.clear(await screen.findByLabelText("TTL 秒数"));
    await userEvent.type(screen.getByLabelText("TTL 秒数"), "60");
    await userEvent.click(screen.getByRole("button", { name: "设置 TTL" }));

    expect(callBackendMock).toHaveBeenCalledWith("set_redis_key_ttl", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "session:1",
        ttl_seconds: 60,
      },
    });
    await waitFor(() => expect(screen.getByText("TTL 60")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "移除 TTL" }));

    expect(callBackendMock).toHaveBeenCalledWith("persist_redis_key", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "session:1",
      },
    });
    await waitFor(() => expect(screen.getByText("TTL 永不过期")).toBeInTheDocument());
  });

  it("deletes a Redis key after confirmation and refreshes the key list", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "temp:1", key_type: "string", ttl: 30 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "temp:1",
      key_type: "string",
      ttl: 30,
      value: {
        kind: "string",
        value: "value",
        truncated: false,
        size: 5,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 temp" }));
    await userEvent.dblClick(screen.getByText("temp:1"));
    await userEvent.click(await screen.findByRole("button", { name: "删除 key" }));
    expect(screen.getByRole("dialog", { name: "确认删除 Redis key" })).toHaveTextContent(
      "确认删除 temp:1？该操作不可逆！",
    );
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(callBackendMock).toHaveBeenCalledWith("delete_redis_key", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "temp:1",
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "查看 temp:1" })).not.toBeInTheDocument());
    expect(await screen.findByText("没有匹配的 key")).toBeInTheDocument();
  });

  it("closes Redis detail dialogs with Escape", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "temp:1", key_type: "string", ttl: 30 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "temp:1",
      key_type: "string",
      ttl: 30,
      value: {
        kind: "string",
        value: "value",
        truncated: false,
        size: 5,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 temp" }));
    await userEvent.dblClick(screen.getByText("temp:1"));
    expect(await screen.findByRole("dialog", { name: "查看 temp:1" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "查看 temp:1" })).not.toBeInTheDocument();
  });

  it("shows Redis key context menu actions for editing and deleting a key", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "temp:1", key_type: "string", ttl: 30 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "temp:1",
      key_type: "string",
      ttl: 30,
      value: {
        kind: "string",
        value: "value",
        truncated: false,
        size: 5,
      },
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 temp" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("temp:1") });
    expect(screen.getByRole("menuitem", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    expect(await screen.findByRole("dialog", { name: "查看 temp:1" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "关闭 Redis key 详情" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("temp:1") });
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "确认删除 Redis key" })).toHaveTextContent(
      "确认删除 temp:1？该操作不可逆！",
    );
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(callBackendMock).toHaveBeenCalledWith("delete_redis_key", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "temp:1",
      },
    });
  });

  it("renames a Redis key from the context menu and opens the renamed key detail", async () => {
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "temp:1", key_type: "string", ttl: 30 },
      ],
    });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "temp:renamed", key_type: "string", ttl: 30 },
      ],
    });
    callBackendMock.mockResolvedValueOnce({
      key: "temp:renamed",
      key_type: "string",
      ttl: 30,
      value: {
        kind: "string",
        value: "value",
        truncated: false,
        size: 5,
      },
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await userEvent.click(await screen.findByRole("button", { name: "展开 temp" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("temp:1") });
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名 Redis key" });
    await userEvent.clear(within(dialog).getByLabelText("新 key 名称"));
    await userEvent.type(within(dialog).getByLabelText("新 key 名称"), "temp:renamed");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(callBackendMock).toHaveBeenCalledWith("rename_redis_key", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "temp:1",
        new_key: "temp:renamed",
      },
    });
    expect(await screen.findByRole("dialog", { name: "查看 temp:renamed" })).toBeInTheDocument();
  });

  it("creates a Redis hash key from the toolbar without opening the new key detail", async () => {
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "user:1", key_type: "hash", ttl: 60 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await waitFor(() => expect(callBackendMock).toHaveBeenCalledTimes(1));
    const toolbarButtons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(toolbarButtons.indexOf("新建 key")).toBeLessThan(toolbarButtons.indexOf("刷新"));
    await userEvent.click(screen.getByRole("button", { name: "新建 key" }));
    const dialog = screen.getByRole("dialog", { name: "新建 Redis key" });
    await userEvent.type(within(dialog).getByLabelText("Key 名称"), "user:1");
    await userEvent.selectOptions(within(dialog).getByLabelText("类型"), "hash");
    await userEvent.clear(within(dialog).getByLabelText("字段名"));
    await userEvent.type(within(dialog).getByLabelText("字段名"), "name");
    await userEvent.type(within(dialog).getByLabelText("字段值"), "devhub");
    await userEvent.click(within(dialog).getByRole("button", { name: "添加条目" }));
    const fieldInputs = within(dialog).getAllByLabelText("字段名");
    const valueInputs = within(dialog).getAllByLabelText("字段值");
    await userEvent.type(fieldInputs[1], "role");
    await userEvent.type(valueInputs[1], "admin");
    await userEvent.click(within(dialog).getAllByRole("button", { name: "删除条目" })[0]);
    await userEvent.type(within(dialog).getByLabelText("TTL 秒数"), "60");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(callBackendMock).toHaveBeenCalledWith("create_redis_key", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "user:1",
        key_type: "hash",
        ttl_seconds: 60,
        string_value: "",
        hash_entries: [{ field: "role", value: "admin" }],
        list_items: [""],
        set_members: [""],
        zset_entries: [{ member: "", score: "0" }],
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建 Redis key" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "查看 user:1" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "展开 user" }));
    expect(screen.getByText("user:1")).toBeInTheDocument();
  });

  it("creates a Redis set key with item rows from the toolbar", async () => {
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce({
      total_count: 1,
      entries: [
        { key: "tags", key_type: "set", ttl: -1 },
      ],
    });

    renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    await waitFor(() => expect(callBackendMock).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "新建 key" }));
    const dialog = screen.getByRole("dialog", { name: "新建 Redis key" });
    await userEvent.type(within(dialog).getByLabelText("Key 名称"), "tags");
    await userEvent.selectOptions(within(dialog).getByLabelText("类型"), "set");
    await userEvent.type(within(dialog).getByLabelText("成员"), "dev");
    await userEvent.click(within(dialog).getByRole("button", { name: "添加成员" }));
    const memberInputs = within(dialog).getAllByLabelText("成员");
    await userEvent.type(memberInputs[1], "prod");
    await userEvent.click(within(dialog).getAllByRole("button", { name: "删除条目" })[0]);
    await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));

    expect(callBackendMock).toHaveBeenCalledWith("create_redis_key", {
      request: {
        connection_id: "redis-local",
        database: 0,
        key: "tags",
        key_type: "set",
        ttl_seconds: null,
        string_value: "",
        hash_entries: [{ field: "", value: "" }],
        list_items: [""],
        set_members: ["prod"],
        zset_entries: [{ member: "", score: "0" }],
      },
    });
  });

  it("shows an empty state and load errors", async () => {
    callBackendMock.mockResolvedValueOnce({ total_count: 0, entries: [] });

    const { rerender } = renderRedisWorkspace({ connectionId: "redis-local", initialDatabase: 0 });

    expect(await screen.findByText("没有匹配的 key")).toBeInTheDocument();

    callBackendMock.mockRejectedValueOnce(new Error("NOAUTH Authentication required"));
    rerender(
      <I18nProvider language="zh-CN">
        <RedisWorkspace connectionId="redis-prod" initialDatabase={0} />
      </I18nProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("NOAUTH Authentication required");
  });
});
