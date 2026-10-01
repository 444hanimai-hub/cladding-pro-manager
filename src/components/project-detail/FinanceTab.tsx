import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { X, Trash2, Paperclip, ExternalLink, Loader2, FileText, PieChart as PieChartIcon, ChevronDown } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { cn, formatCurrency, formatAmountGrouped, parseGroupedAmount } from '../../lib/utils';
import {
    getPlannedExpensesTotal,
    getActualExpensesTotal,
    getExpensesTotalByTypeAndCategory,
    getNetProfitPlanned,
    getNetProfitActual,
    getMarginPercentPlanned,
    getMarginPercentActual,
    getActualIncomeTotal,
} from '../../lib/financeCalculations';
import { EXPENSE_CATEGORY_TAX, EXPENSE_CATEGORY_PURCHASE, EXPENSE_CATEGORY_TRANSPORT, EXPENSE_CATEGORY_DESIGNER, EXPENSE_CATEGORY_GC } from '../../lib/plannedExpenses';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { Project, AppUser, Expense, ExpenseReceiptFile, ProjectMaterial } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import CodeProtection from '../CodeProtection';
import { ensureProjectDocsFolder, findOrCreateSubfolder, formatDateYMD } from '../../lib/googleDriveFolders';
import { uploadFileToDrive, deleteDriveFile, buildReceiptFileName } from '../../lib/googleDriveFiles';
import { calcMaterial } from '../../lib/materialFinance';

const EXPENSES_SUBFOLDER_NAME = 'Расходы';

/** Короткая склейка "Наименование · Поставщик" — для выпадающих списков формы
 * (там, где вся строка и так видна целиком, характеристики были бы избыточны). */
function getMaterialShortLabel(m?: ProjectMaterial): string {
    if (!m) return '';
    return m.supplierName ? `${m.materialName} · ${m.supplierName}` : m.materialName || '';
}

/** Полная склейка "Наименование, Характеристики, Поставщик" — заголовок группы
 * материала в таблице финансовых операций. Характеристики берутся из КАТАЛОГА
 * материалов (справочника) по materialId; поставщик — из самой позиции сметы
 * (ProjectMaterial.supplierName), а не производитель из каталога — это разные
 * вещи (тот же принцип, что и в форме доверенности). */
function getMaterialFullLabel(m: ProjectMaterial | undefined, directories: any): string {
    if (!m) return '';
    const catalogMaterial = (directories?.materials || []).find((dm: any) => dm.id === m.materialId);
    return [m.materialName, catalogMaterial?.characteristics, (m as any).supplierName].filter(Boolean).join(', ');
}

function formatExpenseDate(dateStr: string): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function FinanceTab({
                        project,
                        canEdit,
                        users,
                        appUser,
                        needsCodeGate,
                        onUnlock,
                        accessToken,
                        onConnectCalendar,
                        directories,
                    }: {
    project: Project;
    canEdit: boolean;
    users: AppUser[];
    appUser: AppUser | null;
    needsCodeGate: boolean;
    onUnlock: () => void;
    accessToken?: string | null;
    onConnectCalendar?: () => Promise<boolean>;
    directories?: any;
}) {
    // modalMode: какая форма открыта — расход (все текущие поля) или поступление
    // (только дата/сумма/комментарий/документы). null — обе закрыты.
    const [modalMode, setModalMode] = useState<'expense' | 'income' | null>(null);
    const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

    if (needsCodeGate) {
        return (
            <div className="flex justify-center py-10">
                <CodeProtection
                    correctCode={appUser?.financeCode || ''}
                    onSuccess={onUnlock}
                    subtitle="Для просмотра вкладки «Финансы» введите код доступа"
                />
            </div>
        );
    }

    const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
    const expenses = f.expenses || [];
    const materials = project.materials || [];

    // ── Карточки план/факт ──
    const plannedExpensesTotal = getPlannedExpensesTotal(f);
    const actualExpensesTotal = getActualExpensesTotal(f);
    const taxPlanned = getExpensesTotalByTypeAndCategory(f, 'planned', EXPENSE_CATEGORY_TAX);
    const taxActual = getExpensesTotalByTypeAndCategory(f, 'actual', EXPENSE_CATEGORY_TAX);
    const netProfitPlanned = getNetProfitPlanned(f);
    const netProfitActual = getNetProfitActual(f);
    const actualIncomeTotal = getActualIncomeTotal(f);
    const marginPlanned = getMarginPercentPlanned(f);
    const marginActual = getMarginPercentActual(f);

    const updateFinance = async (updates: Partial<typeof f>) => {
        try {
            const cleanUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
                if (value !== undefined) {
                    acc[key as keyof typeof f] = value;
                }
                return acc;
            }, {} as any);

            const newFinance = { ...f, ...cleanUpdates };

            if (newFinance.expenses) {
                newFinance.expenses = newFinance.expenses.map((exp: any) => {
                    const cleanExp = { ...exp };
                    Object.keys(cleanExp).forEach(key => {
                        if (cleanExp[key] === undefined) {
                            delete cleanExp[key];
                        }
                    });
                    return cleanExp;
                });
            }

            await updateDoc(doc(db, 'projects', Object.is(project, null) ? '' : project.id), { finance: newFinance, updatedAt: serverTimestamp() });
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${Object.is(project, null) ? '' : project.id}`);
        }
    };

    const handleOpenAddExpense = () => {
        setEditingExpenseId(null);
        setModalMode('expense');
    };

    const handleOpenAddIncome = () => {
        setEditingExpenseId(null);
        setModalMode('income');
    };

    /** Клик по строке таблицы — открывает СВОЮ форму в зависимости от того, чем эта
     * операция была заведена (расход или поступление), не только по её текущему виду. */
    const handleOpenEditRow = (expenseId: string) => {
        const target = expenses.find(e => e.id === expenseId);
        if (!target) return;
        setEditingExpenseId(expenseId);
        setModalMode(target.operationType === 'income' ? 'income' : 'expense');
    };

    const handleSaveExpense = async (expenseData: Expense) => {
        try {
            let updatedExpenses;
            if (editingExpenseId) {
                updatedExpenses = expenses.map(e => e.id === editingExpenseId ? expenseData : e);
            } else {
                updatedExpenses = [...expenses, expenseData];
            }
            await updateFinance({ expenses: updatedExpenses });
            setModalMode(null);
            setEditingExpenseId(null);
        } catch (error) {
            console.error(error);
        }
    };

    const removeExpense = async (id: string) => {
        if (!canEdit) return;
        try {
            const updatedExpenses = expenses.filter(e => e.id !== id);
            await updateFinance({ expenses: updatedExpenses });
        } catch (error) {
            console.error(error);
        }
    };

    // ── Группировка таблицы — ПО МАТЕРИАЛУ (а не плоским списком, как раньше):
    // группа-заголовок материала (склейка "Наименование, Характеристики, Поставщик"
    // + маржа с НДС план/факт) → под ней его плановые расходы (серая заливка) →
    // под каждым плановым — его фактические, по возрастанию даты → затем
    // фактические/поступления ЭТОГО материала без ссылки на план, тоже по
    // возрастанию даты. Отдельным, безымянным хвостом в конце — операции совсем
    // БЕЗ материала (общий налог по проекту, бонус менеджера, свободные расходы) —
    // для них "маржа по материалу" смысла не имеет, группы без заголовка. ──
    const plannedExpenses = expenses.filter(e => (e.type || 'actual') === 'planned');
    const actualOperations = expenses.filter(e => (e.type || 'actual') === 'actual');
    // Только фактические РАСХОДЫ (без поступлений) — отдельно, для диаграммы
    // "Структура расходов" и общей суммы, которая не должна включать поступления.
    const actualExpenseOperations = actualOperations.filter(e => (e.operationType || 'expense') === 'expense');

    const categoryPriority: Record<string, number> = {
        [EXPENSE_CATEGORY_PURCHASE]: 0,
        [EXPENSE_CATEGORY_TRANSPORT]: 1,
        [EXPENSE_CATEGORY_DESIGNER]: 2,
        [EXPENSE_CATEGORY_GC]: 3,
    };
    const byDateAsc = (a: Expense, b: Expense) => new Date(a.date).getTime() - new Date(b.date).getTime();

    type RenderRow = { expense: Expense; isPlanned: boolean };
    type MaterialGroup = {
        material: ProjectMaterial;
        label: string;
        marginPlanned: number;
        marginActual: number;
        rows: RenderRow[];
    };

    // Какие записи уже "разобраны" по материальным группам — остаток (без
    // материала вообще) считается тем, что сюда не попало.
    const consumedIds = new Set<string>();

    const materialGroups: MaterialGroup[] = materials.map(m => {
        const calc = calcMaterial(m);
        // "Маржа с НДС" — тот же показатель и та же формула, что и в DetailSection
        // на вкладке «Материалы» (calc.marginExVat, несмотря на название переменной —
        // так называется в интерфейсе по ранее согласованной терминологии).
        const marginPlanned = calc.marginExVat;

        const materialPlanned = plannedExpenses
            .filter(e => e.materialId === m.id)
            .sort((a, b) => (categoryPriority[a.category] ?? 99) - (categoryPriority[b.category] ?? 99));

        const rows: RenderRow[] = [];
        let actualExpenseSum = 0;
        let actualIncomeSum = 0;

        for (const planned of materialPlanned) {
            rows.push({ expense: planned, isPlanned: true });
            consumedIds.add(planned.id);
            const children = actualOperations.filter(a => a.plannedExpenseId === planned.id).sort(byDateAsc);
            for (const child of children) {
                rows.push({ expense: child, isPlanned: false });
                consumedIds.add(child.id);
                if ((child.operationType || 'expense') === 'expense') actualExpenseSum += child.amount || 0;
                else actualIncomeSum += child.amount || 0;
            }
        }

        // Фактические расходы/поступления ЭТОГО материала без ссылки на план —
        // по возрастанию даты, следом за всеми плановыми группами.
        const trailing = actualOperations
            .filter(a => a.materialId === m.id && !consumedIds.has(a.id))
            .sort(byDateAsc);
        for (const t of trailing) {
            rows.push({ expense: t, isPlanned: false });
            consumedIds.add(t.id);
            if ((t.operationType || 'expense') === 'expense') actualExpenseSum += t.amount || 0;
            else actualIncomeSum += t.amount || 0;
        }

        return {
            material: m,
            label: getMaterialFullLabel(m, directories),
            marginPlanned,
            // "Маржа с НДС факт" = сумма всех поступлений по материалу − все расходы
            // по материалу (именно так, как и попросили — не через calcMaterial).
            marginActual: actualIncomeSum - actualExpenseSum,
            rows,
        };
    });

    // Хвост: всё, что совсем без материала (общий налог по проекту, бонус
    // менеджера, свободные расходы/поступления) — та же логика план→факт→свободное,
    // просто без привязки к конкретному материалу и без строки маржи.
    const leftoverPlanned = plannedExpenses.filter(e => !e.materialId);
    const leftoverRows: RenderRow[] = [];
    for (const planned of leftoverPlanned) {
        leftoverRows.push({ expense: planned, isPlanned: true });
        consumedIds.add(planned.id);
        const children = actualOperations
            .filter(a => a.plannedExpenseId === planned.id && !consumedIds.has(a.id))
            .sort(byDateAsc);
        for (const c of children) {
            leftoverRows.push({ expense: c, isPlanned: false });
            consumedIds.add(c.id);
        }
    }
    const leftoverTrailing = actualOperations.filter(a => !consumedIds.has(a.id)).sort(byDateAsc);
    for (const t of leftoverTrailing) {
        leftoverRows.push({ expense: t, isPlanned: false });
        consumedIds.add(t.id);
    }

    // Единый плоский список ВСЕХ отображаемых строк (группы материалов подряд +
    // хвост без материала) — нужен только для подсчёта вариантов фильтров и общего
    // "пусто" состояния; для самого рендера группы обрабатываются отдельно (см. JSX).
    const allRows: RenderRow[] = [...materialGroups.flatMap(g => g.rows), ...leftoverRows];

    // ── Фильтры по колонкам (кроме «Сумма») — значения считаются по ВСЕМ строкам
    // (а не только по уже отфильтрованным), чтобы список вариантов не "прыгал"
    // при включении другого фильтра. Колонки "Материал" больше нет (он теперь в
    // заголовке группы) — фильтра по нему тоже больше нет. ──
    const [dateFilter, setDateFilter] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
    const [docsFilter, setDocsFilter] = useState<string | null>(null);
    const DOCS_FILTER_YES = 'Есть документы';
    const DOCS_FILTER_NO = 'Нет документов';

    // У поступления нет своего "вида расхода" (своего справочника) — в этой колонке
    // для него всегда просто "Поступление", вне зависимости от того, что лежит
    // (или не лежит) в поле category самой записи.
    const rowCategoryLabel = (expense: Expense) => expense.operationType === 'income' ? 'Поступление' : (expense.category || '');

    const uniqueSorted = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));
    const dateOptions = uniqueSorted(allRows.map(r => r.isPlanned ? '' : formatExpenseDate(r.expense.date)).filter(Boolean));
    const categoryOptions = uniqueSorted(allRows.map(r => rowCategoryLabel(r.expense)));
    const docsOptions = [DOCS_FILTER_YES, DOCS_FILTER_NO];

    const passesFilters = ({ expense, isPlanned }: RenderRow) => {
        if (dateFilter !== null) {
            const label = isPlanned ? '' : formatExpenseDate(expense.date);
            if (label !== dateFilter) return false;
        }
        if (categoryFilter !== null && rowCategoryLabel(expense) !== categoryFilter) return false;
        if (docsFilter !== null) {
            const hasDocs = !!(expense.receipts && expense.receipts.length > 0);
            if (docsFilter === DOCS_FILTER_YES && !hasDocs) return false;
            if (docsFilter === DOCS_FILTER_NO && hasDocs) return false;
        }
        return true;
    };

    const filteredMaterialGroups = materialGroups
        .map(g => ({ ...g, rows: g.rows.filter(passesFilters) }))
        .filter(g => g.rows.length > 0);
    const filteredLeftoverRows = leftoverRows.filter(passesFilters);
    const hasAnyVisibleRows = filteredMaterialGroups.some(g => g.rows.length > 0) || filteredLeftoverRows.length > 0;

    const editingExpense = editingExpenseId ? expenses.find(e => e.id === editingExpenseId) || null : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
        >
            {/* Сводные карточки план/факт — 5 штук: контракт (чёрная, без плана — у суммы
                контракта нет понятия "план", это одно редактируемое число) + 4 карточки
                план/факт с плашкой соотношения. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <div
                    className="flex min-h-[108px] flex-col gap-1.5 rounded-2xl p-[18px_20px] relative overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, var(--ink) 0%, #2a2618 100%)', border: '1px solid #2a2618' }}
                >
                    <div className="flex items-start justify-between gap-2">
                        <p className={DASHBOARD_CARD_LABEL} style={{ color: 'rgba(245,233,204,0.6)' }}>СУММА КОНТРАКТА</p>
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums whitespace-nowrap" style={{ background: 'rgba(245,233,204,0.12)', color: 'rgba(245,233,204,0.85)' }}>
                            {formatRatioBadge(f.contractSum, actualIncomeTotal)}
                        </span>
                    </div>
                    {canEdit ? (
                        <ContractSumInput value={f.contractSum} onChange={(v) => updateFinance({ contractSum: v })} />
                    ) : (
                        <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className={cn(DASHBOARD_CARD_VALUE, 'text-bg')}>{formatAmountGrouped(f.contractSum)}</span>
                            <span className={cn(DASHBOARD_CARD_UNIT, 'text-bg shrink-0')}>₽</span>
                        </div>
                    )}
                    {/* Фактически поступившая часть — то, что заказчик уже реально оплатил. */}
                    <p className="text-[13px] font-semibold tabular-nums" style={{ color: '#7fc98f' }}>
                        {formatAmountGrouped(actualIncomeTotal)} ₽
                    </p>
                </div>

                <PlanFactCard label="РАСХОДЫ" plannedValue={plannedExpensesTotal} actualValue={actualExpensesTotal} colorCategory="expense" />
                <PlanFactCard label="НАЛОГ К УПЛАТЕ" plannedValue={taxPlanned} actualValue={taxActual} colorCategory="expense" />
                <PlanFactCard label="ЧИСТАЯ ПРИБЫЛЬ" plannedValue={netProfitPlanned} actualValue={netProfitActual} colorCategory="profit" />
                <PlanFactCard label="РЕНТАБЕЛЬНОСТЬ" plannedValue={marginPlanned} actualValue={marginActual} colorCategory="profit" isPercentage badgeMode="diffPP" />
            </div>

            {/* Расходы + диаграмма */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 items-start">
                <div className="xl:col-span-3 overflow-hidden rounded-[18px] border border-[#DED8CC] bg-[#F8F3E9] shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_3px_rgba(48,42,28,0.08)]">
                    <div className="flex items-center justify-between gap-4 border-b border-[#DED8CC] px-4 py-3">
                        <h3 className="font-display text-[15px] font-medium leading-tight text-[#302A1C]">
                            Финансовые операции по проекту
                        </h3>

                        {canEdit && (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleOpenAddIncome}
                                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors border-[#9bc49f] bg-[#4f8a5c] text-white shadow-[0_1px_2px_rgba(47,94,63,0.18)] hover:bg-[#447a51]"
                                >
                                    Поступление
                                </button>
                                <button
                                    type="button"
                                    onClick={handleOpenAddExpense}
                                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors border-[#D8B978] bg-[#B48444] text-white shadow-[0_1px_2px_rgba(132,91,37,0.18)] hover:bg-[#A6783D]"
                                >
                                    Расход
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[680px] border-collapse text-left">
                            <thead>
                            <tr className="border-b border-[#DED8CC] bg-[#F8F3E9]">
                                <ColumnFilterHeader label="Дата" options={dateOptions} value={dateFilter} onChange={setDateFilter} />
                                <ColumnFilterHeader label="Вид операции" options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />
                                <ColumnFilterHeader label="Документы" options={docsOptions} value={docsFilter} onChange={setDocsFilter} align="center" />
                                <th className="px-4 py-2.5 text-right text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                    Сумма
                                </th>
                                {canEdit && <th className="w-10 px-2 py-2.5" />}
                            </tr>
                            </thead>

                            <tbody className="divide-y divide-[#DED8CC] bg-[#FBF8F2]/50">
                            {filteredMaterialGroups.map(group => (
                                <React.Fragment key={group.material.id}>
                                    <MaterialGroupHeaderRow
                                        label={group.label}
                                        marginPlanned={group.marginPlanned}
                                        marginActual={group.marginActual}
                                        colSpan={canEdit ? 5 : 4}
                                    />
                                    {group.rows.map(({ expense, isPlanned }) => (
                                        <OperationRow
                                            key={expense.id}
                                            expense={expense}
                                            isPlanned={isPlanned}
                                            canEdit={canEdit}
                                            onRowClick={() => canEdit && !isPlanned && handleOpenEditRow(expense.id)}
                                            onDelete={() => removeExpense(expense.id)}
                                        />
                                    ))}
                                </React.Fragment>
                            ))}

                            {filteredLeftoverRows.map(({ expense, isPlanned }) => (
                                <OperationRow
                                    key={expense.id}
                                    expense={expense}
                                    isPlanned={isPlanned}
                                    canEdit={canEdit}
                                    onRowClick={() => canEdit && !isPlanned && handleOpenEditRow(expense.id)}
                                    onDelete={() => removeExpense(expense.id)}
                                />
                            ))}

                            {!hasAnyVisibleRows && (
                                <tr>
                                    <td
                                        colSpan={canEdit ? 5 : 4}
                                        className="px-4 py-10 text-center"
                                    >
                                        <p className="text-[12px] font-medium text-[#8A8574]">
                                            {allRows.length === 0 ? 'Расходы пока не добавлены' : 'Нет расходов по выбранным фильтрам'}
                                        </p>
                                    </td>
                                </tr>
                            )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="xl:col-span-2 rounded-[18px] border border-[#DED8CC] bg-[#F8F3E9] p-5 shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_3px_rgba(48,42,28,0.08)]">
                    <p className={cn(DASHBOARD_CARD_LABEL, 'mb-4 text-center text-[#8A8574]')}>
                        Структура расходов
                    </p>

                    {actualExpenseOperations.length > 0 ? (() => {
                        const chartData = actualExpenseOperations.reduce((acc: { name: string; value: number }[], exp) => {
                            const existing = acc.find(item => item.name === exp.category);
                            if (existing) {
                                existing.value += exp.amount;
                            } else {
                                acc.push({ name: exp.category, value: exp.amount });
                            }
                            return acc;
                        }, []);
                        return (
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={chartData}
                                            dataKey="value"
                                            nameKey="name"
                                            innerRadius={54}
                                            outerRadius={80}
                                            paddingAngle={2}
                                            stroke="none"
                                        >
                                            {chartData.map((entry, index) => (
                                                <Cell
                                                    key={`expense-cell-${entry.name}-${index}`}
                                                    fill={getExpenseCategoryColor(entry.name, index)}
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            formatter={(value: number) => formatCurrency(value)}
                                            contentStyle={{
                                                borderRadius: 12,
                                                border: '1px solid #DED8CC',
                                                background: '#FBF8F2',
                                                color: '#302A1C',
                                                boxShadow: '0 8px 20px rgba(48,42,28,0.08)',
                                                fontSize: 12,
                                            }}
                                        />
                                        <Legend
                                            verticalAlign="bottom"
                                            align="center"
                                            iconType="circle"
                                            iconSize={8}
                                            wrapperStyle={{ paddingTop: 16, fontSize: 11.5, color: '#59523E' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        );
                    })() : (
                        <div className="flex h-[260px] flex-col items-center justify-center text-center">
                            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#EFE7D7] text-[#B8AE9A]">
                                <PieChartIcon size={22} strokeWidth={1.8} />
                            </div>
                            <p className="text-[12px] font-medium text-[#8A8574]">
                                Фактических расходов пока нет
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {modalMode === 'expense' && (
                    <ExpenseModal
                        project={project}
                        expenses={expenses}
                        editingExpense={editingExpense}
                        contractSum={f.contractSum || 0}
                        accessToken={accessToken}
                        onConnectCalendar={onConnectCalendar}
                        onClose={() => { setModalMode(null); setEditingExpenseId(null); }}
                        onSave={handleSaveExpense}
                    />
                )}
                {modalMode === 'income' && (
                    <IncomeModal
                        project={project}
                        editingExpense={editingExpense}
                        accessToken={accessToken}
                        onConnectCalendar={onConnectCalendar}
                        onClose={() => { setModalMode(null); setEditingExpenseId(null); }}
                        onSave={handleSaveExpense}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
    Логистика: '#b07a2c',
    Мокап: '#2d4f35',
    Образцы: '#3b4a55',
    Монтаж: '#a04930',
    Закупка: '#5a6b3c',
};

const EXPENSE_CATEGORY_FALLBACK = ['#b07a2c', '#2d4f35', '#3b4a55', '#a04930', '#5a6b3c', '#7a7565'];

function getExpenseCategoryColor(category: string, index: number): string {
    return EXPENSE_CATEGORY_COLORS[category] ?? EXPENSE_CATEGORY_FALLBACK[index % EXPENSE_CATEGORY_FALLBACK.length];
}

/** Заголовок колонки таблицы с выпадающим фильтром по значению — тот же паттерн,
 * что и фильтр «Тип» в справочнике компаний: портал, чтобы не резалось overflow
 * таблицы, закрытие по клику снаружи. */
function ColumnFilterHeader({ label, options, value, onChange, align = 'left' }: {
    label: string;
    options: string[];
    value: string | null;
    onChange: (v: string | null) => void;
    align?: 'left' | 'center';
}) {
    const [open, setOpen] = useState(false);
    const btnRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const filterId = `expense-col-filter-${label}`;

    useEffect(() => {
        if (!open) return;
        if (btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setCoords({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
        }
        const handler = (e: MouseEvent) => {
            if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
                const dropdown = document.getElementById(filterId);
                if (!dropdown || !dropdown.contains(e.target as Node)) setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, filterId]);

    return (
        <th className={cn("px-4 py-2.5 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]", align === 'center' && "text-center")}>
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen(o => !o)}
                className={cn("inline-flex items-center gap-1 transition-colors hover:text-[#302A1C]", value && "text-[#B48444]")}
            >
                {label}
                <ChevronDown size={9} className={cn("transition-transform", open && "rotate-180")} />
                {value && <span className="w-1.5 h-1.5 rounded-full bg-[#B48444] shrink-0" />}
            </button>
            {open && createPortal(
                <div
                    id={filterId}
                    style={{ position: 'absolute', top: `${coords.top}px`, left: `${coords.left}px`, zIndex: 999999, minWidth: '200px', maxWidth: '280px' }}
                    className="bg-surface border border-line rounded-md shadow-[0_8px_32px_rgba(48,42,28,0.16)] overflow-hidden"
                >
                    <div className="max-h-[260px] overflow-y-auto">
                        <button
                            type="button"
                            onClick={() => { onChange(null); setOpen(false); }}
                            className={cn("w-full text-left px-3 py-2 text-[12px] normal-case font-normal tracking-normal transition-colors",
                                !value ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold" : "text-ink hover:bg-surface-2"
                            )}
                        >Все</button>
                        {options.map(opt => (
                            <button
                                key={opt}
                                type="button"
                                onClick={() => { onChange(opt); setOpen(false); }}
                                className={cn("w-full text-left px-3 py-2 text-[12px] normal-case font-normal tracking-normal truncate transition-colors",
                                    value === opt ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold" : "text-ink hover:bg-surface-2"
                                )}
                                title={opt}
                            >{opt}</button>
                        ))}
                        {options.length === 0 && (
                            <p className="px-3 py-2 text-[11.5px] italic text-ink-4 normal-case font-normal tracking-normal">Нет значений</p>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </th>
    );
}

/** Строка-заголовок группы материала в таблице финансовых операций — склейка
 * "Наименование, Характеристики, Поставщик" слева, маржа с НДС план/факт справа
 * (факт — сумма поступлений по материалу минус расходы по нему; красится
 * терракотовым, если ушла в минус, иначе зелёным). */
function MaterialGroupHeaderRow({ label, marginPlanned, marginActual, colSpan }: {
    label: string;
    marginPlanned: number;
    marginActual: number;
    colSpan: number;
}) {
    const factColor = marginActual < 0 ? '#a04930' : '#2f5e3f';
    return (
        <tr className="bg-[#EFE4C8]">
            <td colSpan={colSpan} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[12.5px] font-bold text-[#4A3B1E]">{label}</span>
                    <span className="text-[11.5px] font-mono tabular-nums whitespace-nowrap">
                        <span className="text-[#6B5B3A]">Маржа с НДС: <span className="font-bold">{formatCurrency(marginPlanned)}</span></span>
                        <span className="mx-1.5 text-[#B8AE9A]">/</span>
                        <span className="font-bold" style={{ color: factColor }}>{formatCurrency(marginActual)}</span>
                    </span>
                </div>
            </td>
        </tr>
    );
}

/** Одна строка операции (план/факт-расход или поступление) в таблице финансовых
 * операций — вынесена в отдельный компонент, т.к. используется и внутри групп
 * по материалу, и в безымянном хвосте операций без материала. */
function OperationRow({ expense, isPlanned, canEdit, onRowClick, onDelete }: {
    expense: Expense;
    isPlanned: boolean;
    canEdit: boolean;
    onRowClick: () => void;
    onDelete: () => void;
}) {
    return (
        <tr
            onClick={onRowClick}
            className={cn(
                "group transition-colors",
                isPlanned ? "bg-[#EFEAE0]" : "hover:bg-white/60",
                canEdit && !isPlanned && "cursor-pointer"
            )}
        >
            <td className={cn("px-4 py-3 text-[11.5px] font-medium tabular-nums", isPlanned ? "text-[#6B6555]" : "text-[#8A8574]")}>
                {isPlanned ? '' : formatExpenseDate(expense.date)}
            </td>

            <td className={cn("px-4 py-3", !isPlanned && "pl-7")}>
                <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("truncate text-[12.5px] font-medium", isPlanned ? "text-[#4A4636] font-semibold" : "text-[#302A1C]")}>
            {expense.operationType === 'income' ? 'Поступление' : (expense.category || 'Без категории')}
          </span>
                    {(expense.managerPercent || 0) > 0 && (
                        <span className="text-[10px] text-[#B48444] font-semibold shrink-0">{expense.managerPercent}%</span>
                    )}
                </div>
                {expense.description && (
                    <p className="text-[11px] text-[#8A8574] truncate mt-0.5 max-w-[220px]">{expense.description}</p>
                )}
            </td>

            <td className="px-4 py-3 text-center">
                {expense.receipts && expense.receipts.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#8A8574]">
                        <Paperclip size={12} /> {expense.receipts.length}
                    </span>
                ) : (
                    <span className="text-[11px] text-[#C9C2AE]">—</span>
                )}
            </td>

            <td className="px-4 py-3 text-right">
        <span
            className="font-mono text-[12.5px] font-bold tabular-nums"
            style={{ color: isPlanned ? '#4A4636' : (expense.operationType === 'income' ? '#2f5e3f' : '#9B3F54') }}
        >
          {formatCurrency(expense.amount)}
        </span>
            </td>

            {canEdit && (
                <td className="px-2 py-3 text-right">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="rounded-md p-1 text-[#8A8574]/50 opacity-0 transition-all hover:bg-[#9B3F54]/8 hover:text-[#9B3F54] group-hover:opacity-100"
                        aria-label="Удалить операцию"
                        title={isPlanned ? 'Удалить плановый расход — при следующем сохранении материала он может появиться снова' : 'Удалить операцию'}
                    >
                        <Trash2 size={12} strokeWidth={1.9} />
                    </button>
                </td>
            )}
        </tr>
    );
}

/** Стили карточек как SummaryCard на дашборде */
export const DASHBOARD_CARD_LABEL = 'text-[10.5px] font-semibold uppercase tracking-[0.14em]';
export const DASHBOARD_CARD_VALUE = 'font-display text-[34px] leading-[1.05] tabular-nums';
export const DASHBOARD_CARD_UNIT = 'font-display text-[14px] opacity-70';
export const DASHBOARD_CARD_SUB = 'text-[11.5px] text-ink-3 mt-0.5';

const PLAN_FACT_COLORS = {
    profit: '#2f5e3f',    // зелёный — чистая прибыль и рентабельность, когда факт неотрицательный
    expense: '#8a3f47',   // красный — расходы и налог
    negative: '#a04930',  // терракотовый — любой факт, ушедший в минус, независимо от категории
} as const;

/** "XX%" = факт/план × 100, округлено. "—", если план равен нулю (соотношение не
 * имеет смысла — не делим на ноль и не показываем вводящий в заблуждение 0%/∞%). */
function formatRatioBadge(planned: number, actual: number): string {
    if (!planned) return '—';
    return `${Math.round((actual / planned) * 100)}%`;
}

/** "+X,X п.п." / "−X,X п.п." — разница в процентных пунктах (факт минус план), для
 * рентабельности: делить процент на процент смысла не несёт, а разница — несёт. */
function formatPercentPointsDiff(planned: number, actual: number): string {
    const diff = Math.round((actual - planned) * 10) / 10;
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    const abs = Math.abs(diff).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${sign}${abs} п.п.`;
}

/**
 * Карточка "план/факт": заголовок + плашка соотношения справа, мелкая серая
 * строка плана, крупная цветная цифра факта. Цвет факта — по категории (расходы/
 * налог красные, прибыль/рентабельность зелёные), но ЛЮБОЕ отрицательное значение
 * факта красится терракотовым вне зависимости от категории — это сильнее сигнализирует
 * "ушли в минус", чем обычный красный для расходов.
 */
function PlanFactCard({
                          label,
                          plannedValue,
                          actualValue,
                          colorCategory,
                          isPercentage = false,
                          badgeMode = 'ratio',
                      }: {
    label: string;
    plannedValue: number;
    actualValue: number;
    colorCategory: 'profit' | 'expense';
    isPercentage?: boolean;
    badgeMode?: 'ratio' | 'diffPP';
}) {
    const formatValue = (v: number) => isPercentage
        ? `${v.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
        : `${formatAmountGrouped(v)} ₽`;

    const factColor = actualValue < 0 ? PLAN_FACT_COLORS.negative : PLAN_FACT_COLORS[colorCategory];
    const badgeText = badgeMode === 'diffPP'
        ? formatPercentPointsDiff(plannedValue, actualValue)
        : formatRatioBadge(plannedValue, actualValue);

    return (
        <div className="flex min-h-[108px] flex-col gap-1.5 rounded-2xl border border-line bg-surface p-[18px_20px] shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
            <div className="flex items-start justify-between gap-2">
                <p className={cn(DASHBOARD_CARD_LABEL, 'text-ink-3')}>{label}</p>
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-surface-2 text-[10.5px] font-semibold text-ink-3 tabular-nums whitespace-nowrap">
                    {badgeText}
                </span>
            </div>
            {/* План — крупно и нейтрально, тот же стиль, что и сумма контракта. */}
            <p className={cn(DASHBOARD_CARD_VALUE, 'text-ink')}>{formatValue(plannedValue)}</p>
            {/* Факт — мелкой цветной строкой под планом, тот же приём, что и для
                "поступило" на карточке суммы контракта. */}
            <p className="text-[13px] font-semibold tabular-nums" style={{ color: factColor }}>
                {formatValue(actualValue)}
            </p>
        </div>
    );
}

function ContractSumInput({
                              value,
                              onChange,
                          }: {
    value: number;
    onChange: (value: number) => void;
}) {
    const [text, setText] = useState(() => formatAmountGrouped(value));

    useEffect(() => {
        setText(formatAmountGrouped(value));
    }, [value]);

    const handleChange = (raw: string) => {
        const parsed = parseGroupedAmount(raw);
        setText(formatAmountGrouped(parsed));
        onChange(parsed);
    };

    return (
        <div className="flex items-baseline gap-1.5 min-w-0">
            <input
                type="text"
                inputMode="numeric"
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                className={cn(
                    DASHBOARD_CARD_VALUE,
                    'w-full min-w-0 border-0 bg-transparent p-0 text-bg outline-none',
                    'placeholder:text-bg/30 [appearance:textfield]',
                    '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
                )}
                placeholder="0"
            />
            <span className={cn(DASHBOARD_CARD_UNIT, 'text-bg shrink-0')}>₽</span>
        </div>
    );
}

// ───────────────────────── модалка добавления/редактирования расхода ─────────────────────────

/**
 * Форма расхода. Раз плановые расходы теперь заводятся ТОЛЬКО автоматически (при
 * сохранении/удалении материала — см. lib/plannedExpenses.ts), у формы нет ни поля,
 * ни переключателя "Тип расхода" — каждый расход, заведённый вручную здесь, это
 * всегда type: "actual".
 *
 * Вид расхода — строго выбор из уже существующего справочника (без возможности
 * создать новое значение прямо тут), чтобы справочник не разрастался мусором —
 * на его значения (конкретно на 5 автоматических категорий) завязана бизнес-логика.
 */
function ExpenseModal({ project, expenses, editingExpense, contractSum, accessToken, onConnectCalendar, onClose, onSave }: {
    project: Project;
    expenses: Expense[];
    editingExpense: Expense | null;
    contractSum: number;
    accessToken?: string | null;
    onConnectCalendar?: () => Promise<boolean>;
    onClose: () => void;
    onSave: (expense: Expense) => void | Promise<void>;
}) {
    const isEditing = !!editingExpense;
    const inputClass = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
    const labelClass = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";
    const selectClass = cn(inputClass, "appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed");

    const [date, setDate] = useState(editingExpense?.date || '');
    const [category, setCategory] = useState(editingExpense?.category || '');
    const [materialId, setMaterialId] = useState(editingExpense?.materialId || '');
    const [plannedExpenseId, setPlannedExpenseId] = useState(editingExpense?.plannedExpenseId || '');
    const [description, setDescription] = useState(editingExpense?.description || '');
    const [amount, setAmount] = useState(editingExpense?.amount || 0);
    const [managerPercent, setManagerPercent] = useState(editingExpense?.managerPercent || 0);
    const [receipts, setReceipts] = useState<ExpenseReceiptFile[]>(editingExpense?.receipts || []);
    const [isUploading, setIsUploading] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'expense_categories'), (snap) => {
            setExpenseCategories(snap.docs.map(d => d.data().name as string).filter(Boolean));
        });
        return () => unsub();
    }, []);

    const plannedOptions = expenses.filter(e => (e.type || 'actual') === 'planned');
    const materials = project.materials || [];

    const isManagerBonus = category.toLowerCase() === 'бонус менеджера';
    // База для бонуса менеджера — контракт минус прочие РАСХОДЫ (поступления сюда
    // попадать не должны — это другая природа операции, не расход), БЕЗ учёта самого
    // редактируемого расхода (иначе при редактировании его прежняя сумма вычлась бы дважды).
    const otherExpensesTotal = expenses
        .filter(e => e.id !== editingExpense?.id && (e.operationType || 'expense') === 'expense')
        .reduce((sum, e) => sum + (e.amount || 0), 0);
    const profitBase = contractSum - otherExpensesTotal;
    const effectiveAmount = amount;

    // ── Связка "% менеджера ↔ сумма" для категории "Бонус менеджера" — тот же
    // принцип, что и "% накрутки ↔ цена продажи" в материалах: локальные текстовые
    // буферы, пересчёт только по потере фокуса/Enter/Tab, без риска зацикливания. ──
    const parseDecimal = (raw: string): number => {
        const cleaned = raw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
        const n = parseFloat(cleaned);
        return isFinite(n) ? n : 0;
    };
    const getPercentFromAmount = (base: number, amt: number): number | null => (base ? (amt * 100) / base : null);
    const getAmountFromPercent = (base: number, pct: number): number => Math.round((base * pct) / 100);

    const [percentText, setPercentText] = useState(managerPercent ? String(managerPercent) : '');
    const [amountText, setAmountText] = useState(amount ? amount.toLocaleString('ru-RU') : '');

    useEffect(() => {
        setPercentText(managerPercent ? String(managerPercent) : '');
        setAmountText(amount ? amount.toLocaleString('ru-RU') : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [category]);

    const commitPercent = () => {
        const pct = parseDecimal(percentText);
        const newAmount = getAmountFromPercent(profitBase, pct);
        setManagerPercent(pct);
        setAmount(newAmount);
        setAmountText(newAmount ? newAmount.toLocaleString('ru-RU') : '');
        setPercentText(pct ? String(pct) : '');
    };

    const commitAmount = () => {
        const amt = Math.round(parseDecimal(amountText));
        setAmount(amt);
        const pct = getPercentFromAmount(profitBase, amt);
        setManagerPercent(pct !== null ? Math.round(pct * 100) / 100 : 0);
        setPercentText(pct !== null ? String(Math.round(pct * 100) / 100) : '');
        setAmountText(amt ? amt.toLocaleString('ru-RU') : '');
    };

    /**
     * При выборе планового расхода подтягиваем из него материал, вид расхода, сумму
     * и комментарий (сумму и комментарий — только как отправную точку, дальше их
     * можно менять; материал и вид расхода блокируются, пока привязка не снята).
     */
    const handleSelectPlanned = (newPlannedId: string) => {
        setPlannedExpenseId(newPlannedId);
        if (!newPlannedId) return;
        const planned = expenses.find(e => e.id === newPlannedId);
        if (!planned) return;
        setCategory(planned.category);
        setMaterialId(planned.materialId || '');
        setAmount(planned.amount);
        setAmountText(planned.amount ? planned.amount.toLocaleString('ru-RU') : '');
        if (planned.description) setDescription(planned.description);
    };

    const handleAttachFiles = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        if (!accessToken) return;
        if (!category) {
            alert('Сначала выберите вид расхода — он используется в имени файла.');
            return;
        }
        setIsUploading(true);
        try {
            const docsFolder = await ensureProjectDocsFolder(project, accessToken);
            // Если папка документов проекта только что создалась — сохраняем ссылку в сам проект,
            // чтобы она сразу появилась и во вкладке «Информация».
            if (docsFolder.id !== project.driveDocsFolderId) {
                await updateDoc(doc(db, 'projects', project.id), {
                    driveDocsFolderId: docsFolder.id,
                    driveDocsFolderLink: docsFolder.link,
                    updatedAt: serverTimestamp(),
                }).catch(console.error);
            }
            const expensesFolder = await findOrCreateSubfolder(docsFolder.id, EXPENSES_SUBFOLDER_NAME, accessToken);

            const dateYMD = formatDateYMD(date);
            const files = Array.from(fileList);
            const newReceipts: ExpenseReceiptFile[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filename = buildReceiptFileName(dateYMD, category, effectiveAmount, file.name, receipts.length + i + 1);
                const uploaded = await uploadFileToDrive(file, filename, expensesFolder.id, accessToken);
                newReceipts.push({ id: crypto.randomUUID(), driveFileId: uploaded.id, driveFileLink: uploaded.link, fileName: filename });
            }
            setReceipts(prev => [...prev, ...newReceipts]);
        } catch (error) {
            console.error('Не удалось прикрепить документ:', error);
            alert('Не удалось загрузить документ на Google Drive. Попробуйте ещё раз.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveReceipt = async (receipt: ExpenseReceiptFile) => {
        if (!window.confirm(`Удалить документ «${receipt.fileName}»? Файл будет удалён и с Google Диска — это действие нельзя отменить.`)) return;
        if (accessToken) {
            try {
                await deleteDriveFile(receipt.driveFileId, accessToken);
            } catch (error) {
                console.error('Не удалось удалить файл на Google Drive:', error);
                alert('Не удалось удалить файл на Google Диске. Попробуйте ещё раз.');
                return;
            }
        }
        setReceipts(prev => prev.filter(r => r.id !== receipt.id));
    };

    const handleConnectGoogle = async () => {
        if (!onConnectCalendar || isConnecting) return;
        setIsConnecting(true);
        try {
            await onConnectCalendar();
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSubmit = async () => {
        if (!category || effectiveAmount <= 0 || !date) return;
        setIsSaving(true);
        try {
            const expenseData: Expense = {
                id: editingExpense?.id || crypto.randomUUID(),
                date,
                category,
                type: 'actual',
                operationType: 'expense',
                materialId: materialId || undefined,
                plannedExpenseId: plannedExpenseId || undefined,
                amount: effectiveAmount,
                description: description || undefined,
                managerPercent: isManagerBonus && managerPercent > 0 ? managerPercent : undefined,
                receipts: receipts.length > 0 ? receipts : undefined,
            };
            await onSave(expenseData);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-2xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                        {isEditing ? 'Редактировать расход' : 'Добавить расход'}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                    {/* Ссылка на плановый расход — определяет, откуда идёт факт */}
                    {plannedOptions.length > 0 && (
                        <div>
                            <label className={labelClass}>Ссылка на плановый расход</label>
                            <select
                                value={plannedExpenseId}
                                onChange={e => handleSelectPlanned(e.target.value)}
                                className={selectClass}
                            >
                                <option value="">— без привязки к плану —</option>
                                {plannedOptions.map(p => {
                                    const mat = findProjectMaterialById(project, p.materialId);
                                    const label = mat ? `${p.category} · ${getMaterialShortLabel(mat)}` : p.category;
                                    return <option key={p.id} value={p.id}>{label} — {formatCurrency(p.amount)}</option>;
                                })}
                            </select>
                        </div>
                    )}

                    {/* Дата / Сумма / % менеджера (последнее — только для категории "Бонус менеджера") */}
                    <div className={cn("grid gap-3", isManagerBonus ? "grid-cols-[130px_1fr_100px]" : "grid-cols-[130px_1fr]")}>
                        <div>
                            <label className={labelClass}>Дата</label>
                            <DatePicker value={date} onChange={setDate} variant="compact" className="[&_input]:h-9" />
                        </div>
                        <div>
                            <label className={labelClass}>Сумма, ₽</label>
                            {isManagerBonus ? (
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={amountText}
                                    onChange={(e) => setAmountText(e.target.value)}
                                    onBlur={commitAmount}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') commitAmount(); }}
                                    placeholder="0"
                                    className={inputClass}
                                />
                            ) : (
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={amount ? amount.toLocaleString('ru-RU') : ''}
                                    onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
                                    placeholder="0"
                                    className={inputClass}
                                />
                            )}
                        </div>
                        {isManagerBonus && (
                            <div>
                                <label className={labelClass}>% менеджера</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={percentText}
                                    onChange={(e) => setPercentText(e.target.value)}
                                    onBlur={commitPercent}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Tab') commitPercent(); }}
                                    placeholder="0"
                                    className={inputClass}
                                />
                            </div>
                        )}
                    </div>

                    {/* Вид расхода — строго из справочника, создать новое значение здесь нельзя */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelClass}>Вид расхода</label>
                            <select
                                value={category}
                                onChange={e => setCategory(e.target.value)}
                                disabled={!!plannedExpenseId}
                                className={selectClass}
                            >
                                <option value="">Выберите вид расхода...</option>
                                {/* Текущее значение всегда есть среди option'ов, даже если его ещё нет в списке
                                    справочника (например, справочник ещё не успел подгрузиться в момент выбора
                                    планового расхода) — иначе select показывал бы пусто вместо реального значения. */}
                                {(category && !expenseCategories.includes(category) ? [category, ...expenseCategories] : expenseCategories).map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                            {plannedExpenseId && (
                                <p className="text-[10.5px] text-ink-4 mt-1">Подставлено из плана — снимите привязку к плану, чтобы изменить</p>
                            )}
                        </div>
                        <div>
                            <label className={labelClass}>Материал</label>
                            <select
                                value={materialId}
                                onChange={e => setMaterialId(e.target.value)}
                                disabled={!!plannedExpenseId}
                                className={selectClass}
                            >
                                <option value="">— не привязан —</option>
                                {materials.map(m => (
                                    <option key={m.id} value={m.id}>{getMaterialShortLabel(m)} — {formatCurrency(m.quantity * m.salePrice)}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Описание */}
                    <div>
                        <label className={labelClass}>Описание</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={2}
                            placeholder="Куда и зачем произведён расход..."
                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 resize-none"
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Документы, подтверждающие расход</label>

                        {!accessToken && onConnectCalendar && (
                            <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                                <p className="text-[12px] text-ink-3 leading-snug">
                                    Чтобы прикреплять документы, подключите Google.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleConnectGoogle}
                                    disabled={isConnecting}
                                    className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    {isConnecting ? 'Подключение…' : 'Подключить Google'}
                                </button>
                            </div>
                        )}

                        {receipts.length > 0 && (
                            <div className="flex flex-col gap-1.5 mb-3">
                                {receipts.map(receipt => (
                                    <div key={receipt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-surface-2 border border-line">
                                        <FileText size={14} className="text-ink-3 shrink-0" />
                                        <span className="flex-1 min-w-0 text-[12.5px] text-ink truncate">{receipt.fileName}</span>
                                        <a
                                            href={receipt.driveFileLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-medium text-ochre hover:underline"
                                        >
                                            <ExternalLink size={11} /> Открыть
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveReceipt(receipt)}
                                            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-terracotta hover:bg-terracotta/5 transition-colors"
                                            title="Удалить документ"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={e => handleAttachFiles(e.target.files)}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!accessToken || isUploading}
                            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-md text-[12.5px] font-semibold border border-line bg-surface hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                            {isUploading ? 'Загружаем…' : 'Добавить документ'}
                        </button>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-2 shrink-0 bg-surface-2/30">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!category || effectiveAmount <= 0 || !date || isSaving}
                        className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSaving ? 'Сохранение…' : (isEditing ? 'Сохранить изменения' : 'Зафиксировать расход')}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

/** Вспомогательная функция вида "id материала проекта → сама позиция сметы". */
function findProjectMaterialById(project: Project, materialId?: string): ProjectMaterial | undefined {
    if (!materialId) return undefined;
    return (project.materials || []).find(m => m.id === materialId);
}

// ───────────────────────── модалка добавления/редактирования поступления ─────────────────────────

/**
 * Поступление денежных средств от заказчика — отдельная, намеренно куда более
 * простая форма, чем у расхода: только дата, сумма, комментарий и документы.
 * Ни вида расхода, ни материала, ни ссылки на план — этих понятий у поступления
 * нет. type/operationType проставляются автоматически в handleSubmit, на самой
 * форме этих полей нет вообще (как и договаривались).
 */
function IncomeModal({ project, editingExpense, accessToken, onConnectCalendar, onClose, onSave }: {
    project: Project;
    editingExpense: Expense | null;
    accessToken?: string | null;
    onConnectCalendar?: () => Promise<boolean>;
    onClose: () => void;
    onSave: (expense: Expense) => void | Promise<void>;
}) {
    const isEditing = !!editingExpense;
    const inputClass = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
    const labelClass = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";

    const [date, setDate] = useState(editingExpense?.date || '');
    const [amount, setAmount] = useState(editingExpense?.amount || 0);
    const [materialId, setMaterialId] = useState(editingExpense?.materialId || '');
    const [description, setDescription] = useState(editingExpense?.description || '');
    const [receipts, setReceipts] = useState<ExpenseReceiptFile[]>(editingExpense?.receipts || []);
    const [isUploading, setIsUploading] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const materials = project.materials || [];

    const handleAttachFiles = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        if (!accessToken) return;
        setIsUploading(true);
        try {
            const docsFolder = await ensureProjectDocsFolder(project, accessToken);
            if (docsFolder.id !== project.driveDocsFolderId) {
                await updateDoc(doc(db, 'projects', project.id), {
                    driveDocsFolderId: docsFolder.id,
                    driveDocsFolderLink: docsFolder.link,
                    updatedAt: serverTimestamp(),
                }).catch(console.error);
            }
            const expensesFolder = await findOrCreateSubfolder(docsFolder.id, EXPENSES_SUBFOLDER_NAME, accessToken);

            const dateYMD = formatDateYMD(date);
            const files = Array.from(fileList);
            const newReceipts: ExpenseReceiptFile[] = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // "Поступление" вместо вида расхода — своего справочника у поступлений нет.
                const filename = buildReceiptFileName(dateYMD, 'Поступление', amount, file.name, receipts.length + i + 1);
                const uploaded = await uploadFileToDrive(file, filename, expensesFolder.id, accessToken);
                newReceipts.push({ id: crypto.randomUUID(), driveFileId: uploaded.id, driveFileLink: uploaded.link, fileName: filename });
            }
            setReceipts(prev => [...prev, ...newReceipts]);
        } catch (error) {
            console.error('Не удалось прикрепить документ:', error);
            alert('Не удалось загрузить документ на Google Drive. Попробуйте ещё раз.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveReceipt = async (receipt: ExpenseReceiptFile) => {
        if (!window.confirm(`Удалить документ «${receipt.fileName}»? Файл будет удалён и с Google Диска — это действие нельзя отменить.`)) return;
        if (accessToken) {
            try {
                await deleteDriveFile(receipt.driveFileId, accessToken);
            } catch (error) {
                console.error('Не удалось удалить файл на Google Drive:', error);
                alert('Не удалось удалить файл на Google Диске. Попробуйте ещё раз.');
                return;
            }
        }
        setReceipts(prev => prev.filter(r => r.id !== receipt.id));
    };

    const handleConnectGoogle = async () => {
        if (!onConnectCalendar || isConnecting) return;
        setIsConnecting(true);
        try {
            await onConnectCalendar();
        } finally {
            setIsConnecting(false);
        }
    };

    const handleSubmit = async () => {
        if (amount <= 0 || !date) return;
        setIsSaving(true);
        try {
            const expenseData: Expense = {
                id: editingExpense?.id || crypto.randomUUID(),
                date,
                category: '',
                type: 'actual',
                operationType: 'income',
                materialId: materialId || undefined,
                amount,
                description: description || undefined,
                receipts: receipts.length > 0 ? receipts : undefined,
            };
            await onSave(expenseData);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-lg bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                        {isEditing ? 'Редактировать поступление' : 'Добавить поступление'}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                    <div className="grid grid-cols-[130px_1fr] gap-3">
                        <div>
                            <label className={labelClass}>Дата</label>
                            <DatePicker value={date} onChange={setDate} variant="compact" className="[&_input]:h-9" />
                        </div>
                        <div>
                            <label className={labelClass}>Сумма, ₽</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={amount ? amount.toLocaleString('ru-RU') : ''}
                                onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
                                placeholder="0"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {materials.length > 0 && (
                        <div>
                            <label className={labelClass}>Материал</label>
                            <select
                                value={materialId}
                                onChange={e => setMaterialId(e.target.value)}
                                className="w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors appearance-none cursor-pointer"
                            >
                                <option value="">— не привязан —</option>
                                {materials.map(m => (
                                    <option key={m.id} value={m.id}>{getMaterialShortLabel(m)}</option>
                                ))}
                            </select>
                            <p className="text-[10.5px] text-ink-4 mt-1">За какой материал заказчик сделал перечисление — необязательно</p>
                        </div>
                    )}

                    <div>
                        <label className={labelClass}>Комментарий</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={2}
                            placeholder="От кого и за что поступление..."
                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 resize-none"
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Документы, подтверждающие поступление</label>

                        {!accessToken && onConnectCalendar && (
                            <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                                <p className="text-[12px] text-ink-3 leading-snug">
                                    Чтобы прикреплять документы, подключите Google.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleConnectGoogle}
                                    disabled={isConnecting}
                                    className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    {isConnecting ? 'Подключение…' : 'Подключить Google'}
                                </button>
                            </div>
                        )}

                        {receipts.length > 0 && (
                            <div className="flex flex-col gap-1.5 mb-3">
                                {receipts.map(receipt => (
                                    <div key={receipt.id} className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-surface-2 border border-line">
                                        <FileText size={14} className="text-ink-3 shrink-0" />
                                        <span className="flex-1 min-w-0 text-[12.5px] text-ink truncate">{receipt.fileName}</span>
                                        <a
                                            href={receipt.driveFileLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="shrink-0 inline-flex items-center gap-1 text-[11.5px] font-medium text-ochre hover:underline"
                                        >
                                            <ExternalLink size={11} /> Открыть
                                        </a>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveReceipt(receipt)}
                                            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-ink-3 hover:text-terracotta hover:bg-terracotta/5 transition-colors"
                                            title="Удалить документ"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            onChange={e => handleAttachFiles(e.target.files)}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!accessToken || isUploading}
                            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-md text-[12.5px] font-semibold border border-line bg-surface hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                            {isUploading ? 'Загружаем…' : 'Добавить документ'}
                        </button>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-2 shrink-0 bg-surface-2/30">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={amount <= 0 || !date || isSaving}
                        className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSaving ? 'Сохранение…' : (isEditing ? 'Сохранить изменения' : 'Зафиксировать поступление')}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

export default FinanceTab;