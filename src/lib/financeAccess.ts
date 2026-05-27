import type { AppUser } from '../types';

const UNLOCK_STORAGE_PREFIX = 'finance_code_unlocked_';
const OWNER_EMAIL = '444hanimai@gmail.com';

export function isFinanceBypassUser(user: AppUser | null | undefined): boolean {
  return user?.email === OWNER_EMAIL;
}

/** Доступ к финансовым данным (дашборд, контракт, вкладка «Финансы») */
export function canSeeFinancialData(user: AppUser | null | undefined): boolean {
  if (!user) return false;
  if (isFinanceBypassUser(user)) return true;
  return user.accessDashboard === true;
}

/** Нужно вводить код перед показом сумм.
 *  Bypass по email НЕ применяется — владелец тоже вводит код если он включён.
 */
export function requiresFinanceCode(user: AppUser | null | undefined): boolean {
  if (!user || !canSeeFinancialData(user)) return false;
  return user.requireFinanceCode === true && Boolean(user.financeCode?.trim());
}

export function canDisplayFinancialAmounts(
    user: AppUser | null | undefined,
    isUnlocked: boolean
): boolean {
  if (!canSeeFinancialData(user)) return false;
  if (!requiresFinanceCode(user)) return true;
  return isUnlocked;
}

export function getFinanceUnlockStorageKey(uid: string): string {
  return `${UNLOCK_STORAGE_PREFIX}${uid}`;
}

export function readFinanceUnlocked(uid: string | undefined): boolean {
  if (!uid) return false;
  try {
    return sessionStorage.getItem(getFinanceUnlockStorageKey(uid)) === '1';
  } catch {
    return false;
  }
}

export function writeFinanceUnlocked(uid: string | undefined): void {
  if (!uid) return;
  try {
    sessionStorage.setItem(getFinanceUnlockStorageKey(uid), '1');
  } catch { /* sessionStorage недоступен */ }
}

export function clearFinanceUnlocked(uid: string | undefined): void {
  if (!uid) return;
  try {
    sessionStorage.removeItem(getFinanceUnlockStorageKey(uid));
  } catch { /* sessionStorage недоступен */ }
}
