export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'jj.token';
export const isDemo = location.pathname === '/try' || new URLSearchParams(location.search).get('mode') === 'demo';
const tokenKey = isDemo ? 'jj.try.token' : TOKEN_KEY;

export const session = {
  get token(): string | null {
    return localStorage.getItem(tokenKey);
  },
  set(token: string): void {
    localStorage.setItem(tokenKey, token);
  },
  clear(): void {
    localStorage.removeItem(tokenKey);
  },
};

export async function api<T>(method: string, path: string, body?: unknown, token = session.token): Promise<T> {
  if (isDemo) return (await import('./demo')).demoRequest(method, path, body) as Promise<T>;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const TARGETS = ['稳定恋爱', '奔着结婚认真谈'] as const;
export type Target = (typeof TARGETS)[number];

export interface ProfileEntry {
  value: string | string[];
  source?: string;
  confidence?: number;
  updated_at?: string;
}

export interface ProfileData {
  stated: Record<string, ProfileEntry>;
  revealed: Record<string, ProfileEntry>;
}

export interface ProfileResponse {
  data: ProfileData;
  target: Target | null;
}

export type Choice = 'interested' | 'pass';

export interface Recommendation {
  id: string;
  candidate_snapshot: { stated: Record<string, { value: string | string[] }> };
  reasons: string[];
  link: string;
  status: 'pending' | 'mutual';
  myChoice: Choice | null;
  created_at: string;
}

/** 经分享链接打开的推荐：card 永远是「对方」的卡片 */
export interface SharedRecommendation extends Omit<Recommendation, 'link'> {
  role: 'viewer' | 'candidate';
}

export interface MyInvite {
  id: string;
  kind: 'bridge' | 'crush';
  status: 'sent' | 'registered' | 'experienced' | 'withdrawn';
  created_at: string;
}

export interface InboxInvite {
  id: string;
  code: string;
  status: string;
  created_at: string;
}

export interface Room {
  roomId: string;
  link: string;
  userSig: string;
}

export const FIELD_LABELS: Record<string, string> = {
  city: '现居城市',
  age: '年龄',
  gender: '性别',
  hometown: '籍贯',
  occupation: '职业',
  hobbies: '爱好',
  vibe: '气质',
  weekend: '周末',
  ideal_date: '理想约会',
  comm_style: '沟通风格',
  money_view: '金钱观',
  pace: '相处节奏',
  marriage_view: '对结婚的想法',
  family_view: '期待的家',
  spark: '来电时刻',
  vibe_pref: '被吸引的气质',
  conflict: '分歧时',
};

export interface OnboardingStep {
  key: string;
  question: string;
  options: string[];
  multi?: boolean;
  allowText?: boolean;
  skippable: boolean;
}

export interface OnboardingState {
  done: boolean;
  step: OnboardingStep | null;
  transcript: { question: string; answer: string | null }[];
  answered: number;
  total: number;
}


export function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join('、');
  return value == null ? '' : String(value);
}
