import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Plus, X, Trash2, PieChart as PieChartIcon } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { cn, formatCurrency, formatAmountGrouped, parseGroupedAmount } from '../../lib/utils';
import { getTotalExpenses, getMarginPercent } from '../../lib/financeCalculations';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { Project, AppUser } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import CodeProtection from '../CodeProtection';

function FinanceTab({
                        project,
                        canEdit,
                        users,
                        appUser,
                        needsCodeGate,
                        onUnlock,
                    }: {
    project: Project;
    canEdit: boolean;
    users: AppUser[];
    appUser: AppUser | null;
    needsCodeGate: boolean;
    onUnlock: () => void;
}) {
    const [isAdding, setIsAdding] = useState(false);
    const [newExpenseForm, setNewExpenseForm] = useState({
        date: '',
        category: '',
        amount: 0,
        managerPercent: 0,
    });

    // Портал-дропдаун категорий
    const categoryInputRef = React.useRef<HTMLInputElement>(null);
    const categoryWrapperRef = React.useRef<HTMLDivElement>(null);
    const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
    const [categorySearch, setCategorySearch] = useState('');
    const [expenseCategories, setExpenseCategories] = useState<string[]>([]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'expense_categories'), (snap) => {
            setExpenseCategories(snap.docs.map(d => d.data().name as string).filter(Boolean));
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        if (!categoryDropdownOpen) return;
        const handleClick = (e: MouseEvent) => {
            const t = e.target as Node;
            if (!categoryWrapperRef.current?.contains(t) && !document.getElementById('expense-cat-portal')?.contains(t)) {
                setCategoryDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [categoryDropdownOpen]);

    // Позиция портала категорий
    const [portalPos, setPortalPos] = useState<{top:number;left:number;width:number}>({top:0,left:0,width:0});
    useEffect(() => {
        if (!categoryDropdownOpen || !categoryWrapperRef.current) return;
        const rect = categoryWrapperRef.current.getBoundingClientRect();
        setPortalPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX, width: rect.width });
    }, [categoryDropdownOpen]);

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
    const totalExpenses = getTotalExpenses(f);
    const profitability = getMarginPercent(f);

    // Расходы без бонуса менеджера
    const expensesWithoutBonus = expenses.filter(
        (e: any) => e.category?.toLowerCase() !== 'бонус менеджера'
    );
    const totalExpensesWithoutBonus = expensesWithoutBonus.reduce((s: number, e: any) => s + (e.amount || 0), 0);
    const profitAfterExpenses = (f.contractSum || 0) - totalExpensesWithoutBonus;
    const netProfit = (f.contractSum || 0) - totalExpenses;
    const marginPercent = f.contractSum ? Math.round(netProfit / f.contractSum * 100) : 0;

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

    const handleAddExpense = async () => {
        if (!newExpenseForm.category || newExpenseForm.amount <= 0) return;

        try {
            const q = query(collection(db, 'expense_categories'), where('name', '==', newExpenseForm.category));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                await addDoc(collection(db, 'expense_categories'), {
                    name: newExpenseForm.category,
                    createdAt: serverTimestamp()
                });
            }

            const newExpense = {
                id: crypto.randomUUID(),
                date: newExpenseForm.date,
                category: newExpenseForm.category,
                amount: newExpenseForm.amount
            };

            const updatedExpenses = [...expenses, newExpense];
            await updateFinance({ expenses: updatedExpenses });

            setNewExpenseForm({ date: '', category: '', amount: 0, managerPercent: 0 });
            setIsAdding(false);
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

    const sortedExpenses = [...expenses].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
        >
            {/* Сводные карточки */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                <FinanceCard
                    label="СУММА КОНТРАКТА"
                    subtext="основа расчёта"
                    value={f.contractSum}
                    variant="contract"
                    canEdit={canEdit}
                    onValueChange={(v) => updateFinance({ contractSum: v })}
                />
                <FinanceCard
                    label="ПРИБЫЛЬ"
                    subtext="после всех расходов"
                    value={profitAfterExpenses}
                    variant="profit"
                />
                <FinanceCard
                    label="ЧИСТАЯ ПРИБЫЛЬ"
                    subtext="после бонуса менеджера"
                    value={netProfit}
                    variant="profit"
                />
                <FinanceCard
                    label="РАСХОДЫ"
                    subtext={`${expenses.length} операций`}
                    value={totalExpenses}
                    variant="expense"
                />
                <FinanceCard
                    label="МАРЖА"
                    subtext="от контракта"
                    value={marginPercent}
                    isPercentage
                    variant="margin"
                />
            </div>

            {/* Расходы + диаграмма */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 items-start">
                <div className="xl:col-span-3 overflow-hidden rounded-[18px] border border-[#DED8CC] bg-[#F8F3E9] shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_3px_rgba(48,42,28,0.08)]">
                    <div className="flex items-center justify-between gap-4 border-b border-[#DED8CC] px-4 py-3">
                        <h3 className="font-display text-[15px] font-medium leading-tight text-[#302A1C]">
                            Расходы по проекту
                        </h3>

                        {canEdit && (
                            <button
                                type="button"
                                onClick={() => setIsAdding(!isAdding)}
                                className={cn(
                                    "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors",
                                    isAdding
                                        ? "border-[#C9B99B] bg-white/70 text-[#7C5A25] hover:bg-white"
                                        : "border-[#D8B978] bg-[#B48444] text-white shadow-[0_1px_2px_rgba(132,91,37,0.18)] hover:bg-[#A6783D]"
                                )}
                            >
                                {isAdding ? (
                                    <X size={12} strokeWidth={2.25} />
                                ) : (
                                    <Plus size={12} strokeWidth={2.5} />
                                )}
                                {isAdding ? 'Отмена' : 'Добавить расход'}
                            </button>
                        )}
                    </div>

                    <AnimatePresence>
                        {isAdding && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="overflow-hidden border-b border-[#DED8CC]"
                            >
                                {(() => {
                                    const isManagerBonus = newExpenseForm.category.toLowerCase() === 'бонус менеджера';
                                    const otherExpensesTotal = expenses.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
                                    const profitBase = (f.contractSum || 0) - otherExpensesTotal;
                                    const bonusAmount = isManagerBonus && newExpenseForm.managerPercent > 0
                                        ? Math.round(profitBase * newExpenseForm.managerPercent / 100)
                                        : 0;
                                    const effectiveAmount = isManagerBonus ? bonusAmount : newExpenseForm.amount;
                                    const filteredCats = expenseCategories.filter(c => c.toLowerCase().includes(categorySearch.toLowerCase()));

                                    return (
                                        <div className="bg-[#F0E8D8] px-4 py-4">
                                            <div className={cn(
                                                "grid grid-cols-1 gap-3 md:items-end",
                                                isManagerBonus
                                                    ? "md:grid-cols-[180px_1fr_100px_140px_auto]"
                                                    : "md:grid-cols-[180px_1fr_120px_auto]"
                                            )}>
                                                <div>
                                                    <label className="mb-1.5 block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                                        Дата
                                                    </label>
                                                    <DatePicker
                                                        value={newExpenseForm.date || ''}
                                                        onChange={(v) => setNewExpenseForm({ ...newExpenseForm, date: v })}
                                                        variant="compact"
                                                    />
                                                </div>

                                                <div className="relative" ref={categoryWrapperRef}>
                                                    <label className="mb-1.5 block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                                        Вид расхода
                                                    </label>
                                                    <div className="relative">
                                                        <input
                                                            ref={categoryInputRef}
                                                            type="text"
                                                            value={categoryDropdownOpen ? categorySearch : newExpenseForm.category}
                                                            onChange={(e) => {
                                                                setCategorySearch(e.target.value);
                                                                if (!categoryDropdownOpen) setCategoryDropdownOpen(true);
                                                            }}
                                                            onFocus={() => {
                                                                setCategorySearch('');
                                                                setCategoryDropdownOpen(true);
                                                            }}
                                                            placeholder="Выберите категорию..."
                                                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[14px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 font-normal"
                                                        />
                                                        <ChevronDown size={13} className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none transition-transform", categoryDropdownOpen && "rotate-180")} />
                                                    </div>
                                                    {categoryDropdownOpen && createPortal(
                                                        <div id="expense-cat-portal" style={{ position:'absolute', top: portalPos.top, left: portalPos.left, width: portalPos.width, zIndex: 999999 }}>
                                                            <div className="rounded-md bg-surface border border-line shadow-[0_8px_24px_rgba(48,42,28,0.14)] overflow-hidden">
                                                                <div className="max-h-[200px] overflow-y-auto">
                                                                    {filteredCats.length > 0 ? filteredCats.map(cat => (
                                                                        <button key={cat} type="button"
                                                                                onMouseDown={(e) => { e.preventDefault(); setNewExpenseForm({...newExpenseForm, category: cat}); setCategoryDropdownOpen(false); setCategorySearch(''); }}
                                                                                className={cn("w-full text-left px-3 py-2 text-[13px] transition-colors hover:bg-surface-2", newExpenseForm.category === cat ? "bg-ochre-bg text-ochre font-semibold" : "text-ink")}
                                                                        >{cat}</button>
                                                                    )) : (
                                                                        <p className="px-3 py-2 text-[12px] italic text-ink-4">Ничего не найдено</p>
                                                                    )}
                                                                    {categorySearch.trim() && !expenseCategories.some(c => c.toLowerCase() === categorySearch.toLowerCase().trim()) && (
                                                                        <button type="button"
                                                                                onMouseDown={(e) => { e.preventDefault(); setNewExpenseForm({...newExpenseForm, category: categorySearch.trim()}); setCategoryDropdownOpen(false); setCategorySearch(''); }}
                                                                                className="w-full text-left px-3 py-2 text-[12.5px] font-semibold text-ochre border-t border-line bg-surface hover:bg-surface-2 transition-colors flex items-center gap-2"
                                                                        ><Plus size={12} /> Создать «{categorySearch.trim()}»</button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>,
                                                        document.body
                                                    )}
                                                </div>

                                                <div>
                                                    <label className="mb-1.5 block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                                        Сумма, ₽
                                                    </label>
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={isManagerBonus ? (bonusAmount > 0 ? bonusAmount.toLocaleString('ru-RU') : '') : (newExpenseForm.amount ? newExpenseForm.amount.toLocaleString('ru-RU') : '')}
                                                        onChange={(e) => !isManagerBonus && setNewExpenseForm({
                                                            ...newExpenseForm,
                                                            amount: Number(e.target.value.replace(/\D/g, '')) || 0,
                                                        })}
                                                        readOnly={isManagerBonus}
                                                        placeholder={isManagerBonus ? 'авто' : '0'}
                                                        className={cn(
                                                            "w-full bg-surface border border-line rounded-md px-3 py-2 text-[14px] text-ink focus:border-ochre focus:outline-none focus:ring-0 transition-colors placeholder:text-ink-4 font-normal",
                                                            isManagerBonus && "cursor-default bg-surface-2 text-ink-3"
                                                        )}
                                                    />
                                                </div>

                                                {isManagerBonus && (
                                                    <div>
                                                        <label className="mb-1.5 block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                                            % менеджера
                                                        </label>
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            maxLength={3}
                                                            value={newExpenseForm.managerPercent || ''}
                                                            onChange={(e) => {
                                                                const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
                                                                setNewExpenseForm({ ...newExpenseForm, managerPercent: digits ? Number(digits) : 0 });
                                                            }}
                                                            placeholder="0"
                                                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[14px] text-ink focus:border-ochre focus:outline-none focus:ring-0 transition-colors placeholder:text-ink-4 font-normal"
                                                        />
                                                    </div>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        if (!newExpenseForm.category || effectiveAmount <= 0) return;
                                                        try {
                                                            const q = query(collection(db, 'expense_categories'), where('name', '==', newExpenseForm.category));
                                                            const snapshot = await getDocs(q);
                                                            if (snapshot.empty) {
                                                                await addDoc(collection(db, 'expense_categories'), { name: newExpenseForm.category, createdAt: serverTimestamp() });
                                                            }
                                                            const newExpense: any = {
                                                                id: crypto.randomUUID(),
                                                                date: newExpenseForm.date,
                                                                category: newExpenseForm.category,
                                                                amount: effectiveAmount,
                                                            };
                                                            if (isManagerBonus && newExpenseForm.managerPercent > 0) {
                                                                newExpense.managerPercent = newExpenseForm.managerPercent;
                                                            }
                                                            await updateFinance({ expenses: [...expenses, newExpense] });
                                                            setNewExpenseForm({ date: '', category: '', amount: 0, managerPercent: 0 });
                                                            setIsAdding(false);
                                                        } catch (e) { console.error(e); }
                                                    }}
                                                    disabled={!newExpenseForm.category || effectiveAmount <= 0}
                                                    className="rounded-md bg-[#B48444] px-4 py-2 text-[14px] font-semibold text-white shadow-[0_1px_2px_rgba(132,91,37,0.2)] transition-colors hover:bg-[#A6783D] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                                                >
                                                    Зафиксировать
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] border-collapse text-left">
                            <thead>
                            <tr className="border-b border-[#DED8CC] bg-[#F8F3E9]">
                                <th className="px-4 py-2.5 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                    Дата
                                </th>
                                <th className="px-4 py-2.5 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                    Вид расхода
                                </th>
                                <th className="px-4 py-2.5 text-right text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                    Сумма
                                </th>
                                {canEdit && <th className="w-10 px-2 py-2.5" />}
                            </tr>
                            </thead>

                            <tbody className="divide-y divide-[#DED8CC] bg-[#FBF8F2]/50">
                            {sortedExpenses.map((expense, index) => (
                                <tr
                                    key={expense.id}
                                    className="group transition-colors hover:bg-white/60"
                                >
                                    <td className="px-4 py-3 text-[11.5px] font-medium tabular-nums text-[#8A8574]">
                                        {new Date(expense.date).toLocaleDateString('ru-RU', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            year: 'numeric',
                                        })}
                                    </td>

                                    <td className="px-4 py-3">
                                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="truncate text-[12.5px] font-medium text-[#302A1C]">
                            {expense.category || 'Без категории'}
                          </span>
                                            {(expense as any).managerPercent > 0 && (
                                                <span className="text-[10px] text-[#B48444] font-semibold shrink-0">{(expense as any).managerPercent}%</span>
                                            )}
                                        </div>
                                    </td>

                                    <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[12.5px] font-bold tabular-nums text-[#9B3F54]">
                          {formatCurrency(expense.amount)}
                        </span>
                                    </td>

                                    {canEdit && (
                                        <td className="px-2 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={() => removeExpense(expense.id)}
                                                className="rounded-md p-1 text-[#8A8574]/50 opacity-0 transition-all hover:bg-[#9B3F54]/8 hover:text-[#9B3F54] group-hover:opacity-100"
                                                aria-label="Удалить расход"
                                            >
                                                <Trash2 size={12} strokeWidth={1.9} />
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}

                            {expenses.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={canEdit ? 4 : 3}
                                        className="px-4 py-10 text-center"
                                    >
                                        <p className="text-[12px] font-medium text-[#8A8574]">
                                            Расходы пока не добавлены
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

                    {expenses.length > 0 ? (
                        <div className="h-[260px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={expenses.reduce((acc: any[], exp) => {
                                            const existing = acc.find(item => item.name === exp.category);
                                            if (existing) {
                                                existing.value += exp.amount;
                                            } else {
                                                acc.push({ name: exp.category, value: exp.amount });
                                            }
                                            return acc;
                                        }, [])}
                                        dataKey="value"
                                        nameKey="name"
                                        innerRadius={58}
                                        outerRadius={88}
                                        paddingAngle={2}
                                        stroke="none"
                                    >
                                        {expenses.map((entry: any, index: number) => (
                                            <Cell
                                                key={`expense-cell-${entry.category}-${index}`}
                                                fill={getExpenseCategoryColor(entry.category, index)}
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
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="flex h-[260px] flex-col items-center justify-center text-center">
                            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#EFE7D7] text-[#B8AE9A]">
                                <PieChartIcon size={22} strokeWidth={1.8} />
                            </div>
                            <p className="text-[12px] font-medium text-[#8A8574]">
                                Статей расходов пока нет
                            </p>
                        </div>
                    )}
                </div>
            </div>
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

/** Стили карточек как SummaryCard на дашборде */
export const DASHBOARD_CARD_LABEL = 'text-[10.5px] font-semibold uppercase tracking-[0.14em]';
export const DASHBOARD_CARD_VALUE = 'font-display text-[34px] leading-[1.05] tabular-nums';
export const DASHBOARD_CARD_UNIT = 'font-display text-[14px] opacity-70';
export const DASHBOARD_CARD_SUB = 'text-[11.5px] text-ink-3 mt-0.5';

const FINANCE_VALUE_COLORS = {
    profit: '#2f5e3f',
    expense: '#8a3f47',
    margin: '#1f1c14',
    bonus: '#b07a2c',
} as const;

function FinanceCard({
                         label,
                         subtext,
                         value,
                         variant = 'profit',
                         isPercentage = false,
                         canEdit,
                         onValueChange,
                     }: {
    label: string;
    subtext?: string;
    value: number;
    variant?: 'contract' | 'profit' | 'expense' | 'margin';
    isPercentage?: boolean;
    canEdit?: boolean;
    onValueChange?: (value: number) => void;
}) {
    const isEditableContract = variant === 'contract' && canEdit && onValueChange;
    const valueColor =
        variant === 'contract'
            ? 'var(--bg)'
            : variant === 'profit'
                ? FINANCE_VALUE_COLORS.profit
                : variant === 'expense'
                    ? FINANCE_VALUE_COLORS.expense
                    : FINANCE_VALUE_COLORS.margin;

    const num = isPercentage ? `${Math.round(value)}` : formatAmountGrouped(value);
    const unit = isPercentage ? '%' : '₽';

    if (variant === 'contract') {
        return (
            <div
                className="flex min-h-[108px] flex-col gap-2.5 rounded-2xl p-[18px_20px] relative overflow-hidden"
                style={{
                    background: 'linear-gradient(135deg, var(--ink) 0%, #2a2618 100%)',
                    border: '1px solid #2a2618',
                }}
            >
                <p className={DASHBOARD_CARD_LABEL} style={{ color: 'rgba(245,233,204,0.6)' }}>
                    {label}
                </p>
                {isEditableContract ? (
                    <ContractSumInput value={value} onChange={onValueChange} />
                ) : (
                    <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className={cn(DASHBOARD_CARD_VALUE, 'text-bg')}>{num}</span>
                        {!isPercentage && (
                            <span className={cn(DASHBOARD_CARD_UNIT, 'text-bg shrink-0')}>{unit}</span>
                        )}
                    </div>
                )}
                {subtext && (
                    <p className="text-[11.5px] mt-auto" style={{ color: 'rgba(245,233,204,0.45)' }}>
                        {subtext}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="flex min-h-[108px] flex-col gap-2.5 rounded-2xl border border-line bg-surface p-[18px_20px] shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
            <p className={cn(DASHBOARD_CARD_LABEL, 'text-ink-3')}>{label}</p>
            <div className="flex items-baseline gap-1.5 min-w-0">
        <span className={DASHBOARD_CARD_VALUE} style={{ color: valueColor }}>
          {num}
        </span>
                <span className={DASHBOARD_CARD_UNIT} style={{ color: valueColor }}>
          {unit}
        </span>
            </div>
            {subtext && <p className={DASHBOARD_CARD_SUB}>{subtext}</p>}
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


export default FinanceTab;