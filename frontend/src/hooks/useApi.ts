'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import type { EmailListFilter, EmailStatus, ScheduleCampaignRequest } from '@/lib/types';

/**
 * The backend session JWT lives in the Auth.js session. Every hook pulls it
 * from there, so no component has to think about auth headers.
 */
function useToken(): string | null {
  const { data: session } = useSession();
  return session?.backendToken ?? null;
}

/**
 * Poll interval for the tables. Sends happen on a multi-second cadence, so 4s
 * is frequent enough that rows visibly move Scheduled -> Sent while you watch,
 * without hammering the API.
 */
const POLL_MS = 4000;

export function useEmails(
  status: EmailListFilter,
  page: number,
  search?: string,
  only?: EmailStatus,
) {
  const token = useToken();

  return useQuery({
    queryKey: ['emails', status, page, search ?? '', only ?? ''],
    queryFn: () => api.listEmails({ status, page, limit: 25, search, only }, token),
    enabled: Boolean(token),
    refetchInterval: POLL_MS,
    // Keeps the previous page visible while the next one loads, so paging
    // doesn't flash an empty list.
    placeholderData: (previous) => previous,
  });
}

export function useEmail(id: string) {
  const token = useToken();

  return useQuery({
    queryKey: ['email', id],
    queryFn: () => api.getEmail(id, token),
    enabled: Boolean(token && id),
    // A pending email flips to sent while you are looking at it.
    refetchInterval: POLL_MS,
  });
}

export function useStats() {
  const token = useToken();

  return useQuery({
    queryKey: ['stats'],
    queryFn: () => api.stats(token),
    enabled: Boolean(token),
    refetchInterval: POLL_MS,
  });
}

export function useSenders() {
  const token = useToken();

  return useQuery({
    queryKey: ['senders'],
    queryFn: () => api.senders(token),
    enabled: Boolean(token),
    refetchInterval: 15_000,
  });
}

export function useScheduleCampaign() {
  const token = useToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ScheduleCampaignRequest) => api.scheduleCampaign(payload, token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useCancelEmail() {
  const token = useToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.cancelEmail(id, token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
