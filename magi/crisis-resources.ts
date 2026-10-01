/**
 * UK crisis and support resources, selected by age band.
 *
 * The previous build hard-coded the US 988 line into the system prompt. MAGI is a UK
 * product; presenting a US number to a user in acute distress is a safety defect.
 * Resources live here as data so they can be reviewed by a clinician and updated
 * without touching prompt text.
 *
 * Last reviewed: 2026-09-01. Requires re-verification before every release.
 */

export interface CrisisResource {
  id: string;
  name: string;
  /** What it is, in the user's terms. */
  description: string;
  tel?: string;
  sms?: string;
  url?: string;
  hours: string;
  /** Inclusive age bounds this resource is appropriate for. */
  minAge?: number;
  maxAge?: number;
  /** Shown first for the most acute tier. */
  emergency?: boolean;
}

export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: 'emergency_999',
    name: 'Emergency services',
    description: 'If you are in immediate danger, or you have already hurt yourself and need medical help.',
    tel: '999',
    hours: '24 hours, every day',
    emergency: true,
  },
  {
    id: 'samaritans',
    name: 'Samaritans',
    description: 'Someone to talk to, any time, about anything. Free to call and it will not show on your phone bill.',
    tel: '116123',
    url: 'https://www.samaritans.org',
    hours: '24 hours, every day',
  },
  {
    id: 'shout',
    name: 'Shout',
    description: 'A free, silent text conversation with a trained volunteer. Useful if you cannot speak out loud.',
    sms: '85258',
    url: 'https://giveusashout.org',
    hours: '24 hours, every day',
  },
  {
    id: 'nhs_111',
    name: 'NHS 111 — mental health option',
    description: 'Urgent NHS mental health advice and access to your local crisis team.',
    tel: '111',
    url: 'https://111.nhs.uk',
    hours: '24 hours, every day',
  },
  {
    id: 'childline',
    name: 'Childline',
    description: 'Free, confidential support for anyone under 19. You do not have to give your name.',
    tel: '08001111',
    url: 'https://www.childline.org.uk',
    hours: '24 hours, every day',
    maxAge: 18,
  },
  {
    id: 'the_mix',
    name: 'The Mix',
    description: 'Free support for under-25s by phone, text or webchat.',
    tel: '08088084994',
    sms: '85258',
    url: 'https://www.themix.org.uk',
    hours: 'Phone 3pm–midnight; text 24 hours',
    maxAge: 24,
  },
  {
    id: 'papyrus',
    name: 'Papyrus HOPELINE247',
    description: 'For anyone under 35 having thoughts of suicide, and for people worried about someone.',
    tel: '08000684141',
    sms: '07860039967',
    url: 'https://www.papyrus-uk.org',
    hours: '24 hours, every day',
    maxAge: 34,
  },
  {
    id: 'mind',
    name: 'Mind Infoline',
    description: 'Information about mental health support, treatment and your rights.',
    tel: '03001233393',
    url: 'https://www.mind.org.uk',
    hours: 'Weekdays 9am–6pm',
  },
];

export function resourcesForAge(age: number | null, includeEmergency: boolean): CrisisResource[] {
  return CRISIS_RESOURCES.filter((r) => {
    if (r.emergency && !includeEmergency) return false;
    if (age == null) return !r.minAge && !r.maxAge ? true : r.id === 'samaritans' || r.id === 'shout';
    if (r.minAge != null && age < r.minAge) return false;
    if (r.maxAge != null && age > r.maxAge) return false;
    return true;
  });
}
