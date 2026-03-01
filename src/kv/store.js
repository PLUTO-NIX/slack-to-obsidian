/**
 * Cloudflare KV 저장소 헬퍼
 * 키 형식: "todo:{channelId}:{messageTs}"
 */

/**
 * KV 키 생성
 */
export function makeKey(channelId, messageTs) {
  return `todo:${channelId}:${messageTs}`;
}

/**
 * 투두 데이터 저장
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {object} data
 */
export async function saveTodo(kv, key, data) {
  const options = {
    ...(data.status === "written" && {
      expirationTtl: 7 * 24 * 60 * 60,
    }),
    metadata: { status: data.status },
  };

  await kv.put(key, JSON.stringify(data), options);
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
 * Pending/Updated 상태의 모든 투두 조회
 * Templater 폴링 시 호출 — 아직 데일리 노트에 기록되지 않은 항목만 반환
 * @param {KVNamespace} kv
 * @returns {Array<object>}
 */
export async function listPendingTodos(kv) {
  const list = await kv.list({ prefix: "todo:" });
  const keysToFetch = [];

  for (const key of list.keys) {
    const status = key.metadata?.status;
    if (status === "pending" || status === "updated") {
      keysToFetch.push(key.name);
    } else if (status === undefined || status === null) {
      keysToFetch.push(key.name);
    }
  }

  const todos = [];
  for (const name of keysToFetch) {
    const data = await kv.get(name, { type: "json" });
    if (data && (data.status === "pending" || data.status === "updated")) {
      todos.push({ key: name, ...data });
    }
  }

  return todos;
}
