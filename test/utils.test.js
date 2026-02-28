/**
 * formatDateForDailyNote 단위 테스트
 * YYYY-MM-DD 형식 및 KST 변환 검증 (요일은 Templater에서 Intl로 처리)
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { formatDateForDailyNote } from "../src/utils.js";

describe("formatDateForDailyNote", () => {
  it("YYYY-MM-DD 형식 반환", () => {
    const date = new Date(Date.UTC(2026, 1, 26, 15, 0, 0));
    const result = formatDateForDailyNote(date);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(result, "2026-02-27");
  });

  it("KST 기준 날짜 변환", () => {
    const date = new Date(Date.UTC(2026, 1, 27, 12, 0, 0));
    const result = formatDateForDailyNote(date);
    assert.strictEqual(result, "2026-02-27");
  });

  it("월/일 한 자리 수는 0 패딩", () => {
    const date = new Date(Date.UTC(2026, 0, 4, 15, 0, 0));
    const result = formatDateForDailyNote(date);
    assert.strictEqual(result, "2026-01-05");
  });

  it("자정 경계 KST 변환", () => {
    const date = new Date(Date.UTC(2026, 1, 27, 14, 59, 59));
    const result = formatDateForDailyNote(date);
    assert.strictEqual(result, "2026-02-27");
  });
});
