// Thin client for the optional Node API. The web app always works without it;
// the API only adds AI-assisted output, and every response says who produced it.
export const API_BASE = 'http://localhost:3105';

export interface AiMeta { provider: string; model: string; simulated: boolean; }
export type AiOutcome<T> = { ok: true; meta: AiMeta; result: T } | { ok: false; error: string };

export async function callAi<T>(task: string, payload: unknown): Promise<AiOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/ai/${task}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: 'The API is not running. Start it with "npm start" in the api folder.' };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: body.message || `API error ${res.status}` };
  return { ok: true, meta: { provider: body.provider, model: body.model, simulated: !!body.simulated }, result: body.result as T };
}

export function aiLabel(m: AiMeta): string {
  return m.simulated ? 'Mock AI · simulated, no model was called' : `AI · ${m.provider} · ${m.model}`;
}
