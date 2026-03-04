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
 * 설정 모달 생성 (등록된 유저용)
 */
export function buildSettingsModal({ apiToken, workerUrl }) {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Obsidian Todo 설정" },
    close: { type: "plain_text", text: "닫기" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*API 토큰*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`${apiToken}\``,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Worker URL*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`${workerUrl}\``,
        },
      },
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Templater 설정 방법*\n\nTemplater 스크립트의 CONFIG에서 아래 값을 설정하세요:\n```\nconst CONFIG = {\n  workerUrl: \"" + workerUrl + "\",\n  apiToken: \"" + apiToken + "\",\n  ...\n};\n```",
        },
      },
    ],
  };
}

/**
 * 미등록 유저 안내 모달
 */
export function buildRegistrationGuideModal() {
  return {
    type: "modal",
    title: { type: "plain_text", text: "Obsidian Todo 설정" },
    close: { type: "plain_text", text: "확인" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📝 *아직 등록되지 않은 사용자입니다.*\n\n메시지에 이모지 리액션을 달거나 메시지 숏컷(⋮ → Add to Todo)을 사용하면 자동으로 등록됩니다.\n\n등록 후 이 숏컷에서 API 토큰을 확인할 수 있습니다.",
        },
      },
    ],
  };
}
