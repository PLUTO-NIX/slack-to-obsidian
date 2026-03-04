/**
 * Cloudflare KV 저장소 헬퍼
 * 키 형식: "todo:{userId}:{channelId}:{messageTs}"
 * 인덱스: "idx:pending:{userId}" — 유저별 pending/updated 키 목록
 */

/**
 * KV 키 생성 (userId 포함)
 */
export function makeKey(userId, channelId, messageTs) {
  return `todo:${userId}:${channelId}:${messageTs}`;
}

/**
 * 유저별 pending 인덱스 키
 */
export function pendingIndexKey(userId) {
  return `idx:pending:${userId}`;
}

/**
 * 인덱스에 키 추가
 */
async function addToPendingIndex(kv, userId, key) {
  const idxKey = pendingIndexKey(userId);
  const index = (await kv.get(idxKey, { type: "json" })) || [];
  if (!index.includes(key)) {
    index.push(key);
    await kv.put(idxKey, JSON.stringify(index));
  }
}

/**
 * 인덱스에서 키 제거
 */
async function removeFromPendingIndex(kv, userId, key) {
  const idxKey = pendingIndexKey(userId);
  const index = (await kv.get(idxKey, { type: "json" })) || [];
  const filtered = index.filter((k) => k !== key);
  if (filtered.length !== index.length) {
    await kv.put(idxKey, JSON.stringify(filtered));
  }
}

/**
 * 투두 데이터 저장
 * @param {KVNamespace} kv
 * @param {string} userId
 * @param {string} key
 * @param {object} data
 */
export async function saveTodo(kv, userId, key, data) {
  const options = {
    ...(data.status === "written" && {
      expirationTtl: 7 * 24 * 60 * 60,
    }),
    metadata: { status: data.status },
  };

  await kv.put(key, JSON.stringify(data), options);

  if (data.status === "pending" || data.status === "updated") {
    await addToPendingIndex(kv, userId, key);
  } else if (data.status === "written") {
    await removeFromPendingIndex(kv, userId, key);
  }
}

/**
 * 투두 데이터 조회
 * @param {KVNamespace} kv
 * @param {string} key
 * @returns {object|null}
 */
export async function getTodo(kv, key) {
  return await kv.get(key, { type: "json" });
}

/**
 * 유저별 Pending/Updated 상태의 모든 투두 조회
 * idx:pending:{userId} 인덱스 사용 + stale 키 자동 정리
 * @param {KVNamespace} kv
 * @param {string} userId
 * @returns {Array<object>}
 */
export async function listPendingTodos(kv, userId) {
  const idxKey = pendingIndexKey(userId);
  const indexRaw = await kv.get(idxKey, { type: "json" });
  let keysToFetch;

  if (indexRaw === null) {
    // 인덱스 없으면 List로 복구 (userId 접두어로 필터)
    const list = await kv.list({ prefix: `todo:${userId}:` });
    keysToFetch = [];
    for (const k of list.keys) {
      const status = k.metadata?.status;
      if (status === "pending" || status === "updated") {
        keysToFetch.push(k.name);
      } else if (status === undefined || status === null) {
        keysToFetch.push(k.name);
      }
    }
    if (keysToFetch.length > 0) {
      await kv.put(idxKey, JSON.stringify(keysToFetch));
    }
  } else {
    keysToFetch = indexRaw;
  }

  const todos = [];
  const validKeys = [];
  for (const name of keysToFetch) {
    const data = await kv.get(name, { type: "json" });
    if (data && (data.status === "pending" || data.status === "updated")) {
      todos.push({ key: name, ...data });
      validKeys.push(name);
    }
  }

  // stale 키 정리: 유효한 키만 인덱스에 유지
  if (validKeys.length !== keysToFetch.length) {
    await kv.put(idxKey, JSON.stringify(validKeys));
  }

  return todos;
}
