import { useCallback, useEffect, useState } from 'react';
import type { AppUser } from '../types';
import {
  canDisplayFinancialAmounts,
  canSeeFinancialData,
  clearFinanceUnlocked,
  readFinanceUnlocked,
  requiresFinanceCode,
  writeFinanceUnlocked,
} from '../lib/financeAccess';

export function useFinanceAccess(appUser: AppUser | null | undefined) {
  const [isUnlocked, setIsUnlocked] = useState(() => readFinanceUnlocked(appUser?.uid));

  useEffect(() => {
    setIsUnlocked(readFinanceUnlocked(appUser?.uid));
  }, [appUser?.uid]);

  const unlock = useCallback(() => {
    writeFinanceUnlocked(appUser?.uid);
    setIsUnlocked(true);
  }, [appUser?.uid]);

  const lock = useCallback(() => {
    clearFinanceUnlocked(appUser?.uid);
    setIsUnlocked(false);
  }, [appUser?.uid]);

  const unlocked = isUnlocked;

  return {
    canSeeFinancialData: canSeeFinancialData(appUser),
    requiresFinanceCode: requiresFinanceCode(appUser),
    canDisplayFinancialAmounts: canDisplayFinancialAmounts(appUser, unlocked),
    needsCodeGate: requiresFinanceCode(appUser) && !unlocked,
    isUnlocked: unlocked,
    unlock,
    lock,
  };
}
