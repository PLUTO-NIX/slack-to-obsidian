/**
 * 모달 제출 핸들러
 * 사용자가 투두 모달에서 "등록"을 눌렀을 때 처리
 */
import { makeKey, getTodo, saveTodo } from "../kv/store.js";
import { shouldProcess } from "../kv/dedup.js";
import { summarizeWithGemini } from "../gemini/summarize.js";
import { postEphemeral } from "./utils.js";
import { formatDateForDailyNote } from "../utils.js";

export async function handleModalSubmit(payload, env) {
  const metadata = JSON.parse(payload.view.private_metadata);
  const userInput =
    payload.view.state.values?.todo_input_block?.todo_text?.value;

  const { channel_id: channelId, message_ts: messageTs, message_text: messageText, permalink } = metadata;

  try {
    const kvKey = makeKey(channelId, messageTs);

    // 중복 체크 + 덮어쓰기 판단
    const existing = await getTodo(env.slack_to_obsidian, kvKey);
    const decision = shouldProcess(existing, "shortcut");

    if (decision.action === "ignore") {
      await postEphemeral(
        channelId,
        payload.user.id,
        "이미 등록된 투두입니다.",
        env.SLACK_BOT_TOKEN
      );
      return;
    }

    // 투두 텍스트 결정: 사용자 직접 입력 우선, 없으면 Gemini 요약
    let todoText;
    let usedFallback = false;
    if (userInput && userInput.trim()) {
      todoText = userInput.trim();
    } else {
      const result = await summarizeWithGemini(messageText, env);
      todoText = result.text;
      usedFallback = result.usedFallback;
    }

    // KV 저장
    const todoData = {
      todo_text: todoText,
      message_url: permalink,
      source: "shortcut",
      target_date: formatDateForDailyNote(new Date()),
      status: decision.action === "overwrite" ? "updated" : "pending",
      created_at: new Date().toISOString(),
      previous_text: existing?.todo_text || null,
    };
    await saveTodo(env.slack_to_obsidian, kvKey, todoData);

    // Slack ephemeral 확인 메시지
    let msg =
      decision.action === "overwrite"
        ? "✅ 투두가 업데이트되었습니다."
        : "✅ 투두가 등록되었습니다.";
    if (usedFallback) {
      msg += " (요약 실패, 원본 텍스트로 등록됨)";
    }
    await postEphemeral(channelId, payload.user.id, msg, env.SLACK_BOT_TOKEN);
  } catch (err) {
    console.error(`modal handler error [${channelId}:${messageTs}]:`, err);
  }
}
