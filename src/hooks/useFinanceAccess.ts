import { useCallback, useEffect, useState } from 'react';
import type { AppUser } from '../types';
import {
  canDisplayFinancialAmounts,
  canSeeFinancialData,
  clearFinanceUnlocked,
  requiresFinanceCode,
  writeFinanceUnlocked,
} from '../lib/financeAccess';

export function useFinanceAccess(appUser: AppUser | null | undefined) {
  // Всегда стартуем с false — код запрашивается при каждом монтировании компонента
  const [isUnlocked, setIsUnlocked] = useState(false);

  // При смене пользователя сбрасываем
  useEffect(() => {
    setIsUnlocked(false);
  }, [appUser?.uid]);

  const unlock = useCallback(() => {
    writeFinanceUnlocked(appUser?.uid);
    setIsUnlocked(true);
  }, [appUser?.uid]);

  const lock = useCallback(() => {
    clearFinanceUnlocked(appUser?.uid);
    setIsUnlocked(false);
  }, [appUser?.uid]);

  return {
    canSeeFinancialData: canSeeFinancialData(appUser),
    requiresFinanceCode: requiresFinanceCode(appUser),
    canDisplayFinancialAmounts: canDisplayFinancialAmounts(appUser, isUnlocked),
    needsCodeGate: requiresFinanceCode(appUser) && !isUnlocked,
    isUnlocked,
    unlock,
    lock,
  };
}
