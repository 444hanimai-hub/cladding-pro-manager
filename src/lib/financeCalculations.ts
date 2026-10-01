import type { FinanceData } from '../types';
import { EXPENSE_CATEGORY_TAX } from './plannedExpenses';

export type FinanceLike = Pick<FinanceData, 'contractSum' | 'managerPercentage' | 'expenses'>;

/** Регистронезависимое сравнение вида расхода — своя копия той же логики, что и в
 * lib/plannedExpenses.ts (не импортируем оттуда, чтобы не тянуть за собой лишнее —
 * это единственное место здесь, где сравнение по категории вообще нужно). */
function isSameCategory(a?: string, b?: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

/** Налог — отдельная плановая категория (как и закуп/транспорт/дизайнер/ГП), но
 * показывается своей ОТДЕЛЬНОЙ карточкой, а не внутри "Расходов" — иначе выглядело
 * бы так, будто при подсчёте "Чистая прибыль = контракт − расходы" налог нигде не
 * учитывается, хотя на самом деле он просто молча сидел внутри расходов. */
function isTaxCategory(e: { category: string }): boolean {
  return isSameCategory(e.category, EXPENSE_CATEGORY_TAX);
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

/** true для операций-РАСХОДОВ (включая все старые записи без явного operationType —
 * по умолчанию это расход). Поступления ("income") этим функциям не нужны вообще —
 * они считаются отдельно, см. getActualIncomeTotal. */
function isExpenseOperation(e: { operationType?: 'expense' | 'income' }): boolean {
  return (e.operationType || 'expense') === 'expense';
}

/** Сумма ВСЕХ плановых расходов (эти записи управляются только автоматически —
 * см. lib/plannedExpenses.ts; планового поступления как понятия не существует,
 * но фильтр по operationType оставлен для строгости). Записи без явного type
 * (старые, до этой доработки) везде трактуются как "actual", поэтому здесь не
 * попадают. */
export function getPlannedExpensesTotal(finance: FinanceLike): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === 'planned' && isExpenseOperation(e) && !isTaxCategory(e))
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/** Сумма ВСЕХ фактических РАСХОДОВ (не поступлений, БЕЗ налога — у него своя
 * отдельная карточка) — включая те, что не привязаны ни к какому плановому
 * (свободные расходы, как и раньше: логистика, мокапы и т.п.). */
export function getActualExpensesTotal(finance: FinanceLike): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === 'actual' && isExpenseOperation(e) && !isTaxCategory(e))
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/** Сумма ВСЕХ фактических ПОСТУПЛЕНИЙ от заказчика — это и есть реально
 * оплаченная часть суммы контракта. */
export function getActualIncomeTotal(finance: FinanceLike): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === 'actual' && e.operationType === 'income')
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/** Сумма расходов конкретного типа (план/факт) и конкретного вида расхода —
 * используется для карточек "Налог (план)"/"Налог (факт)". Поступления сюда
 * заведомо не попадают (у них нет вида расхода вообще). */
export function getExpensesTotalByTypeAndCategory(
    finance: FinanceLike,
    type: 'planned' | 'actual',
    category: string
): number {
  return (finance.expenses || [])
      .filter(e => (e.type || 'actual') === type && isExpenseOperation(e) && isSameCategory(e.category, category))
      .reduce((acc, e) => acc + (e.amount || 0), 0);
}

/**
 * Чистая прибыль (план) = Сумма контракта (плановая) − Расходы (план) − Налог
 * (план). Налог вычитается ОТДЕЛЬНЫМ слагаемым (не через getPlannedExpensesTotal,
 * который теперь его намеренно исключает — см. комментарий у isTaxCategory) —
 * итоговое число от этого не меняется, налог по-прежнему учитывается ровно один
 * раз, просто явно, а не молча спрятанным внутри суммы расходов.
 *
 * Специально НЕ учитывает бонус менеджера — бонус считается уже от фактической
 * прибыли, у плана такого понятия нет.
 */
export function getNetProfitPlanned(finance: FinanceLike): number {
  const taxPlanned = getExpensesTotalByTypeAndCategory(finance, 'planned', EXPENSE_CATEGORY_TAX);
  return (finance.contractSum || 0) - getPlannedExpensesTotal(finance) - taxPlanned;
}

/**
 * Чистая прибыль (факт) = фактические ПОСТУПЛЕНИЯ от заказчика − фактические
 * расходы (без налога) − фактический налог отдельным слагаемым (та же причина,
 * что и в плановой формуле выше). Намеренно НЕ от плановой суммы контракта —
 * факт должен отражать реально осевшие деньги, а не то, что теоретически
 * причитается по контракту. Пока заказчик не оплатил всё целиком, эта цифра
 * будет ниже "плана" — это осознанное, ожидаемое поведение, а не ошибка расчёта.
 */
export function getNetProfitActual(finance: FinanceLike): number {
  const taxActual = getExpensesTotalByTypeAndCategory(finance, 'actual', EXPENSE_CATEGORY_TAX);
  return getActualIncomeTotal(finance) - getActualExpensesTotal(finance) - taxActual;
}

export function getMarginPercentPlanned(finance: FinanceLike): number {
  if (!finance.contractSum) return 0;
  return (getNetProfitPlanned(finance) / finance.contractSum) * 100;
}

export function getMarginPercentActual(finance: FinanceLike): number {
  if (!finance.contractSum) return 0;
  return (getNetProfitActual(finance) / finance.contractSum) * 100;
}