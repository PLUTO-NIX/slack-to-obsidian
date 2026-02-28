/**
 * Slack 요청 서명 검증
 * X-Slack-Signature 헤더를 HMAC-SHA256으로 검증하여 슬랙에서 온 요청인지 확인
 */
export async function verifySlackSignature(request, body, signingSecret) {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  const slackSignature = request.headers.get("X-Slack-Signature");

  if (!timestamp || !slackSignature) return false;

  // 리플레이 공격 방지: 5분 이상 된 요청 거부
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(sigBasestring)
  );
  const hexSignature =
    "v0=" +
    [...new Uint8Array(signature)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return hexSignature === slackSignature;
}
