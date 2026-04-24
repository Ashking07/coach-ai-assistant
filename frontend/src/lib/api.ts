// ─── Types ───────────────────────────────────────────────────────────────────

export interface Fire {
  id: string;
  parent: string;
  kid: string;
  reason: string;
  ago: string;
  preview: string;
  intent: string;
}

export interface Approval {
  id: string;
  parent: string;
  kid: string;
  intent: string;
  incoming: string;
  draft: string;
  confidence: number;
  ago: string;
  reason: string;
}

export interface DashboardSession {
  id: string;
  kid: string;
  time: string;
  duration: string;
  note: string;
  paid: boolean;
}

export interface AutoHandled {
  id: string;
  parent: string;
  kid: string;
  intent: string;
  summary: string;
  time: string;
}

export interface HomeResponse {
  fires: Fire[];
  approvals: Approval[];
  sessions: DashboardSession[];
  autoHandled: AutoHandled[];
  stats: { firesCount: number; handledCount: number };
}

export interface AuditEntry {
  id: string;
  ts: string;
  parent: string;
  kid: string;
  intent: string;
  tier: string;
  action: 'AUTO_SENT' | 'QUEUED_FOR_APPROVAL' | 'ESCALATED' | 'FAILED';
  model: string;
  tokens: number;
  latencyMs: number;
  incoming: string;
  draft: string;
  trace: { step: string; verdict: string }[];
}

export interface ParentEntry {
  id: string;
  name: string;
  kids: string[];
  lastMessage: string;
}

export interface SettingsResponse {
  id: string;
  name: string;
  phone: string;
  timezone: string;
  stripeAccountId: string | null;
  autonomyEnabled: boolean;
}

export interface ParentSessionResponse {
  token: string;
  expiresAt: string;
  wsUrl: string;
}

// ─── Fetch wrapper ────────────────────────────────────────────────────────────

const apiUrl = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
const token = (import.meta.env.VITE_DASHBOARD_TOKEN as string) ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-token': token,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${path}`);
  }
  return res.json() as Promise<T>;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const api = {
  home: () => apiFetch<HomeResponse>('/api/dashboard/home'),
  audit: () => apiFetch<AuditEntry[]>('/api/dashboard/audit'),
  parents: () => apiFetch<ParentEntry[]>('/api/dashboard/parents'),
  settings: () => apiFetch<SettingsResponse>('/api/dashboard/settings'),
  updateSettings: (body: { autonomyEnabled: boolean }) =>
    apiFetch<SettingsResponse>('/api/dashboard/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  sendApproval: (id: string) =>
    apiFetch<void>(`/api/dashboard/approvals/${id}/send`, { method: 'POST' }),
  dismissApproval: (id: string) =>
    apiFetch<void>(`/api/dashboard/approvals/${id}/dismiss`, { method: 'POST' }),
  createParentSession: (parentId: string) =>
    apiFetch<ParentSessionResponse>('/api/demo/parent-session', {
      method: 'POST',
      body: JSON.stringify({ parentId }),
    }),
};
