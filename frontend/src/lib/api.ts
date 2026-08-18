import type {
  EmailDetailRecord,
  EmailListFilter,
  EmailListResponse,
  EmailStatus,
  ScheduleCampaignRequest,
  ScheduleCampaignResponse,
  SendersResponse,
  Stats,
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Carries the HTTP status so callers can distinguish auth failures from the rest. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    // fetch only rejects on network-level failure, which almost always means
    // the API process isn't running — say so instead of "Failed to fetch".
    throw new ApiError(0, 'Cannot reach the API. Is the backend running on ' + BASE_URL + '?');
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, payload?.error ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  listEmails: (
    params: {
      status: EmailListFilter;
      only?: EmailStatus;
      page?: number;
      limit?: number;
      search?: string;
    },
    token?: string | null,
  ) => {
    const query = new URLSearchParams({
      status: params.status,
      page: String(params.page ?? 1),
      limit: String(params.limit ?? 25),
    });
    if (params.search) query.set('search', params.search);
    if (params.only) query.set('only', params.only);
    return request<EmailListResponse>(`/api/emails?${query}`, { token });
  },

  getEmail: (id: string, token?: string | null) =>
    request<{ email: EmailDetailRecord }>(`/api/emails/${id}`, { token }),

  stats: (token?: string | null) => request<Stats>('/api/stats', { token }),

  senders: (token?: string | null) => request<SendersResponse>('/api/senders', { token }),

  scheduleCampaign: (payload: ScheduleCampaignRequest, token?: string | null) =>
    request<ScheduleCampaignResponse>('/api/campaigns', { method: 'POST', body: payload, token }),

  cancelEmail: (id: string, token?: string | null) =>
    request<{ id: string; status: string }>(`/api/emails/${id}/cancel`, { method: 'POST', token }),
};
