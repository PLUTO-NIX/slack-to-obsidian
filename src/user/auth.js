/**
 * API 토큰 인증 모듈
 * Bearer 토큰 → KV 조회 → userId 확인
 */
import { getUserByToken } from "./registry.js";

/**
 * Request의 Bearer 토큰으로 인증
 * @param {Request} request
 * @param {object} env
 * @returns {{ ok: boolean, userId: string|null }}
 */
export async function authenticateByToken(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, userId: null };
  }

  const token = authHeader.slice(7);
  if (!token) {
    return { ok: false, userId: null };
  }

  const userId = await getUserByToken(token, env.slack_to_obsidian);
  if (!userId) {
    return { ok: false, userId: null };
  }

  return { ok: true, userId };
}
