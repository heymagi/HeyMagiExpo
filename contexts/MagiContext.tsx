/**
 * The conversation with MAGI, and the state of the one screen.
 *
 * Everything the app does passes through here, because everything the app does passes through
 * MAGI. There is no separate store for check-ins or challenges: a check-in exists because
 * MAGI logged one and returned a card saying so.
 *
 * The optimistic-send pattern matters for this audience. A message that sits in a text box
 * doing nothing while the network thinks is the point at which someone who is already
 * depleted gives up, so her words appear immediately and the pending state is visible.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import { supabase } from '@/lib/supabase';
import { sendToMagi, MagiError, localDateString, currentTimezone } from '@/lib/magi-client';
import { useAuth } from './AuthContext';
import type { MagiCard, MagiResponse } from '@/supabase/functions/_shared/types.ts';
import type { RiskTier } from '@/supabase/functions/_shared/risk.ts';
import type { CrisisResource } from '@/supabase/functions/_shared/crisis-resources.ts';

export interface Turn {
  id: string;
  author: 'user' | 'magi';
  body: string;
  cards: MagiCard[];
  /** 'sending' and 'failed' only ever apply to the user's own turns. */
  status: 'sent' | 'sending' | 'failed';
  at: string;
}

interface MagiState {
  turns: Turn[];
  conversationId: string | null;
  busy: boolean;
  /** True while history is being restored, so the screen can avoid a blank flash. */
  restoring: boolean;
  riskTier: RiskTier;
  supportPinned: boolean;
  resources: CrisisResource[];
  quietMode: boolean;
  error: string | null;
}

interface MagiContextValue extends MagiState {
  send: (message: string) => Promise<void>;
  resolveProposal: (
    card: MagiCard,
    decision: 'accept' | 'reject',
    editedInput?: Record<string, unknown>,
  ) => Promise<void>;
  retryLast: () => Promise<void>;
  dismissSupport: () => void;
  clearError: () => void;
}

const MagiSession = createContext<MagiContextValue | undefined>(undefined);

/** How much of the conversation to restore on open. Enough to feel continuous. */
const RESTORE_LIMIT = 40;

export function MagiProvider({ children }: { children: ReactNode }) {
  const { user, gate } = useAuth();
  const [state, setState] = useState<MagiState>({
    turns: [],
    conversationId: null,
    busy: false,
    restoring: true,
    riskTier: 'none',
    supportPinned: false,
    resources: [],
    quietMode: false,
    error: null,
  });
  const lastAttempt = useRef<{ message: string } | null>(null);

  /* ---------------- restore ---------------- */
  useEffect(() => {
    if (!user || gate !== 'ready') {
      setState((s) => ({ ...s, restoring: gate === 'loading' }));
      return;
    }
    let cancelled = false;

    (async () => {
      const { data: conv } = await supabase
        .from('conversation')
        .select('id')
        .eq('account_id', user.id)
        .is('archived_at', null)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!conv) {
        if (!cancelled) setState((s) => ({ ...s, restoring: false }));
        return;
      }

      const { data: messages } = await supabase
        .from('message')
        .select('id, author, body, created_at, risk_tier')
        .eq('conversation_id', conv.id)
        .in('author', ['user', 'magi'])
        .order('created_at', { ascending: false })
        .limit(RESTORE_LIMIT);

      if (cancelled) return;

      const turns: Turn[] = (messages ?? [])
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id as string,
          author: m.author as Turn['author'],
          body: m.body as string,
          cards: [],
          status: 'sent' as const,
          at: m.created_at as string,
        }));

      setState((s) => ({ ...s, conversationId: conv.id, turns, restoring: false }));
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, gate]);

  /* ---------------- send ---------------- */
  const dispatchTurn = useCallback(
    async (message: string, resolve?: { card: MagiCard; decision: 'accept' | 'reject'; input?: Record<string, unknown> }) => {
      const tempId = `pending_${Date.now()}`;

      setState((s) => ({
        ...s,
        busy: true,
        error: null,
        turns: message
          ? [
              ...s.turns,
              {
                id: tempId,
                author: 'user',
                body: message,
                cards: [],
                status: 'sending',
                at: new Date().toISOString(),
              },
            ]
          : s.turns,
      }));

      try {
        const res: MagiResponse = await sendToMagi({
          conversation_id: state.conversationId ?? undefined,
          message,
          local_date: localDateString(),
          timezone: currentTimezone(),
          ...(resolve?.card.proposal
            ? {
                resolve_proposal: {
                  proposal_id: resolve.card.proposal.proposal_id,
                  tool: resolve.card.proposal.tool,
                  decision: resolve.decision,
                  input: resolve.input ?? resolve.card.proposal.input,
                },
              }
            : {}),
        });

        setState((s) => {
          const withoutPending = s.turns.filter((t) => t.id !== tempId);
          const settled: Turn[] = message
            ? [
                ...withoutPending,
                {
                  id: `user_${res.message_id}`,
                  author: 'user',
                  body: message,
                  cards: [],
                  status: 'sent',
                  at: new Date().toISOString(),
                },
              ]
            : withoutPending;

          // A resolved proposal card must stop offering buttons once it has been answered.
          const cleared = settled.map((t) => ({
            ...t,
            cards: t.cards.map((c) =>
              resolve && c.id === resolve.card.id ? { ...c, proposal: undefined } : c,
            ),
          }));

          return {
            ...s,
            busy: false,
            conversationId: res.conversation_id,
            riskTier: res.risk.tier,
            supportPinned: res.risk.pin_support_panel,
            resources: res.risk.resources,
            quietMode: res.quiet_mode,
            turns: [
              ...cleared,
              {
                id: res.message_id || `magi_${Date.now()}`,
                author: 'magi',
                body: res.reply,
                cards: res.cards,
                status: 'sent',
                at: new Date().toISOString(),
              },
            ],
          };
        });

        // Screen readers do not notice new content in a scroll view on their own.
        AccessibilityInfo.announceForAccessibility(res.reply);
      } catch (err) {
        const magiError = err instanceof MagiError ? err : null;
        setState((s) => ({
          ...s,
          busy: false,
          turns: s.turns.map((t) => (t.id === tempId ? { ...t, status: 'failed' } : t)),
          error:
            magiError?.kind === 'offline'
              ? "You're offline. Your message is still here — send it again when you're back."
              : magiError?.kind === 'auth'
                ? 'You need to sign in again.'
                : magiError?.kind === 'timeout'
                  ? 'That took too long. Try again?'
                  : "Something went wrong at MAGI's end. Try again in a moment.",
        }));
      }
    },
    [state.conversationId],
  );

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      lastAttempt.current = { message: trimmed };
      await dispatchTurn(trimmed);
    },
    [dispatchTurn],
  );

  const resolveProposal = useCallback(
    async (card: MagiCard, decision: 'accept' | 'reject', editedInput?: Record<string, unknown>) => {
      if (!card.proposal) return;
      await dispatchTurn('', { card, decision, input: editedInput });
    },
    [dispatchTurn],
  );

  const retryLast = useCallback(async () => {
    const attempt = lastAttempt.current;
    if (!attempt) return;
    setState((s) => ({ ...s, turns: s.turns.filter((t) => t.status !== 'failed') }));
    await dispatchTurn(attempt.message);
  }, [dispatchTurn]);

  const dismissSupport = useCallback(() => {
    // The panel can be closed, but the settings sheet always has a permanent route back to it.
    setState((s) => ({ ...s, supportPinned: false }));
  }, []);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  const value = useMemo(
    () => ({ ...state, send, resolveProposal, retryLast, dismissSupport, clearError }),
    [state, send, resolveProposal, retryLast, dismissSupport, clearError],
  );

  return <MagiSession.Provider value={value}>{children}</MagiSession.Provider>;
}

export function useMagi() {
  const ctx = useContext(MagiSession);
  if (!ctx) throw new Error('useMagi must be used inside a MagiProvider');
  return ctx;
}
