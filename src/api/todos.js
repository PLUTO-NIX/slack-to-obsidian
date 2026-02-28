/**
 * Templater용 REST API 핸들러
 * GET  /api/todos?status=pending  → Pending/Updated 투두 목록 조회
 * PATCH /api/todos/:key           → 투두 상태 업데이트
 */
import { listPendingTodos, getTodo, saveTodo } from "../kv/store.js";
import { corsHeaders } from "../utils.js";

const jsonHeaders = {
  "Content-Type": "application/json",
  ...corsHeaders,
};

/**
 * Pending 투두 목록 반환
 */
export async function handleGetTodos(request, env) {
  const todos = await listPendingTodos(env.slack_to_obsidian);
  return Response.json({ todos }, { headers: jsonHeaders });
}

/**
 * 투두 상태 업데이트
 * Templater가 데일리 노트에 기록 후 status를 "written"으로 변경할 때 호출
 */
export async function handleUpdateTodo(request, env) {
  const url = new URL(request.url);
  // "/api/todos/todo:C123:1234.5678" → "todo:C123:1234.5678"
  const key = decodeURIComponent(url.pathname.replace("/api/todos/", ""));

  const existing = await getTodo(env.slack_to_obsidian, key);
  if (!existing) {
    return Response.json({ error: "Not found" }, {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const body = await request.json();
  const updated = { ...existing, ...body };

  await saveTodo(env.slack_to_obsidian, key, updated);
  return Response.json({ success: true }, { headers: jsonHeaders });
}
