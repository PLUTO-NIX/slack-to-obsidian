/**
 * Slack-to-Obsidian Todo Worker
 * 메인 라우터 — 모든 요청의 진입점
 *
 * 엔드포인트:
 *   POST  /slack/events    — Slack 웹훅 (이벤트 + 인터랙티비티)
 *   GET   /api/todos       — Pending 투두 목록 (Templater 폴링용)
 *   PATCH /api/todos/:key  — 투두 상태 업데이트
 */
import { verifySlackSignature } from "./slack/verify.js";
import { handleShortcutTrigger } from "./slack/shortcut.js";
import { handleModalSubmit } from "./slack/modal.js";
import { handleEmojiReaction } from "./slack/emoji.js";
import { handleSettingsShortcut } from "./slack/settings.js";
import { handleGetTodos, handleUpdateTodo } from "./api/todos.js";
import { authenticateByToken } from "./user/auth.js";
import { corsHeaders } from "./utils.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // ── CORS preflight ──
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── Slack 웹훅 ──
    if (method === "POST" && url.pathname === "/slack/events") {
      return handleSlackRequest(request, env, ctx);
    }

    // ── Templater용 API ──
    if (url.pathname.startsWith("/api/todos")) {
      // 유저별 토큰 인증
      const auth = await authenticateByToken(request, env);
      if (!auth.ok) {
        return new Response("Unauthorized", {
          status: 403,
          headers: corsHeaders,
        });
      }

      if (method === "GET") {
        return handleGetTodos(request, env, auth.userId);
      }
      if (method === "PATCH") {
        return handleUpdateTodo(request, env, auth.userId);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

/**
 * Slack 요청 처리 분기
 * Content-Type으로 Event API(JSON)와 Interactivity(form-urlencoded)를 구분
 */
async function handleSlackRequest(request, env, ctx) {
  const body = await request.text();

  // ── Content-Type에 따라 파싱 분기 ──
  const contentType = request.headers.get("Content-Type") || "";

  // 1. Event API (application/json)
  if (contentType.includes("application/json")) {
    const payload = JSON.parse(body);

    // URL Verification (앱 설치 시 한 번)
    // 서명 검증 전에 응답해야 함 — Slack이 요청 URL 등록 시 사용하는 핸드셰이크
    if (payload.type === "url_verification") {
      return Response.json({ challenge: payload.challenge });
    }

    // 서명 검증
    if (
      !(await verifySlackSignature(
        request,
        body,
        env.SLACK_SIGNING_SECRET
      ))
    ) {
      return new Response("Invalid signature", { status: 401 });
    }

    // reaction_added 이벤트 → 비동기 처리 (Slack 3초 타임아웃 회피)
    if (
      payload.type === "event_callback" &&
      payload.event?.type === "reaction_added"
    ) {
      ctx.waitUntil(handleEmojiReaction(payload.event, env));
      return new Response("ok");
    }

    return new Response("ok");
  }

  // 2. Interactivity (application/x-www-form-urlencoded)
  if (contentType.includes("application/x-www-form-urlencoded")) {
    // 서명 검증
    if (
      !(await verifySlackSignature(
        request,
        body,
        env.SLACK_SIGNING_SECRET
      ))
    ) {
      return new Response("Invalid signature", { status: 401 });
    }

    const params = new URLSearchParams(body);
    const payloadStr = params.get("payload");
    if (!payloadStr) return new Response("ok");

    const payload = JSON.parse(payloadStr);

    // Message Shortcut 트리거
    if (payload.type === "message_action") {
      return handleShortcutTrigger(payload, env);
    }

    // 전역 숏컷 (설정)
    if (payload.type === "shortcut") {
      if (payload.callback_id === "obsidian_todo_settings") {
        return handleSettingsShortcut(payload, env);
      }
    }

    // 모달 제출 → 비동기 처리 후 즉시 빈 200 응답으로 모달 닫기
    if (payload.type === "view_submission") {
      ctx.waitUntil(handleModalSubmit(payload, env));
      return new Response();
    }

    return new Response("ok");
  }

  return new Response("ok");
}
