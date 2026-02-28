/**
 * summarizeWithGemini 단위 테스트
 * - API 실패 시 폴백 동작 및 usedFallback 반환
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { summarizeWithGemini } from "../../src/gemini/summarize.js";

describe("summarizeWithGemini", () => {
  it("API 실패 시 usedFallback: true 및 원본 앞 80자 반환", async () => {
    const messageText = "이것은 테스트용 슬랙 메시지입니다. ".repeat(5);
    const env = { GEMINI_API_KEY: "invalid-key-will-fail" };

    const result = await summarizeWithGemini(messageText, env);

    assert.strictEqual(result.usedFallback, true);
    assert.strictEqual(typeof result.text, "string");
    assert.ok(result.text.length > 0);
    assert.ok(
      result.text.startsWith("이것은 테스트용") || result.text.endsWith("..."),
      "폴백 시 원본 앞부분 또는 ... 포함"
    );
  });

  it("빈 메시지 시 폴백 반환", async () => {
    const env = { GEMINI_API_KEY: "invalid" };
    const result = await summarizeWithGemini("", env);

    assert.strictEqual(result.usedFallback, true);
    assert.strictEqual(result.text, "");
  });
});
