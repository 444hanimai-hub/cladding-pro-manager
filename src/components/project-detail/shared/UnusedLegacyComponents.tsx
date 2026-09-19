/**
 * UnusedLegacyComponents.tsx
 *
 * Эти компоненты присутствовали в исходном ProjectDetail.tsx, но нигде не
 * рендерились (мёртвый код, видимо, остался от более ранних версий экрана).
 * При разбиении файла на модули они не привязаны ни к одной конкретной
 * вкладке, поэтому вынесены сюда отдельно — чтобы ничего не потерять и не
 * гадать, к какой вкладке их отнести. Если они точно не нужны — можно
 * спокойно удалить этот файл целиком.
 */
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Download, Trash2, FileText } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { cn, formatCurrency } from '../../../lib/utils';
import {
    getManagerBonus,
    getMarginPercent,
    getNetProfitAfterAll,
    getProfitBeforeBonus,
    getTotalExpenses,
} from '../../../lib/financeCalculations';
import { Project } from '../../../types';
import { DASHBOARD_CARD_LABEL } from '../FinanceTab';

function FinancialSummary({ project }: { project: Project }) {
    const [isOpen, setIsOpen] = useState(false);
    const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
    const totalExpenses = getTotalExpenses(f);
    const profitBeforeBonus = getProfitBeforeBonus(f);
    const managerBonus = getManagerBonus(f);
    const netProfitAfterAll = getNetProfitAfterAll(f);
    const profitability = getMarginPercent(f);

    return (
        <div className={cn(
            "p-6 rounded-2xl border shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] relative overflow-hidden transition-all duration-500 ease-in-out",
            "bg-surface border-line text-ink"
        )}>
            <div className={cn("absolute top-0 right-0 w-48 h-48 rounded-full -mr-24 -mt-24 blur-3xl", "bg-[#5A5A40]/5")} />

            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full flex items-center justify-between group"
                >
                    <div className="text-left">
                        <p className={cn("text-[10px] font-bold uppercase tracking-widest mb-2 transition-colors", "text-[#141414]/40")}>Общая сумма контракта</p>
                        <h3 className={cn("text-4xl font-serif font-bold tracking-tighter transition-colors", "group-hover:text-[#141414]/80")}>
                            {formatCurrency(f.contractSum)}
                        </h3>
                    </div>
                    <div className={cn("p-4 rounded-2xl transition-all", "bg-[#F5F5F0]", isOpen ? "rotate-180" : "")}>
                        <ChevronDown size={24} className={"text-[#141414]/40"} />
                    </div>
                </button>

                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            <div className={cn("space-y-4 pt-10 border-t mt-10 transition-colors", "border-[#141414]/10")}>
                                <div className="flex justify-between items-center">
                                    <span className={"text-[#141414]/60 text-sm"}>Расходы</span>
                                    <span className="font-mono font-bold text-rose-400">-{formatCurrency(totalExpenses)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={"text-[#141414]/60 text-sm"}>Прибыль до бонуса</span>
                                    <span className={cn("font-mono font-bold", "text-[#4fb47c]")}>{formatCurrency(profitBeforeBonus)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={"text-[#141414]/60 text-sm"}>Бонус менеджера ({f.managerPercentage || 0}%)</span>
                                    <span className={cn("font-mono font-bold", "text-[#5A5A40]")}>{formatCurrency(managerBonus)}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className={"text-[#141414]/60 text-sm"}>Чистая прибыль</span>
                                    <span className={cn("font-mono font-bold", "text-[#4fb47c]")}>{formatCurrency(netProfitAfterAll)}</span>
                                </div>
                                <div className={cn("flex justify-between items-center pt-2 border-t transition-colors", "border-[#141414]/5")}>
                                    <span className={cn("text-[10px] font-bold uppercase tracking-widest font-sans transition-colors", "text-[#141414]/60")}>Маржа</span>
                                    <span className={cn("font-mono font-black text-2xl transition-colors", "text-[#141414]")}>
                    {profitability.toFixed(1)}%
                  </span>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}


function DocumentRow({ name, size, date }: { name: string, size: string, date: string }) {
    return (
        <div className={cn(
            "p-5 rounded-2xl flex items-center justify-between group transition-all",
            "hover:bg-[#F5F5F0]"
        )}>
            <div className="flex items-center gap-4">
                <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                    "bg-[#F5F5F0] text-[#141414]/10 group-hover:text-[#5A5A40]"
                )}>
                    <FileText size={20} />
                </div>
                <div>
                    <p className={cn("text-xs font-bold transition-colors", "text-[#141414]")}>{name}</p>
                    <p className={cn("text-[9px] font-medium opacity-30", "text-[#141414]")}>
                        {size} • добавлен {date}
                    </p>
                </div>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className={cn("p-2 rounded-lg transition-all", "text-[#141414]/20 hover:text-[#141414]/60")}>
                    <Download size={16} />
                </button>
                <button className={cn("p-2 rounded-lg transition-all text-rose-500/40 hover:text-rose-500")}>
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
}


function StatusBadge({ status, className }: { status: string, className?: string }) {
    const styles = {
        lead: 'bg-[#16222c] text-[#4b7095]',
        active: 'bg-[#1e2612] text-[#7cb244]',
        completed: 'bg-[#12261b] text-[#4fb47c]',
        cancelled: 'bg-[#2c1616] text-[#bc5c5c]',
    };
    const labels = {
        lead: 'Лид',
        active: 'В работе',
        completed: 'Завершен',
        cancelled: 'Отменен',
    };
    return (
        <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", styles[status as keyof typeof styles], className)}>
      {labels[status as keyof typeof labels] || status}
    </span>
    );
}

function InfoField({ label, value, icon }: { label: string, value?: string, icon: React.ReactNode }) {
    return (
        <div className="flex items-start gap-4">
            <div className="p-3 bg-white/5 rounded-2xl text-[#c4a484]">
                {icon}
            </div>
            <div>
                <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest mb-1">{label}</p>
                <p className="font-medium text-white">{value || '—'}</p>
            </div>
        </div>
    );
}

function TrustInfoField({ label, value }: { label: string, value?: string }) {
    return (
        <div className="space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink-3">{label}</p>
            <p className="text-[13px] font-medium text-ink">{value || '—'}</p>
        </div>
    );
}




function getExpenseCategoryColorLegacy(category: string, index: number): string {
    const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
        Логистика: '#b07a2c', Мокап: '#2d4f35', Образцы: '#3b4a55', Монтаж: '#a04930', Закупка: '#5a6b3c',
    };
    const EXPENSE_CATEGORY_FALLBACK = ['#b07a2c', '#2d4f35', '#3b4a55', '#a04930', '#5a6b3c', '#7a7565'];
    return EXPENSE_CATEGORY_COLORS[category] ?? EXPENSE_CATEGORY_FALLBACK[index % EXPENSE_CATEGORY_FALLBACK.length];
}

function ExpenseCategoryChart({ expenses }: { expenses: { category: string; amount: number }[] }) {
    if (expenses.length === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="h-[72%] w-[72%] rounded-full border-[14px] border-line/60" />
            </div>
        );
    }

    const dataMap = expenses.reduce((acc, exp) => {
        acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
        return acc;
    }, {} as Record<string, number>);

    const data = Object.entries(dataMap).map(([name, value]) => ({ name, value }));

    return (
        <ResponsiveContainer width="100%" height="100%">
            <PieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                >
                    {data.map((entry, index) => (
                        <Cell key={entry.name} fill={getExpenseCategoryColorLegacy(entry.name, index)} />
                    ))}
                </Pie>
                <Tooltip
                    contentStyle={{
                        backgroundColor: 'var(--surface)',
                        borderRadius: '8px',
                        border: '1px solid var(--line)',
                        boxShadow: '0 4px 12px rgba(31,28,20,0.08)',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                    }}
                    itemStyle={{ color: 'var(--ink)' }}
                    formatter={(val: number) => formatCurrency(val)}
                />
            </PieChart>
        </ResponsiveContainer>
    );
}

function FinanceInput({
                          label,
                          value,
                          onChange,
                          disabled,
                          isPercentage,
                          compact,
                          percentField,
                          className,
                          valueColor = 'var(--ink)',
                      }: {
    label: string;
    value?: number;
    onChange?: (v: number) => void;
    disabled?: boolean;
    isPercentage?: boolean;
    compact?: boolean;
    percentField?: boolean;
    className?: string;
    valueColor?: string;
}) {
    const displayValue =
        value === undefined || value === null
            ? ''
            : isPercentage
                ? String(value)
                : formatAmountGrouped(value);

    const labelEl = (
        <label
            className={cn(
                DASHBOARD_CARD_LABEL,
                'block text-ink-3',
                percentField && 'whitespace-nowrap'
            )}
        >
            {label}
        </label>
    );

    const fieldClass = cn(
        'rounded-lg border border-line bg-surface font-display tabular-nums transition-all',
        compact ? 'px-2.5 py-2 text-[16px] leading-none' : 'px-3 py-2.5 text-[16px] leading-none',
        'focus:border-ochre/40 focus:outline-none focus:ring-2 focus:ring-ochre/15',
        disabled && 'cursor-default bg-surface-2',
        '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
    );

    return (
        <div className={cn('space-y-1.5', percentField && 'w-[7.25rem] shrink-0', className)}>
            {labelEl}
            {disabled && !onChange ? (
                <div className={cn(fieldClass, 'font-normal')} style={{ color: valueColor }}>
                    {displayValue}
                    {!isPercentage && displayValue !== '' && (
                        <span className="ml-1 text-[14px] opacity-70" style={{ color: valueColor }}>
              ₽
            </span>
                    )}
                    {isPercentage && displayValue !== '' && (
                        <span className="ml-0.5 text-[14px] opacity-70" style={{ color: valueColor }}>
              %
            </span>
                    )}
                </div>
            ) : isPercentage ? (
                <input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={value === 0 && onChange ? '' : value ?? ''}
                    disabled={disabled}
                    onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
                        onChange?.(digits ? Number(digits) : 0);
                    }}
                    className={cn(fieldClass, 'w-full text-ink')}
                    style={{ color: valueColor }}
                />
            ) : (
                <input
                    type="text"
                    inputMode="numeric"
                    value={value === 0 && onChange ? '' : value ?? ''}
                    disabled={disabled}
                    onChange={(e) => onChange?.(Number(e.target.value.replace(/\D/g, '')) || 0)}
                    className={cn(fieldClass, 'w-full text-ink')}
                />
            )}
        </div>
    );
}