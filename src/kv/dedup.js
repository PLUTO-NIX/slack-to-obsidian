/**
 * 중복 방지 및 덮어쓰기 판정 로직
 *
 * 의사결정 테이블:
 *   기존 없음 + 어떤 요청이든   → create
 *   emoji/* + shortcut         → overwrite (숏컷이 이모지보다 우선)
 *   그 외                      → ignore
 */

/**
 * @param {object|null} existing - KV에 저장된 기존 데이터
 * @param {string} newSource - "emoji" | "shortcut"
 * @returns {{ action: "create" | "overwrite" | "ignore" }}
 */
export function shouldProcess(existing, newSource) {
  // 기존 데이터 없음 → 신규 생성
  if (!existing) {
    return { action: "create" };
  }

  // 이모지로 등록된 것을 숏컷으로 덮어쓰기
  if (existing.source === "emoji" && newSource === "shortcut") {
    return { action: "overwrite" };
  }

  // 나머지 모든 경우 → 무시
  return { action: "ignore" };
}
