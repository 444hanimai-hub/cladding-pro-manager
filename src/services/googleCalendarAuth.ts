import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

function createCalendarProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope(CALENDAR_EVENTS_SCOPE);
  provider.addScope(DRIVE_FILE_SCOPE);
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

/** OAuth-токен Google с правом создавать события в календаре и файлы на Drive */
export async function connectGoogleCalendar(): Promise<string | null> {
  const provider = createCalendarProvider();
  const currentUser = auth.currentUser;

  const result = currentUser
      ? await reauthenticateWithPopup(currentUser, provider)
      : await signInWithPopup(auth, provider);

  return extractAccessToken(result);
}
