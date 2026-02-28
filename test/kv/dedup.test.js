/**
 * shouldProcess 단위 테스트
 * 의사결정 테이블 전체 조합 검증
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { shouldProcess } from "../../src/kv/dedup.js";

describe("shouldProcess", () => {
  describe("기존 데이터 없음", () => {
    it("이모지 요청 → create", () => {
      const result = shouldProcess(null, "emoji");
      assert.strictEqual(result.action, "create");
    });

    it("숏컷 요청 → create", () => {
      const result = shouldProcess(null, "shortcut");
      assert.strictEqual(result.action, "create");
    });
  });

  describe("기존 emoji + 새 요청", () => {
    const existingEmoji = {
      source: "emoji",
      status: "pending",
      todo_text: "AI 요약",
    };

    it("emoji + emoji → ignore", () => {
      const result = shouldProcess(existingEmoji, "emoji");
      assert.strictEqual(result.action, "ignore");
    });

    it("emoji + shortcut → overwrite", () => {
      const result = shouldProcess(existingEmoji, "shortcut");
      assert.strictEqual(result.action, "overwrite");
    });
  });

  describe("기존 emoji/written + 새 요청", () => {
    const existingEmojiWritten = {
      source: "emoji",
      status: "written",
      todo_text: "AI 요약",
    };

    it("emoji/written + emoji → ignore", () => {
      const result = shouldProcess(existingEmojiWritten, "emoji");
      assert.strictEqual(result.action, "ignore");
    });

    it("emoji/written + shortcut → overwrite", () => {
      const result = shouldProcess(existingEmojiWritten, "shortcut");
      assert.strictEqual(result.action, "overwrite");
    });
  });

  describe("기존 shortcut + 새 요청", () => {
    const existingShortcut = {
      source: "shortcut",
      status: "pending",
      todo_text: "직접 입력",
    };

    it("shortcut + emoji → ignore", () => {
      const result = shouldProcess(existingShortcut, "emoji");
      assert.strictEqual(result.action, "ignore");
    });

    it("shortcut + shortcut → ignore", () => {
      const result = shouldProcess(existingShortcut, "shortcut");
      assert.strictEqual(result.action, "ignore");
    });
  });

  describe("기존 shortcut/written + 새 요청", () => {
    const existingShortcutWritten = {
      source: "shortcut",
      status: "written",
      todo_text: "직접 입력",
    };

    it("shortcut/written + emoji → ignore", () => {
      const result = shouldProcess(existingShortcutWritten, "emoji");
      assert.strictEqual(result.action, "ignore");
    });

    it("shortcut/written + shortcut → ignore", () => {
      const result = shouldProcess(existingShortcutWritten, "shortcut");
      assert.strictEqual(result.action, "ignore");
    });
  });
});
