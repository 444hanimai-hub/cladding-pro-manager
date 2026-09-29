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
  provider.setCustomParameters({
    prompt: 'consent',
    access_type: 'online',
  });
  return provider;
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