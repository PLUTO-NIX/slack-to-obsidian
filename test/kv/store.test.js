/**
 * KV 스토어 단위 테스트
 * - userId 포함 키 생성
 * - 유저별 pending 인덱스
 * - saveTodo / getTodo
 * - listPendingTodos + stale 키 정리
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  makeKey,
  pendingIndexKey,
  saveTodo,
  getTodo,
  listPendingTodos,
} from "../../src/kv/store.js";

/**
 * Mock KV 스토어 (metadata + TTL 지원)
 */
function createMockKV() {
  const store = new Map(); // key → { value, metadata, expirationTtl }

  return {
    async get(key, opts) {
      const entry = store.get(key);
      if (!entry) return null;
      if (opts?.type === "json") return JSON.parse(entry.value);
      return entry.value;
    },
    async put(key, value, opts = {}) {
      store.set(key, {
        value: typeof value === "string" ? value : JSON.stringify(value),
        metadata: opts.metadata || null,
        expirationTtl: opts.expirationTtl || null,
      });
    },
    async list({ prefix }) {
      const keys = [];
      for (const [key, entry] of store.entries()) {
        if (key.startsWith(prefix)) {
          keys.push({ name: key, metadata: entry.metadata });
        }
      }
      return { keys };
    },
    async delete(key) {
      store.delete(key);
    },
    _store: store,
  };
}

describe("makeKey", () => {
  it("todo:{userId}:{channelId}:{messageTs} 형식", () => {
    const key = makeKey("U123", "C456", "1234.5678");
    assert.strictEqual(key, "todo:U123:C456:1234.5678");
  });
});

describe("pendingIndexKey", () => {
  it("idx:pending:{userId} 형식", () => {
    assert.strictEqual(pendingIndexKey("U123"), "idx:pending:U123");
  });
});

describe("saveTodo + getTodo", () => {
  let kv;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("pending 투두 저장 + 인덱스 추가", async () => {
    const key = makeKey("U1", "C1", "1.0");
    const data = { todo_text: "test", status: "pending" };

    await saveTodo(kv, "U1", key, data);

    // 데이터 저장 확인
    const saved = await getTodo(kv, key);
    assert.strictEqual(saved.todo_text, "test");
    assert.strictEqual(saved.status, "pending");

    // 인덱스에 추가 확인
    const index = await kv.get(pendingIndexKey("U1"), { type: "json" });
    assert.deepStrictEqual(index, [key]);
  });

  it("written 투두 저장 → 인덱스에서 제거 + TTL 설정", async () => {
    const key = makeKey("U1", "C1", "1.0");

    // 먼저 pending으로 저장
    await saveTodo(kv, "U1", key, { todo_text: "test", status: "pending" });

    // written으로 변경
    await saveTodo(kv, "U1", key, { todo_text: "test", status: "written" });

    // 인덱스에서 제거 확인
    const index = await kv.get(pendingIndexKey("U1"), { type: "json" });
    assert.deepStrictEqual(index, []);

    // TTL 설정 확인
    const entry = kv._store.get(key);
    assert.strictEqual(entry.expirationTtl, 7 * 24 * 60 * 60);
  });

  it("다른 유저의 인덱스에 영향 없음", async () => {
    const key1 = makeKey("U1", "C1", "1.0");
    const key2 = makeKey("U2", "C1", "2.0");

    await saveTodo(kv, "U1", key1, { todo_text: "user1", status: "pending" });
    await saveTodo(kv, "U2", key2, { todo_text: "user2", status: "pending" });

    const idx1 = await kv.get(pendingIndexKey("U1"), { type: "json" });
    const idx2 = await kv.get(pendingIndexKey("U2"), { type: "json" });

    assert.deepStrictEqual(idx1, [key1]);
    assert.deepStrictEqual(idx2, [key2]);
  });
});

describe("listPendingTodos", () => {
  let kv;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("유저별 pending 투두만 반환", async () => {
    await saveTodo(kv, "U1", makeKey("U1", "C1", "1.0"), {
      todo_text: "todo1",
      status: "pending",
    });
    await saveTodo(kv, "U1", makeKey("U1", "C1", "2.0"), {
      todo_text: "todo2",
      status: "pending",
    });
    await saveTodo(kv, "U2", makeKey("U2", "C1", "3.0"), {
      todo_text: "other",
      status: "pending",
    });

    const todos = await listPendingTodos(kv, "U1");
    assert.strictEqual(todos.length, 2);
    assert.ok(todos.every((t) => t.key.startsWith("todo:U1:")));
  });

  it("stale 키 자동 정리", async () => {
    // pending 투두 2개 저장
    const key1 = makeKey("U1", "C1", "1.0");
    const key2 = makeKey("U1", "C1", "2.0");
    await saveTodo(kv, "U1", key1, { todo_text: "a", status: "pending" });
    await saveTodo(kv, "U1", key2, { todo_text: "b", status: "pending" });

    // key1을 직접 삭제해서 stale 상태 시뮬레이션
    kv._store.delete(key1);

    const todos = await listPendingTodos(kv, "U1");

    // key2만 반환
    assert.strictEqual(todos.length, 1);
    assert.strictEqual(todos[0].key, key2);

    // 인덱스가 정리되었는지 확인
    const index = await kv.get(pendingIndexKey("U1"), { type: "json" });
    assert.deepStrictEqual(index, [key2]);
  });

  it("인덱스 없으면 List로 복구", async () => {
    // 인덱스 없이 직접 KV에 저장 (마이그레이션 후 시나리오)
    const key = makeKey("U1", "C1", "1.0");
    await kv.put(key, JSON.stringify({ todo_text: "a", status: "pending" }), {
      metadata: { status: "pending" },
    });

    const todos = await listPendingTodos(kv, "U1");

    assert.strictEqual(todos.length, 1);
    assert.strictEqual(todos[0].todo_text, "a");

    // 인덱스가 생성되었는지 확인
    const index = await kv.get(pendingIndexKey("U1"), { type: "json" });
    assert.deepStrictEqual(index, [key]);
  });

  it("updated 상태도 반환", async () => {
    await saveTodo(kv, "U1", makeKey("U1", "C1", "1.0"), {
      todo_text: "updated todo",
      status: "updated",
    });

    const todos = await listPendingTodos(kv, "U1");
    assert.strictEqual(todos.length, 1);
    assert.strictEqual(todos[0].status, "updated");
  });
});
