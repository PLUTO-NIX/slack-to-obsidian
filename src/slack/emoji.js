/**
 * 이모지 리액션 핸들러
 * 사용자가 메시지에 지정 이모지를 달았을 때 처리
 */
import { makeKey, getTodo, saveTodo } from "../kv/store.js";
import { shouldProcess } from "../kv/dedup.js";
import { summarizeWithGemini } from "../gemini/summarize.js";
import { fetchMessageText, getPermalink, postEphemeral } from "./utils.js";
import { formatDateForDailyNote } from "../utils.js";

export async function handleEmojiReaction(event, env) {
  // 이모지 필터
  if (event.reaction !== env.TRIGGER_EMOJI) return;

  // 권한 체크
  if (event.user !== env.ALLOWED_USER_ID) return;

  // message 타입만 처리 (file 등 제외)
  if (event.item.type !== "message") return;

  const channelId = event.item.channel;
  const messageTs = event.item.ts;

  try {
    const kvKey = makeKey(channelId, messageTs);

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
    await saveTodo(env.slack_to_obsidian, kvKey, todoData);

    // Gemini 폴백 시 사용자 피드백
    if (usedFallback) {
      await postEphemeral(
        channelId,
        event.user,
        "✅ 투두가 등록되었습니다. (요약 실패, 원본 텍스트로 등록됨)",
        env.SLACK_BOT_TOKEN
      );
    }
  } catch (err) {
    console.error(`emoji handler error [${channelId}:${messageTs}]:`, err);
  }
}
