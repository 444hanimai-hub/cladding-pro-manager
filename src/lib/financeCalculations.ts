import type { FinanceData } from '../types';

export type FinanceLike = Pick<FinanceData, 'contractSum' | 'managerPercentage' | 'expenses'>;

export function getTotalExpenses(finance: FinanceLike): number {
  return (finance.expenses || []).reduce((acc, exp) => acc + (exp.amount || 0), 0);
}

/** Прибыль до бонуса: контракт − расходы */
export function getProfitBeforeBonus(finance: FinanceLike): number {
  return finance.contractSum - getTotalExpenses(finance);
}

/** Сумма бонуса менеджера */
export function getManagerBonus(finance: FinanceLike): number {
  return getProfitBeforeBonus(finance) * (finance.managerPercentage || 0) / 100;
}

/** Чистая прибыль после расходов и бонуса */
export function getNetProfitAfterAll(finance: FinanceLike): number {
  return getProfitBeforeBonus(finance) - getManagerBonus(finance);
}

/** Маржа, % от суммы контракта (после расходов и бонусов) */
export function getMarginPercent(finance: FinanceLike): number {
  if (!finance.contractSum) return 0;
  return (getNetProfitAfterAll(finance) / finance.contractSum) * 100;
}

export function getMarginColor(marginPct: number): string {
  if (marginPct >= 25) return '#2f5e3f';
  if (marginPct >= 10) return 'var(--ochre)';
  return 'var(--terracotta)';
}
