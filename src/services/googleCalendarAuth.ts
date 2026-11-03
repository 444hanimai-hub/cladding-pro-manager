import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/**
 * drive.file (выше) даёт доступ только к файлам, которые СОЗДАЛО само приложение
 * (папки проектов, доверенности, сами КП) — этого достаточно для их создания и
 * загрузки, но НЕ для чтения файлов, которые пользователь положил на Диск вручную
 * (например, фото материалов для КП). drive.readonly — доступ на ЧТЕНИЕ ко всем
 * файлам, которые видны аккаунту пользователя, независимо от того, кто их создал.
 * Добавляем именно readonly, а не полный drive — приложению не нужно ничего менять
 * в чужих файлах, только читать байты для вставки в документ.
 */
const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function createCalendarProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope(CALENDAR_EVENTS_SCOPE);
  provider.addScope(DRIVE_FILE_SCOPE);
  provider.addScope(DRIVE_READONLY_SCOPE);
  // prompt: 'consent' УБРАН намеренно: он заставлял Google показывать экран согласия
  // и предупреждение «приложение не проверено» при КАЖДОМ подключении, даже если человек
  // уже всё разрешал. Теперь согласие запрашивается один раз для аккаунта, дальше
  // Google выдаёт новый токен без этих окон.
  const params: Record<string, string> = {
    access_type: 'online',
    include_granted_scopes: 'true',
  };
  // Подсказка с почтой текущего пользователя: Google не спрашивает «выберите аккаунт»,
  // а сразу открывает нужный.
  const email = auth.currentUser?.email;
  if (email) params.login_hint = email;
  provider.setCustomParameters(params);
  return provider;
}

/**
 * Обычный вход в систему — БЕЗ дополнительных прав (только имя и почта). Для таких прав
 * Google не показывает предупреждение «приложение не проверено» и экран согласия, поэтому
 * вход занимает один клик. Права на Диск и календарь запрашиваются отдельно
 * (connectGoogleCalendar) — один раз, когда они действительно нужны.
 */
export async function signInWithGoogleBasic(): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

function extractAccessToken(result: UserCredential): string | null {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return credential?.accessToken ?? null;
}

/** OAuth-токен Google с правом создавать события в календаре и файлы на Drive,
 * а также читать любые файлы, видимые аккаунту пользователя (для фото материалов). */
export async function connectGoogleCalendar(): Promise<string | null> {
  const provider = createCalendarProvider();
  const currentUser = auth.currentUser;

  const result = currentUser
      ? await reauthenticateWithPopup(currentUser, provider)
      : await signInWithPopup(auth, provider);

  return extractAccessToken(result);
}

// ───────────────────────── токен Google: хранение и обновление по клику ─────────────────────────

export const GOOGLE_TOKEN_KEY = 'google_calendar_access_token';
const GOOGLE_TOKEN_TIME_KEY = 'google_calendar_access_token_time';
/** Токен Google живёт час; считаем его действующим чуть меньше — с запасом. */
export const GOOGLE_TOKEN_TTL_MS = 55 * 60 * 1000;
/** Событие, которым обновлённый токен сообщается приложению (App.tsx подхватывает его в состояние). */
export const GOOGLE_TOKEN_EVENT = 'google-token-updated';

/** Токен из памяти браузера, если он ещё действует (по времени получения), иначе null. */
export function getStoredGoogleToken(): string | null {
  try {
    const token = localStorage.getItem(GOOGLE_TOKEN_KEY);
    const savedAt = Number(localStorage.getItem(GOOGLE_TOKEN_TIME_KEY));
    if (!token || !savedAt || Date.now() - savedAt > GOOGLE_TOKEN_TTL_MS) return null;
    return token;
  } catch {
    return null;
  }
}

/** Время получения сохранённого токена (мс) — чтобы App мог поставить таймер истечения. */
export function getStoredGoogleTokenSavedAt(): number {
  try {
    return Number(localStorage.getItem(GOOGLE_TOKEN_TIME_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function storeGoogleToken(token: string): void {
  try {
    localStorage.setItem(GOOGLE_TOKEN_KEY, token);
    localStorage.setItem(GOOGLE_TOKEN_TIME_KEY, String(Date.now()));
  } catch { /* память браузера недоступна — токен просто не переживёт перезагрузку */ }
  window.dispatchEvent(new CustomEvent(GOOGLE_TOKEN_EVENT, { detail: token }));
}

export function clearStoredGoogleToken(): void {
  try {
    localStorage.removeItem(GOOGLE_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_TOKEN_TIME_KEY);
  } catch { /* ничего */ }
}

let tokenRequestInFlight: Promise<string | null> | null = null;

/**
 * Возвращает действующий токен Google. Если он есть и не истёк — отдаёт сразу, без окон.
 * Если истёк или его не было — открывает короткое окно Google (экран согласия не показывается,
 * если человек уже давал права) и сохраняет новый токен. Вызывать нужно ИЗ обработчика
 * нажатия кнопки и как можно раньше (до других await) — иначе браузер заблокирует окно.
 * Если человек закрыл окно — вернёт null (вызывающий решает, что делать дальше).
 */
export async function ensureGoogleToken(): Promise<string | null> {
  const stored = getStoredGoogleToken();
  if (stored) return stored;
  if (tokenRequestInFlight) return tokenRequestInFlight;

  tokenRequestInFlight = (async () => {
    try {
      const token = await connectGoogleCalendar();
      if (token) storeGoogleToken(token);
      return token;
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error
          ? String((error as { code: string }).code) : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null;
      console.error('Не удалось обновить доступ к Google:', error);
      return null;
    } finally {
      tokenRequestInFlight = null;
    }
  })();
  return tokenRequestInFlight;
}