/**
 * 이모지 리액션 핸들러
 * 사용자가 메시지에 지정 이모지를 달았을 때 처리
 */
import { makeKey, getTodo, saveTodo } from "../kv/store.js";
import { shouldProcess } from "../kv/dedup.js";
import { summarizeWithGemini } from "../gemini/summarize.js";
import { fetchMessageText, getPermalink, postEphemeral } from "./utils.js";
import { formatDateForDailyNote } from "../utils.js";
import { getOrRegisterUser } from "../user/registry.js";

export async function handleEmojiReaction(event, env) {
  // 이모지 필터
  if (event.reaction !== env.TRIGGER_EMOJI) return;

  // message 타입만 처리 (file 등 제외)
  if (event.item.type !== "message") return;

  const userId = event.user;
  const channelId = event.item.channel;
  const messageTs = event.item.ts;

  try {
    // 유저 등록 (첫 사용 시 자동)
    const userInfo = await getOrRegisterUser(userId, env.slack_to_obsidian);

    const kvKey = makeKey(userId, channelId, messageTs);

    // 중복 체크
    const existing = await getTodo(env.slack_to_obsidian, kvKey);
    const decision = shouldProcess(existing, "emoji");

    if (decision.action === "ignore") return;

    // 메시지 원본 가져오기
    const messageText = await fetchMessageText(
      channelId,
      messageTs,
      env.SLACK_BOT_TOKEN
    );

    // 퍼마링크 획득
    const permalink = await getPermalink(
      channelId,
      messageTs,
      env.SLACK_BOT_TOKEN
    );

    // Gemini로 요약
    const { text: todoText, usedFallback } = await summarizeWithGemini(
      messageText,
      env
    );

    // KV 저장
    const todoData = {
      todo_text: todoText,
      message_url: permalink,
      source: "emoji",
      target_date: formatDateForDailyNote(new Date()),
      status: "pending",
      created_at: new Date().toISOString(),
      previous_text: null,
    };
    await saveTodo(env.slack_to_obsidian, userId, kvKey, todoData);

    // 신규 유저에게 토큰 안내
    if (userInfo.isNew) {
      await postEphemeral(
        channelId,
        userId,
        `🔑 Obsidian Todo에 등록되었습니다!\n\nAPI 토큰: \`${userInfo.apiToken}\`\n\nTemplater 스크립트의 CONFIG.apiToken에 위 토큰을 설정하세요.\n전역 숏컷 "Obsidian Todo 설정"으로 토큰을 다시 확인할 수 있습니다.`,
        env.SLACK_BOT_TOKEN
      );
    }

    // Gemini 폴백 시 사용자 피드백
    if (usedFallback) {
      await postEphemeral(
        channelId,
        userId,
        "✅ 투두가 등록되었습니다. (요약 실패, 원본 텍스트로 등록됨)",
        env.SLACK_BOT_TOKEN
      );
    }
  } catch (err) {
    console.error(`emoji handler error [${channelId}:${messageTs}]:`, err);
  }
}
