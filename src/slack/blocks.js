/**
 * Slack Block Kit 모달 빌더
 */

/**
 * 투두 입력 모달 생성
 */
export function buildTodoModal({ channelId, messageTs, messageText, permalink }) {
  // 메시지 미리보기 (100자 제한)
  const preview =
    messageText.length > 100
      ? messageText.slice(0, 100) + "..."
      : messageText;

  return {
    type: "modal",
    callback_id: "todo_modal_submit",
    title: { type: "plain_text", text: "Add to Todo" },
    submit: { type: "plain_text", text: "등록" },
    close: { type: "plain_text", text: "취소" },
    private_metadata: JSON.stringify({
      channel_id: channelId,
      message_ts: messageTs,
      message_text: messageText,
      permalink,
    }),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*선택한 메시지:*\n> ${preview}`,
        },
      },
      {
        type: "input",
        block_id: "todo_input_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "todo_text",
          placeholder: {
            type: "plain_text",
            text: "비워두면 AI가 자동 요약합니다",
          },
          multiline: false,
        },
        label: { type: "plain_text", text: "할 일" },
      },
    ],
  };
}

/**
 * 권한 없음 에러 모달 생성
 */
export function buildErrorModal() {
  return {
    type: "modal",
    title: { type: "plain_text", text: "접근 불가" },
    close: { type: "plain_text", text: "확인" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "🔒 *개인용 앱입니다.*\n\n이 기능은 앱 소유자만 사용할 수 있습니다.",
        },
      },
    ],
  };
}
