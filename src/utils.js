/**
 * 공통 유틸리티 함수
 */

/**
 * Date 객체를 데일리 노트용 날짜 문자열로 변환 (YYYY-MM-DD)
 * 요일은 Obsidian(Templater)에서 Intl로 로케일별 포맷
 * @param {Date} date - UTC 기준 시각
 * @returns {string} "YYYY-MM-DD" (e.g., "2026-02-28")
 */
export function formatDateForDailyNote(date) {
  // KST(UTC+9)로 변환
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * CORS 헤더
 * Obsidian Templater에서 fetch 호출 시 필요
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

