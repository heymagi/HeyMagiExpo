/**
 * Client for the MAGI edge function.
 *
 * One call per turn. No streaming: a reply that appears word by word and then rewrites
 * itself once a tool runs is worse than a short wait, particularly for someone who is
 * struggling to read at all in the moment.
 */

import { supabase, SUPABASE_URL } from './supabase';
import type { MagiRequestBody, MagiResponse } from '@/supabase/functions/_shared/types.ts';

export class MagiError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'auth' | 'server' | 'timeout',
  ) {
    super(message);
    this.name = 'MagiError';
  }
}

const TIMEOUT_MS = 45_000;

export async function sendToMagi(body: MagiRequestBody): Promise<MagiResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new MagiError('Not signed in.', 'auth');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/magi`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401) throw new MagiError('Your session has expired.', 'auth');
    if (!res.ok) {
      throw new MagiError(`MAGI is unavailable (${res.status}).`, 'server');
    }
    return (await res.json()) as MagiResponse;
  } catch (err) {
    if (err instanceof MagiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new MagiError('That took too long.', 'timeout');
    }
    throw new MagiError('No connection.', 'offline');
  } finally {
    clearTimeout(timer);
  }
}

/** Today's date in the user's own timezone, which is what "today" must mean for a check-in. */
export function localDateString(date = new Date()): string {
  const offsetMinutes = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offsetMinutes * 60_000);
  return local.toISOString().slice(0, 10);
}

export function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/London';
  } catch {
    return 'Europe/London';
  }
}
