import type { FinanceData } from '../types';

export type FinanceLike = Pick<FinanceData, 'contractSum' | 'managerPercentage' | 'expenses'>;

/** Регистронезависимое сравнение вида расхода — своя копия той же логики, что и в
 * lib/plannedExpenses.ts (не импортируем оттуда, чтобы не тянуть за собой лишнее —
 * это единственное место здесь, где сравнение по категории вообще нужно). */
function isSameCategory(a?: string, b?: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

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

// ───────────────────────── план / факт (вкладка «Финансы») ─────────────────────────

/** Сумма ВСЕХ плановых расходов (эти записи управляются только автоматически —
 * см. lib/plannedExpenses.ts). Записи без явного type (старые, до этой доработки)
 * везде трактуются как "actual", поэтому здесь не попадают. */
export function getPlannedExpensesTotal(finance: FinanceLike): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === 'planned')
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/** Сумма ВСЕХ фактических расходов — включая те, что не привязаны ни к какому
 * плановому (свободные расходы, как и раньше: логистика, мокапы и т.п.). */
export function getActualExpensesTotal(finance: FinanceLike): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === 'actual')
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/** Сумма расходов конкретного типа (план/факт) и конкретного вида расхода —
 * используется для карточек "Налог (план)"/"Налог (факт)". */
export function getExpensesTotalByTypeAndCategory(
    finance: FinanceLike,
    type: 'planned' | 'actual',
    category: string
): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === type && isSameCategory(e.category, category))
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/** Чистая прибыль (план) = Сумма контракта − Расходы (план). Специально НЕ
 * учитывает бонус менеджера — бонус считается уже от фактической прибыли, у
 * плана такого понятия нет. */
export function getNetProfitPlanned(finance: FinanceLike): number {
  return (finance.contractSum || 0) - getPlannedExpensesTotal(finance);
}

/** Чистая прибыль (факт) = Сумма контракта − Расходы (факт). */
export function getNetProfitActual(finance: FinanceLike): number {
  return (finance.contractSum || 0) - getActualExpensesTotal(finance);
}

export function getMarginPercentPlanned(finance: FinanceLike): number {
  if (!finance.contractSum) return 0;
  return (getNetProfitPlanned(finance) / finance.contractSum) * 100;
}

export function getMarginPercentActual(finance: FinanceLike): number {
  if (!finance.contractSum) return 0;
  return (getNetProfitActual(finance) / finance.contractSum) * 100;
}