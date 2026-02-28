/**
 * Slack API 유틸리티 함수
 */

/**
 * 메시지 퍼마링크 획득
 */
export async function getPermalink(channelId, messageTs, token) {
  const res = await fetch(
    `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!data.ok) {
    console.error("getPermalink error:", data.error);
    return `https://slack.com/archives/${channelId}/p${messageTs.replace(".", "")}`;
  }
  return data.permalink;
}

/**
 * 메시지 원본 텍스트 가져오기
 */
export async function fetchMessageText(channelId, messageTs, token) {
  const res = await fetch(
    `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&inclusive=true&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!data.ok) {
    console.error("fetchMessageText error:", data.error);
    return "";
  }
  return data.messages?.[0]?.text || "";
}

/**
 * Ephemeral 메시지 전송 (본인에게만 보이는 메시지)
 */
export async function postEphemeral(channelId, userId, text, token) {
  await fetch("https://slack.com/api/chat.postEphemeral", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel: channelId, user: userId, text }),
  });
}

/**
 * views.open API 호출
 */
export async function openModal(triggerId, view, token) {
  const res = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ trigger_id: triggerId, view }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("views.open error:", data.error);
  }
  return data;
}
