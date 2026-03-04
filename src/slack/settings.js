/**
 * 설정 전역 숏컷 핸들러
 * "Obsidian Todo 설정" 숏컷 → 모달에 API 토큰 표시
 */
import { buildSettingsModal, buildRegistrationGuideModal } from "./blocks.js";
import { openModal } from "./utils.js";

export async function handleSettingsShortcut(payload, env) {
  const userId = payload.user.id;
  const userKey = `user:${userId}`;
  const userData = await env.slack_to_obsidian.get(userKey, { type: "json" });

  let modal;
  if (userData) {
    modal = buildSettingsModal({
      apiToken: userData.apiToken,
      workerUrl: "https://slack-to-obsidian.plutonix.workers.dev",
    });
  } else {
    modal = buildRegistrationGuideModal();
  }

  await openModal(payload.trigger_id, modal, env.SLACK_BOT_TOKEN);
  return new Response();
}
