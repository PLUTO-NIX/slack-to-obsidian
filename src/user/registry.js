/**
 * 유저 등록/관리 모듈
 * KV 스키마:
 *   user:{slackUserId} → { slackUserId, apiToken, createdAt }
 *   token:{apiToken}   → { slackUserId }
 */

/**
 * 32바이트 랜덤 API 토큰 생성 (64자 hex)
 */
export function generateApiToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 유저 조회 또는 자동 등록
 * @param {string} slackUserId
 * @param {KVNamespace} kv
 * @returns {{ slackUserId: string, apiToken: string, isNew: boolean }}
 */
export async function getOrRegisterUser(slackUserId, kv) {
  const userKey = `user:${slackUserId}`;
  const existing = await kv.get(userKey, { type: "json" });

  if (existing) {
    return { ...existing, isNew: false };
  }

  // 신규 등록
  const apiToken = generateApiToken();
  const userData = {
    slackUserId,
    apiToken,
    createdAt: new Date().toISOString(),
  };

  await kv.put(userKey, JSON.stringify(userData));
  await kv.put(`token:${apiToken}`, JSON.stringify({ slackUserId }));

  return { ...userData, isNew: true };
}

/**
 * API 토큰으로 userId 조회
 * @param {string} apiToken
 * @param {KVNamespace} kv
 * @returns {string|null} slackUserId or null
 */
export async function getUserByToken(apiToken, kv) {
  const tokenData = await kv.get(`token:${apiToken}`, { type: "json" });
  return tokenData?.slackUserId || null;
}
