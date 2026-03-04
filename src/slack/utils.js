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
 * reactions.get은 채널 메시지 / 스레드 답글 모두에서 동작
 * (이모지 핸들러에서 호출되므로 리액션이 반드시 존재)
 */
export async function fetchMessageText(channelId, messageTs, token) {
  const res = await fetch(
    `https://slack.com/api/reactions.get?channel=${channelId}&timestamp=${messageTs}&full=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.ok && data.message?.text) {
    return data.message.text;
  }

  // 폴백: reactions.get 실패 시 conversations.history
  const histRes = await fetch(
    `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&inclusive=true&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const histData = await histRes.json();
  if (histData.ok && histData.messages?.[0]?.ts === messageTs) {
    return histData.messages[0].text || "";
  }

  return "";
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
