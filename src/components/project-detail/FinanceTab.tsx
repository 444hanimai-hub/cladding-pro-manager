import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Plus, X, Trash2, Pencil, Paperclip, ExternalLink, Loader2, FileText, PieChart as PieChartIcon } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { cn, formatCurrency, formatAmountGrouped, parseGroupedAmount } from '../../lib/utils';
import { getTotalExpenses } from '../../lib/financeCalculations';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { Project, AppUser, Expense, ExpenseReceiptFile } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import CodeProtection from '../CodeProtection';
import { ensureProjectDocsFolder, findOrCreateSubfolder, formatDateYMD } from '../../lib/googleDriveFolders';
import { uploadFileToDrive, deleteDriveFile, buildReceiptFileName } from '../../lib/googleDriveFiles';

const EXPENSES_SUBFOLDER_NAME = 'Расходы';

function FinanceTab({
                        project,
                        canEdit,
                        users,
                        appUser,
                        needsCodeGate,
                        onUnlock,
                        accessToken,
                        onConnectCalendar,
                    }: {
    project: Project;
    canEdit: boolean;
    users: AppUser[];
    appUser: AppUser | null;
    needsCodeGate: boolean;
    onUnlock: () => void;
    accessToken?: string | null;
    onConnectCalendar?: () => Promise<boolean>;
}) {
    const [isModalOpen, setIsModalOpen] = useState(false);
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
    const totalExpenses = getTotalExpenses(f);

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

    const handleOpenAdd = () => {
        setEditingExpenseId(null);
        setIsModalOpen(true);
    };

    const handleOpenEdit = (expenseId: string) => {
        setEditingExpenseId(expenseId);
        setIsModalOpen(true);
    };

    const handleSaveExpense = async (expenseData: Expense) => {
        try {
            // Категория — сохраняем в справочник, если такой ещё нет (как и раньше).
            const q = query(collection(db, 'expense_categories'), where('name', '==', expenseData.category));
            const snapshot = await getDocs(q);
            if (snapshot.empty) {
                await addDoc(collection(db, 'expense_categories'), { name: expenseData.category, createdAt: serverTimestamp() });
            }

            let updatedExpenses;
            if (editingExpenseId) {
                updatedExpenses = expenses.map(e => e.id === editingExpenseId ? expenseData : e);
            } else {
                updatedExpenses = [...expenses, expenseData];
            }
            await updateFinance({ expenses: updatedExpenses });
            setIsModalOpen(false);
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

    const sortedExpenses = [...expenses].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const editingExpense = editingExpenseId ? expenses.find(e => e.id === editingExpenseId) || null : null;

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
                                onClick={handleOpenAdd}
                                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors border-[#D8B978] bg-[#B48444] text-white shadow-[0_1px_2px_rgba(132,91,37,0.18)] hover:bg-[#A6783D]"
                            >
                                <Plus size={12} strokeWidth={2.5} />
                                Добавить расход
                            </button>
                        )}
                    </div>

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
                                <th className="px-4 py-2.5 text-center text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                    Документы
                                </th>
                                <th className="px-4 py-2.5 text-right text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574]">
                                    Сумма
                                </th>
                                {canEdit && <th className="w-10 px-2 py-2.5" />}
                            </tr>
                            </thead>

                            <tbody className="divide-y divide-[#DED8CC] bg-[#FBF8F2]/50">
                            {sortedExpenses.map((expense) => (
                                <tr
                                    key={expense.id}
                                    onClick={() => canEdit && handleOpenEdit(expense.id)}
                                    className={cn("group transition-colors hover:bg-white/60", canEdit && "cursor-pointer")}
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
                        <span className="font-mono text-[12.5px] font-bold tabular-nums text-[#9B3F54]">
                          {formatCurrency(expense.amount)}
                        </span>
                                    </td>

                                    {canEdit && (
                                        <td className="px-2 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); removeExpense(expense.id); }}
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
                                        colSpan={canEdit ? 5 : 4}
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

            <AnimatePresence>
                {isModalOpen && (
                    <ExpenseModal
                        project={project}
                        expenses={expenses}
                        editingExpense={editingExpense}
                        contractSum={f.contractSum || 0}
                        accessToken={accessToken}
                        onConnectCalendar={onConnectCalendar}
                        onClose={() => { setIsModalOpen(false); setEditingExpenseId(null); }}
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

// ───────────────────────── модалка добавления/редактирования расхода ─────────────────────────

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

    const [date, setDate] = useState(editingExpense?.date || '');
    const [category, setCategory] = useState(editingExpense?.category || '');
    const [description, setDescription] = useState(editingExpense?.description || '');
    const [amount, setAmount] = useState(editingExpense?.amount || 0);
    const [managerPercent, setManagerPercent] = useState(editingExpense?.managerPercent || 0);
    const [receipts, setReceipts] = useState<ExpenseReceiptFile[]>(editingExpense?.receipts || []);
    const [isUploading, setIsUploading] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Портал-дропдаун категорий (как было)
    const categoryInputRef = React.useRef<HTMLInputElement>(null);
    const categoryWrapperRef = React.useRef<HTMLDivElement>(null);
    const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
    const [categorySearch, setCategorySearch] = useState('');
    const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
    const [portalPos, setPortalPos] = useState<{top:number;left:number;width:number}>({top:0,left:0,width:0});

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

    useEffect(() => {
        if (!categoryDropdownOpen || !categoryWrapperRef.current) return;
        const rect = categoryWrapperRef.current.getBoundingClientRect();
        setPortalPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX, width: rect.width });
    }, [categoryDropdownOpen]);

    const isManagerBonus = category.toLowerCase() === 'бонус менеджера';
    // База для бонуса менеджера — контракт минус прочие расходы, БЕЗ учёта самого
    // редактируемого расхода (иначе при редактировании его прежняя сумма вычлась бы дважды).
    const otherExpensesTotal = expenses
        .filter(e => e.id !== editingExpense?.id)
        .reduce((sum, e) => sum + (e.amount || 0), 0);
    const profitBase = contractSum - otherExpensesTotal;
    const effectiveAmount = amount;

    const filteredCats = expenseCategories.filter(c => c.toLowerCase().includes(categorySearch.toLowerCase()));

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

                    {/* Вид расхода — во всю ширину */}
                    <div className="relative" ref={categoryWrapperRef}>
                        <label className={labelClass}>Вид расхода</label>
                        <div className="relative">
                            <input
                                ref={categoryInputRef}
                                type="text"
                                value={categoryDropdownOpen ? categorySearch : category}
                                onChange={(e) => {
                                    setCategorySearch(e.target.value);
                                    if (!categoryDropdownOpen) setCategoryDropdownOpen(true);
                                }}
                                onFocus={() => { setCategorySearch(''); setCategoryDropdownOpen(true); }}
                                placeholder="Выберите категорию..."
                                className={inputClass}
                            />
                            <ChevronDown size={13} className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none transition-transform", categoryDropdownOpen && "rotate-180")} />
                        </div>
                        {categoryDropdownOpen && createPortal(
                            <div id="expense-cat-portal" style={{ position:'absolute', top: portalPos.top, left: portalPos.left, width: portalPos.width, zIndex: 999999 }}>
                                <div className="rounded-md bg-surface border border-line shadow-[0_8px_24px_rgba(48,42,28,0.14)] overflow-hidden">
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {filteredCats.length > 0 ? filteredCats.map(cat => (
                                            <button key={cat} type="button"
                                                    onMouseDown={(e) => { e.preventDefault(); setCategory(cat); setCategoryDropdownOpen(false); setCategorySearch(''); }}
                                                    className={cn("w-full text-left px-3 py-2 text-[13px] transition-colors hover:bg-surface-2", category === cat ? "bg-ochre-bg text-ochre font-semibold" : "text-ink")}
                                            >{cat}</button>
                                        )) : (
                                            <p className="px-3 py-2 text-[12px] italic text-ink-4">Ничего не найдено</p>
                                        )}
                                        {categorySearch.trim() && !expenseCategories.some(c => c.toLowerCase() === categorySearch.toLowerCase().trim()) && (
                                            <button type="button"
                                                    onMouseDown={(e) => { e.preventDefault(); setCategory(categorySearch.trim()); setCategoryDropdownOpen(false); setCategorySearch(''); }}
                                                    className="w-full text-left px-3 py-2 text-[12.5px] font-semibold text-ochre border-t border-line bg-surface hover:bg-surface-2 transition-colors flex items-center gap-2"
                                            ><Plus size={12} /> Создать «{categorySearch.trim()}»</button>
                                        )}
                                    </div>
                                </div>
                            </div>,
                            document.body
                        )}
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

export default FinanceTab;