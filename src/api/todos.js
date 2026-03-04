import { listPendingTodos, getTodo, saveTodo } from "../kv/store.js";
import { corsHeaders } from "../utils.js";

const jsonHeaders = {
  "Content-Type": "application/json",
  ...corsHeaders,
};

export async function handleGetTodos(request, env, userId) {
  const todos = await listPendingTodos(env.slack_to_obsidian, userId);
  return Response.json({ todos }, { headers: jsonHeaders });
}

export async function handleUpdateTodo(request, env, userId) {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace("/api/todos/", ""));

  // 키 소유권 검증
  if (!key.startsWith(`todo:${userId}:`)) {
    return Response.json({ error: "Forbidden" }, {
      status: 403,
      headers: jsonHeaders,
    });
  }

  const existing = await getTodo(env.slack_to_obsidian, key);
  if (!existing) {
    return Response.json({ error: "Not found" }, {
      status: 404,
      headers: jsonHeaders,
    });
  }

  const body = await request.json();

  // status 필드만 허용, "written" 값만 허용
  const { status } = body;
  if (status !== "written") {
    return Response.json({ error: "Invalid status" }, {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const updated = { ...existing, status };
  await saveTodo(env.slack_to_obsidian, userId, key, updated);
  return Response.json({ success: true }, { headers: jsonHeaders });
}
