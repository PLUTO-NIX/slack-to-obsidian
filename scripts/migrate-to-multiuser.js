/**
 * KV 데이터 마이그레이션: 단일 유저 → 멀티유저 스키마
 *
 * 변환:
 *   todo:{channelId}:{messageTs}  →  todo:{userId}:{channelId}:{messageTs}
 *   idx:pending                   →  idx:pending:{userId}
 *   + user:{userId} 레코드 생성
 *   + token:{apiToken} 역참조 생성
 *
 * 사용법:
 *   node scripts/migrate-to-multiuser.js
 *
 * 필요:
 *   - wrangler CLI 설치 + 로그인
 *   - wrangler.toml의 KV namespace ID
 */

import { execSync } from "node:child_process";

// ── 설정 ──
const EXISTING_USER_ID = "U05FDHF9FCL";
const KV_NAMESPACE_ID = "83b842ef84bb49e8805c41db1414e6f1";
const EXISTING_API_TOKEN = process.env.KV_API_TOKEN;

if (!EXISTING_API_TOKEN) {
  console.error("환경변수 KV_API_TOKEN을 설정해주세요.");
  console.error("예: KV_API_TOKEN=your-token node scripts/migrate-to-multiuser.js");
  process.exit(1);
}

function kvGet(key) {
  try {
    const result = execSync(
      `wrangler kv key get --namespace-id=${KV_NAMESPACE_ID} "${key}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return JSON.parse(result.trim());
  } catch {
    return null;
  }
}

function kvPut(key, value, ttl = null) {
  const ttlFlag = ttl ? ` --ttl=${ttl}` : "";
  execSync(
    `wrangler kv key put --namespace-id=${KV_NAMESPACE_ID} "${key}" '${JSON.stringify(value)}'${ttlFlag}`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
}

function kvDelete(key) {
  execSync(
    `wrangler kv key delete --namespace-id=${KV_NAMESPACE_ID} "${key}"`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
}

function kvList(prefix) {
  const result = execSync(
    `wrangler kv key list --namespace-id=${KV_NAMESPACE_ID} --prefix="${prefix}"`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  return JSON.parse(result.trim());
}

async function migrate() {
  console.log("=== Slack-to-Obsidian 멀티유저 마이그레이션 ===\n");

  // 1. 유저 레코드 생성
  console.log("1. 유저 레코드 생성...");
  const userData = {
    slackUserId: EXISTING_USER_ID,
    apiToken: EXISTING_API_TOKEN,
    createdAt: new Date().toISOString(),
  };
  kvPut(`user:${EXISTING_USER_ID}`, userData);
  kvPut(`token:${EXISTING_API_TOKEN}`, { slackUserId: EXISTING_USER_ID });
  console.log(`   user:${EXISTING_USER_ID} → 생성 완료`);
  console.log(`   token:${EXISTING_API_TOKEN.slice(0, 8)}... → 생성 완료`);

  // 2. 기존 투두 키 변환
  console.log("\n2. 투두 키 변환...");
  const todoKeys = kvList("todo:");
  let migratedCount = 0;

  for (const entry of todoKeys) {
    const oldKey = entry.name;

    // 이미 새 형식이면 건너뜀 (todo:{userId}:{ch}:{ts} — 4 segments)
    const segments = oldKey.split(":");
    if (segments.length === 4) {
      console.log(`   [skip] ${oldKey} — 이미 새 형식`);
      continue;
    }

    // 기존 형식: todo:{channelId}:{messageTs} — 3 segments
    if (segments.length === 3) {
      const [, channelId, messageTs] = segments;
      const newKey = `todo:${EXISTING_USER_ID}:${channelId}:${messageTs}`;

      const data = kvGet(oldKey);
      if (data) {
        // TTL 유지: written 상태면 7일 TTL
        const ttl = data.status === "written" ? 7 * 24 * 60 * 60 : null;
        kvPut(newKey, data, ttl);
        kvDelete(oldKey);
        console.log(`   ${oldKey} → ${newKey}`);
        migratedCount++;
      }
    }
  }
  console.log(`   총 ${migratedCount}개 투두 마이그레이션 완료`);

  // 3. 인덱스 변환
  console.log("\n3. 인덱스 변환...");
  const oldIndex = kvGet("idx:pending");
  if (oldIndex && Array.isArray(oldIndex)) {
    // 키 형식 변환
    const newIndex = oldIndex.map((key) => {
      const segments = key.split(":");
      if (segments.length === 3) {
        const [, channelId, messageTs] = segments;
        return `todo:${EXISTING_USER_ID}:${channelId}:${messageTs}`;
      }
      return key; // 이미 새 형식이면 유지
    });

    kvPut(`idx:pending:${EXISTING_USER_ID}`, newIndex);
    kvDelete("idx:pending");
    console.log(`   idx:pending → idx:pending:${EXISTING_USER_ID} (${newIndex.length}개 키)`);
  } else {
    console.log("   idx:pending 없음 — 건너뜀");
  }

  console.log("\n=== 마이그레이션 완료 ===");
  console.log("\n다음 단계:");
  console.log("1. wrangler deploy");
  console.log("2. Slack 앱 매니페스트 업데이트 (전역 숏컷 추가)");
  console.log("3. Templater 스크립트 동작 확인");
  console.log("4. 확인 후 wrangler.toml에서 ALLOWED_USER_ID 주석 확인");
}

migrate().catch((err) => {
  console.error("마이그레이션 실패:", err);
  process.exit(1);
});
