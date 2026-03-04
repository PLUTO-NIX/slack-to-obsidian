/**
 * Message Shortcut 핸들러
 * 사용자가 ⋮ 메뉴 → "Add to Todo"를 클릭했을 때 처리
 */
import { buildTodoModal } from "./blocks.js";
import { getPermalink, openModal, postEphemeral } from "./utils.js";
import { getOrRegisterUser } from "../user/registry.js";

export async function handleShortcutTrigger(payload, env) {
  const userId = payload.user.id;

  // 유저 등록 (첫 사용 시 자동)
  const userInfo = await getOrRegisterUser(userId, env.slack_to_obsidian);

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

  // 신규 유저에게 토큰 안내
  if (userInfo.isNew) {
    await postEphemeral(
      payload.channel.id,
      userId,
      `🔑 Obsidian Todo에 등록되었습니다!\n\nAPI 토큰: \`${userInfo.apiToken}\`\n\nTemplater 스크립트의 CONFIG.apiToken에 위 토큰을 설정하세요.\n전역 숏컷 "Obsidian Todo 설정"으로 토큰을 다시 확인할 수 있습니다.`,
      env.SLACK_BOT_TOKEN
    );
  }

  return new Response();
}
