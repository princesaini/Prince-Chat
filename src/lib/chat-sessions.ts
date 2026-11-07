export type ReasoningEffort =
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  kind: 'image' | 'file';
};

export type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
};

export type Message = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  usage?: MessageUsage;
  images?: {
    url: string;
    mediaType: string;
  }[];
  modelId?: string;
};

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  modelId?: string;
  systemPrompt?: string;
  webSearchEnabled?: boolean;
  reasoningEffort?: ReasoningEffort | '';
}

const DB_NAME = 'prince_chat_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const FALLBACK_STORAGE_KEY = 'prince-chat-sessions-fallback';
export const ACTIVE_SESSION_STORAGE_KEY = 'prince-chat-active-session-id';
export const SIDEBAR_OPEN_STORAGE_KEY = 'prince-chat-sidebar-open';

export function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function generateChatTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/^#+\s+/gm, '') // remove markdown headings
    .replace(/[*_`~[\]]/g, '') // remove markdown styling
    .trim()
    .replace(/\r?\n+/g, ' ');

  if (!cleaned) return 'New Chat';
  if (cleaned.length <= 36) return cleaned;
  return `${cleaned.slice(0, 35).trim()}...`;
}

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB is not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Fallback to localStorage if IndexedDB is blocked (e.g. private mode restrictions)
function getFallbackSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to read fallback sessions from localStorage', err);
    return [];
  }
}

function saveFallbackSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.warn('Failed to save fallback sessions to localStorage', err);
  }
}

export async function getAllSessions(): Promise<ChatSession[]> {
  if (typeof window === 'undefined') return [];

  try {
    const db = await openDB();
    return await new Promise<ChatSession[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const result = (request.result as ChatSession[]) || [];
        result.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(result);
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('IndexedDB getAllSessions failed, using localStorage fallback', err);
    const fallback = getFallbackSessions();
    fallback.sort((a, b) => b.updatedAt - a.updatedAt);
    return fallback;
  }
}

export async function saveSession(session: ChatSession): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(session);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('IndexedDB saveSession failed, saving to fallback', err);
    const fallback = getFallbackSessions();
    const index = fallback.findIndex((s) => s.id === session.id);
    if (index >= 0) {
      fallback[index] = session;
    } else {
      fallback.unshift(session);
    }
    saveFallbackSessions(fallback);
  }
}

export async function deleteSession(id: string): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('IndexedDB deleteSession failed, removing from fallback', err);
    const fallback = getFallbackSessions().filter((s) => s.id !== id);
    saveFallbackSessions(fallback);
  }
}

export async function clearAllSessions(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('IndexedDB clearAllSessions failed, clearing fallback', err);
    saveFallbackSessions([]);
  }
}

export function groupSessionsByDate(sessions: ChatSession[]): {
  label: string;
  sessions: ChatSession[];
}[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const sevenDaysStart = todayStart - 6 * 86400000;
  const thirtyDaysStart = todayStart - 29 * 86400000;

  const groups: { label: string; minTime: number; sessions: ChatSession[] }[] = [
    { label: 'Today', minTime: todayStart, sessions: [] },
    { label: 'Yesterday', minTime: yesterdayStart, sessions: [] },
    { label: 'Previous 7 Days', minTime: sevenDaysStart, sessions: [] },
    { label: 'Previous 30 Days', minTime: thirtyDaysStart, sessions: [] },
    { label: 'Older', minTime: 0, sessions: [] },
  ];

  for (const session of sessions) {
    const time = session.updatedAt || session.createdAt;
    if (time >= todayStart) {
      groups[0].sessions.push(session);
    } else if (time >= yesterdayStart) {
      groups[1].sessions.push(session);
    } else if (time >= sevenDaysStart) {
      groups[2].sessions.push(session);
    } else if (time >= thirtyDaysStart) {
      groups[3].sessions.push(session);
    } else {
      groups[4].sessions.push(session);
    }
  }

  return groups
    .filter((g) => g.sessions.length > 0)
    .map((g) => ({ label: g.label, sessions: g.sessions }));
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
