/**
 * Message Shortcut 핸들러
 * 사용자가 ⋮ 메뉴 → "Add to Todo"를 클릭했을 때 처리
 */
import { buildTodoModal, buildErrorModal } from "./blocks.js";
import { getPermalink, openModal } from "./utils.js";

export async function handleShortcutTrigger(payload, env) {
  const userId = payload.user.id;

  // 권한 체크
  if (userId !== env.ALLOWED_USER_ID) {
    await openModal(payload.trigger_id, buildErrorModal(), env.SLACK_BOT_TOKEN);
    return new Response();
  }

  // 메시지 퍼마링크 획득
  const permalink = await getPermalink(
    payload.channel.id,
    payload.message.ts,
    env.SLACK_BOT_TOKEN
  );

  // 모달 열기
  const modal = buildTodoModal({
    channelId: payload.channel.id,
    messageTs: payload.message.ts,
    messageText: payload.message.text || "(내용 없음)",
    permalink,
  });

  await openModal(payload.trigger_id, modal, env.SLACK_BOT_TOKEN);
  return new Response();
}
