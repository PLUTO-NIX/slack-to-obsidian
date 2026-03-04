/**
 * API 토큰 인증 모듈 단위 테스트
 * - 유효한 Bearer 토큰 → ok + userId
 * - 잘못된 토큰 → 실패
 * - Authorization 헤더 없음 → 실패
 * - Bearer 접두어 없음 → 실패
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { authenticateByToken } from "../../src/user/auth.js";
import { getOrRegisterUser } from "../../src/user/registry.js";

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
  };
}

function createMockRequest(authHeader) {
  return {
    headers: {
      get(name) {
        if (name === "Authorization") return authHeader;
        return null;
      },
    },
  };
}

describe("authenticateByToken", () => {
  let kv;
  let env;
  let validToken;

  beforeEach(async () => {
    kv = createMockKV();
    env = { slack_to_obsidian: kv };

    // 테스트 유저 등록
    const user = await getOrRegisterUser("U_TEST", kv);
    validToken = user.apiToken;
  });

  it("유효한 Bearer 토큰 → ok: true + userId", async () => {
    const request = createMockRequest(`Bearer ${validToken}`);
    const result = await authenticateByToken(request, env);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.userId, "U_TEST");
  });

  it("잘못된 토큰 → ok: false", async () => {
    const request = createMockRequest("Bearer invalid-token-here");
    const result = await authenticateByToken(request, env);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.userId, null);
  });

  it("Authorization 헤더 없음 → ok: false", async () => {
    const request = createMockRequest(null);
    const result = await authenticateByToken(request, env);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.userId, null);
  });

  it("Bearer 접두어 없음 → ok: false", async () => {
    const request = createMockRequest(validToken);
    const result = await authenticateByToken(request, env);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.userId, null);
  });

  it("빈 토큰 (Bearer만) → ok: false", async () => {
    const request = createMockRequest("Bearer ");
    const result = await authenticateByToken(request, env);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.userId, null);
  });
});
