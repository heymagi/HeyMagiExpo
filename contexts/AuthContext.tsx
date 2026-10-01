/**
 * Authentication and account state.
 *
 * Beyond sign in and out, this owns the answer to "which screen should the app be on":
 * age assurance and, for under-16s, verified guardian consent are gates before the main
 * screen, not steps inside it. Keeping that decision here means no screen has to guess.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type AccountState =
  | 'pending_age_check'
  | 'pending_guardian'
  | 'active'
  | 'suspended'
  | 'deletion_requested';

export interface AccountSnapshot {
  state: AccountState;
  dateOfBirth: string | null;
  age: number | null;
  isMinor: boolean;
  guardianVerified: boolean;
  onboardingCompleted: boolean;
}

/** Where the app should be, given the account's state. */
export type Gate = 'loading' | 'signed_out' | 'age_check' | 'guardian' | 'onboarding' | 'ready';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  account: AccountSnapshot | null;
  gate: Gate;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setLoadingSession(false));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setAccount(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!session?.user) {
      setAccount(null);
      return;
    }
    setLoadingAccount(true);
    try {
      const [accountRes, profileRes, guardianRes] = await Promise.all([
        supabase.from('account').select('state, date_of_birth').eq('id', session.user.id).maybeSingle(),
        supabase
          .from('profile')
          .select('onboarding_completed_at')
          .eq('account_id', session.user.id)
          .maybeSingle(),
        supabase
          .from('guardian_link')
          .select('id')
          .eq('minor_account_id', session.user.id)
          .eq('state', 'verified')
          .maybeSingle(),
      ]);

      const dob: string | null = accountRes.data?.date_of_birth ?? null;
      const age = dob ? yearsSince(dob) : null;

      setAccount({
        state: (accountRes.data?.state as AccountState) ?? 'pending_age_check',
        dateOfBirth: dob,
        age,
        isMinor: age != null && age < 18,
        guardianVerified: Boolean(guardianRes.data),
        onboardingCompleted: Boolean(profileRes.data?.onboarding_completed_at),
      });
    } finally {
      setLoadingAccount(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  const gate: Gate = useMemo(() => {
    if (loadingSession || (session && !account && loadingAccount)) return 'loading';
    if (!session) return 'signed_out';
    if (!account) return 'loading';
    if (!account.dateOfBirth) return 'age_check';
    /*
      Under-16s need verified consent from a named adult before the app is usable. 16 is the
      line rather than 18 because 13–15 is where the ICO Age Appropriate Design Code and UK
      GDPR's information-society-services provisions bite hardest; 16–17s get the safeguarding
      behaviour without a consent gate that would simply drive them to lie about their age.
    */
    if (account.age != null && account.age < 16 && !account.guardianVerified) return 'guardian';
    if (!account.onboardingCompleted) return 'onboarding';
    return 'ready';
  }, [loadingSession, loadingAccount, session, account]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAccount(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      account,
      gate,
      signIn,
      signUp,
      signOut,
      refreshAccount,
    }),
    [session, account, gate, signIn, signUp, signOut, refreshAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}

function yearsSince(dateOfBirth: string): number {
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}
