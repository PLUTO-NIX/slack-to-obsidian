/**
 * 유저 등록/관리 모듈 단위 테스트
 * - 토큰 생성 형식 검증
 * - 신규 유저 등록
 * - 기존 유저 조회 (재등록 방지)
 * - 토큰으로 userId 역조회
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  generateApiToken,
  getOrRegisterUser,
  getUserByToken,
} from "../../src/user/registry.js";

/**
 * Mock KV 스토어
 */
function createMockKV() {
  const store = new Map();
  return {
    async get(key, opts) {
      const val = store.get(key);
      if (val === undefined) return null;
      if (opts?.type === "json") return JSON.parse(val);
      return val;
    },
    async put(key, value) {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    _store: store,
  };
}

describe("generateApiToken", () => {
  it("64자 hex 문자열 반환", () => {
    const token = generateApiToken();
    assert.strictEqual(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it("호출할 때마다 다른 토큰 생성", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    assert.notStrictEqual(a, b);
  });
});

describe("getOrRegisterUser", () => {
  let kv;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("신규 유저 등록 시 isNew=true + KV에 user/token 레코드 생성", async () => {
    const result = await getOrRegisterUser("U12345", kv);

    assert.strictEqual(result.isNew, true);
    assert.strictEqual(result.slackUserId, "U12345");
    assert.strictEqual(result.apiToken.length, 64);

    // KV에 user 레코드 저장 확인
    const userData = await kv.get("user:U12345", { type: "json" });
    assert.strictEqual(userData.slackUserId, "U12345");
    assert.strictEqual(userData.apiToken, result.apiToken);

    // KV에 token 역참조 저장 확인
    const tokenData = await kv.get(`token:${result.apiToken}`, {
      type: "json",
    });
    assert.strictEqual(tokenData.slackUserId, "U12345");
  });

  it("기존 유저 조회 시 isNew=false + 동일 데이터 반환", async () => {
    // 먼저 등록
    const first = await getOrRegisterUser("U12345", kv);

    // 같은 유저 다시 조회
    const second = await getOrRegisterUser("U12345", kv);

    assert.strictEqual(second.isNew, false);
    assert.strictEqual(second.apiToken, first.apiToken);
    assert.strictEqual(second.slackUserId, "U12345");
  });

  it("다른 유저는 독립적으로 등록", async () => {
    const user1 = await getOrRegisterUser("U11111", kv);
    const user2 = await getOrRegisterUser("U22222", kv);

    assert.notStrictEqual(user1.apiToken, user2.apiToken);
    assert.strictEqual(user1.slackUserId, "U11111");
    assert.strictEqual(user2.slackUserId, "U22222");
  });
});

describe("getUserByToken", () => {
  let kv;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("유효한 토큰 → userId 반환", async () => {
    const user = await getOrRegisterUser("U12345", kv);
    const userId = await getUserByToken(user.apiToken, kv);
    assert.strictEqual(userId, "U12345");
  });

  it("존재하지 않는 토큰 → null 반환", async () => {
    const result = await getUserByToken("nonexistent-token", kv);
    assert.strictEqual(result, null);
  });
});
