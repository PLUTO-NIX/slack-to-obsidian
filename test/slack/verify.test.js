/**
 * verifySlackSignature 단위 테스트
 * - 유효한 서명 통과
 * - 잘못된 서명 거부
 * - 만료된 타임스탬프 거부
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { verifySlackSignature } from "../../src/slack/verify.js";

const SIGNING_SECRET = "test-signing-secret";

/**
 * HMAC-SHA256 서명 생성 (verify.js와 동일 로직)
 */
async function createSignature(timestamp, body, secret) {
  const sigBasestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sigBasestring)
  );
  return (
    "v0=" +
    [...new Uint8Array(signature)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Mock Request 생성
 */
function createRequest(headers) {
  return {
    headers: {
      get(name) {
        return headers[name] || null;
      },
    },
  };
}

describe("verifySlackSignature", () => {
  it("유효한 서명이면 true 반환", async () => {
    const body = '{"type":"event_callback","event":{"type":"reaction_added"}}';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await createSignature(timestamp, body, SIGNING_SECRET);

    const request = createRequest({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    });

    const result = await verifySlackSignature(
      request,
      body,
      SIGNING_SECRET
    );
    assert.strictEqual(result, true);
  });

  it("잘못된 서명이면 false 반환", async () => {
    const body = '{"type":"event_callback"}';
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const request = createRequest({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": "v0=invalid_signature_here",
    });

    const result = await verifySlackSignature(
      request,
      body,
      SIGNING_SECRET
    );
    assert.strictEqual(result, false);
  });

  it("다른 시크릿으로 서명된 요청은 false 반환", async () => {
    const body = '{"type":"event_callback"}';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await createSignature(
      timestamp,
      body,
      "wrong-secret"
    );

    const request = createRequest({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    });

    const result = await verifySlackSignature(
      request,
      body,
      SIGNING_SECRET
    );
    assert.strictEqual(result, false);
  });

  it("만료된 타임스탬프(5분 초과)면 false 반환", async () => {
    const body = '{"type":"event_callback"}';
    const timestamp = Math.floor(Date.now() / 1000 - 400).toString(); // 400초 전
    const signature = await createSignature(timestamp, body, SIGNING_SECRET);

    const request = createRequest({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    });

    const result = await verifySlackSignature(
      request,
      body,
      SIGNING_SECRET
    );
    assert.strictEqual(result, false);
  });

  it("타임스탬프/서명 헤더 없으면 false 반환", async () => {
    const body = '{"type":"event_callback"}';

    const requestNoTimestamp = createRequest({
      "X-Slack-Signature": "v0=abc123",
    });
    assert.strictEqual(
      await verifySlackSignature(requestNoTimestamp, body, SIGNING_SECRET),
      false
    );

    const requestNoSignature = createRequest({
      "X-Slack-Request-Timestamp": Math.floor(Date.now() / 1000).toString(),
    });
    assert.strictEqual(
      await verifySlackSignature(requestNoSignature, body, SIGNING_SECRET),
      false
    );
  });
});
