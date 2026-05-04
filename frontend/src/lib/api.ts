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
  coach: { timezone: string };
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
  agentPaused: boolean;
}

export interface WeekSession {
  id: string;
  kidName: string;
  scheduledAt: string;
  durationMinutes: number;
  paid: boolean;
}

export interface AvailabilitySlot {
  id: string;
  startAt: string;
  endAt: string;
  isBlocked: boolean;
  reason: string;
}

export interface KidOption {
  id: string;
  name: string;
  parentName: string;
}

export interface ParentSessionResponse {
  token: string;
  expiresAt: string;
  wsUrl: string;
}

export type VoiceProposal =
  | { kind: 'APPROVE_PENDING'; approvalId: string; summary: string }
  | { kind: 'DISMISS_PENDING'; approvalId: string; summary: string }
  | { kind: 'DRAFT_REPLY'; parentName: string; messageBody: string; summary: string }
  | { kind: 'BLOCK_AVAILABILITY'; startAtIso: string; endAtIso: string; summary: string }
  | { kind: 'CANCEL_SESSION'; sessionId: string; summary: string }
  | { kind: 'SCHEDULE_SESSION'; kidId: string; kidName: string; startAtIso: string; summary: string }
  | { kind: 'ADD_AVAILABILITY'; startAtIso: string; endAtIso: string; summary: string };

export interface StoredVoiceProposal {
  id: string;
  expiresAt: string;
  proposal: VoiceProposal;
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
  pauseAgent: () =>
    apiFetch<SettingsResponse>('/api/dashboard/kill-switch', { method: 'POST' }),
  resumeAgent: () =>
    apiFetch<SettingsResponse>('/api/dashboard/kill-switch', { method: 'DELETE' }),
  sendApproval: (id: string, draft?: string) =>
    apiFetch<void>(`/api/dashboard/approvals/${id}/send`, {
      method: 'POST',
      body: draft ? JSON.stringify({ draft }) : undefined,
    }),
  dismissApproval: (id: string) =>
    apiFetch<void>(`/api/dashboard/approvals/${id}/dismiss`, { method: 'POST' }),
  dismissFire: (id: string) =>
    apiFetch<void>(`/api/dashboard/fires/${id}/dismiss`, { method: 'POST' }),
  createParentSession: (parentId: string) =>
    apiFetch<ParentSessionResponse>('/api/demo/parent-session', {
      method: 'POST',
      body: JSON.stringify({ parentId }),
    }),
  getWeekSessions: (weekStart?: string) => apiFetch<WeekSession[]>(`/api/dashboard/sessions/week${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ''}`),
  getAvailability: (weekStart?: string) => apiFetch<AvailabilitySlot[]>(`/api/dashboard/availability${weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : ''}`),
  getKids: () => apiFetch<KidOption[]>('/api/dashboard/kids'),
  addAvailability: (startAt: string, endAt: string) =>
    apiFetch<AvailabilitySlot>('/api/dashboard/availability', {
      method: 'POST',
      body: JSON.stringify({ startAt, endAt }),
    }),
  removeAvailability: (id: string) =>
    apiFetch<void>(`/api/dashboard/availability/${id}`, { method: 'DELETE' }),
  cancelSession: (id: string) =>
    apiFetch<void>(`/api/dashboard/sessions/${id}`, { method: 'DELETE' }),
  createSession: (input: { kidId: string; scheduledAt: string; durationMinutes: number }) =>
    apiFetch<{ id: string }>('/api/dashboard/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  voice: {
    confirmProposal: (id: string) =>
      apiFetch<{ ok: true }>(`/api/voice/proposals/${id}/confirm`, { method: 'POST' }),
    cancelProposal: (id: string) =>
      apiFetch<{ ok: true }>(`/api/voice/proposals/${id}/cancel`, { method: 'POST' }),
  },
  recapSession: (sessionId: string, transcript: string) =>
    apiFetch<{ approvalId: string }>(`/api/dashboard/sessions/${sessionId}/recap`, {
      method: 'POST',
      body: JSON.stringify({ transcript }),
    }),
};
