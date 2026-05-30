import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { query, where, orderBy, getDocs, limit, doc, onSnapshot, updateDoc, collection, addDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Project, ProjectTask, ProjectEvent, Company, Contact, StakeholderGroup, Shipment, ProjectMaterial, TrustDeed } from '../types';
import CompanySelect from './CompanySelect';
import MaterialSelect from './MaterialSelect';
import { motion, AnimatePresence } from 'motion/react';
import {
    ArrowLeft,
    MapPin,
    User as UserIcon,
    Edit3,
    Save,
    Trash2,
    CheckCircle,
    CheckCircle2,
    Circle,
    Plus,
    X,
    BarChart3,
    Users,
    Package,
    Calendar,
    Clock,
    Flag,
    ChevronDown,
    ChevronRight,
    Info,
    DollarSign,
    Briefcase,
    Activity,
    Download,
    FileText,
    Truck,
    Check,
    PieChart as PieChartIcon,
    Printer,
    FileSearch,
    Search,
    Pencil,
    Layers
} from 'lucide-react';
import {
    ProjectStatus,
    STATUS_LABEL,
    STATUS_COLOR,
    STATUS_BG,
    STATUS_LIST
} from '../lib/statuses';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { formatCurrency, formatAmountGrouped, parseGroupedAmount, cn, formatDate, formatDateForInput, formatDateToDisplay, getShippingProgress, formatShippingProgressLabel, validateShipmentMaterialQuantity, SHIPPING_PROGRESS_COMPLETE_COLOR } from '../lib/utils';
import {
    getManagerBonus,
    getMarginColor,
    getMarginPercent,
    getNetProfitAfterAll,
    getProfitBeforeBonus,
    getTotalExpenses,
} from '../lib/financeCalculations';
import { exportShipmentsToExcel } from '../lib/export-shipments';
import ExpenseCategorySelect from './ExpenseCategorySelect';
import { DatePicker } from './ui/DatePicker';
import { TimeInput } from './ui/TimeInput';
import { PortalDropdown } from './ui/PortalDropdown';
import { generateTrustDeedDocx, downloadBlob, TrustDeedDocxData } from '../lib/generateTrustDeedDocx';
import { Button } from './ui/Button';
import { todayLocalISO } from '../lib/dates';

import { OperationType, handleFirestoreError } from '../lib/firestore-errors';
import CodeProtection from './CodeProtection';
import { useFinanceAccess } from '../hooks/useFinanceAccess';
import { AppUser } from '../types';
import UserAvatar from './UserAvatar';
import ProjectDocuments from './ProjectDocuments';
import StatusPill from './StatusPill';
import { createCalendarEvent, isCalendarAuthError, verifyCalendarAccess } from '../services/googleCalendarService';

function DueBlock({ project, overdue, daysRemaining }: { project: Project; overdue: boolean; daysRemaining: number }) {
    const isDone = project.status === 'done' || project.status === 'completed';
    const isCanceled = project.status === 'canceled' || project.status === 'cancelled';
    const completedDate = project.completed || project.actualCompletionDate;

    if (isDone) {
        return (
            <div className="text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Завершён</div>
                <div className="font-display text-[20px] text-forest mt-1 leading-[1.1]">
                    {formatDateToDisplay(completedDate || project.deadline)}
                </div>
            </div>
        );
    }
    if (isCanceled) {
        return (
            <div className="text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Отменён</div>
                <div className="font-display text-[20px] text-terracotta mt-1 leading-[1.1]">—</div>
            </div>
        );
    }
    if (overdue) {
        return (
            <div className="text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-terracotta">Просрочка</div>
                <div className="font-display text-[24px] text-terracotta mt-1 leading-[1.1]">
                    {Math.abs(daysRemaining)} <span className="text-[13px]">дн.</span>
                </div>
                <div className="text-[11px] text-ink-3 mt-0.5">план до {formatDateToDisplay(project.deadline)}</div>
            </div>
        );
    }
    return (
        <div className="text-right">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">До сдачи</div>
            <div className="font-display text-[24px] text-ink mt-1 leading-[1.1]">
                {daysRemaining} <span className="text-[13px]">дн.</span>
            </div>
            <div className="text-[11px] text-ink-3 mt-0.5">срок до {formatDateToDisplay(project.deadline)}</div>
        </div>
    );
}

function OverduePill({ days }: { days: number }) {
    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#f1d9cf] text-[#a04930] whitespace-nowrap">
      Просрочка {days} дн.
    </span>
    );
}

interface ProjectDetailProps {
    projectId: string;
    initialTaskId?: string | null;
    onBack: () => void;
    appUser: AppUser | null;
    accessToken?: string | null;
    onConnectCalendar?: () => Promise<boolean>;
    onClearCalendarToken?: () => void;
}

export default function ProjectDetail({
                                          projectId,
                                          initialTaskId,
                                          onBack,
                                          appUser,
                                          accessToken,
                                          onConnectCalendar,
                                          onClearCalendarToken
                                      }: ProjectDetailProps) {
    const [project, setProject] = useState<Project | null>(null);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [trustDeeds, setTrustDeeds] = useState<TrustDeed[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeSegment, setActiveSegment] = useState<'info' | 'materials' | 'activity' | 'finance' | 'trust'>(
        initialTaskId ? 'activity' : 'info'
    );
    const [users, setUsers] = useState<AppUser[]>([]);
    const [directories, setDirectories] = useState<{
        materials: any[],
        units: any[],
        drivers: any[],
        carriers: any[],
        companies: any[],
        contacts: any[]
    }>({ materials: [], units: [], drivers: [], carriers: [], companies: [], contacts: [] });

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'users'), (snap) => {
            setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser)));
        }, (error) => {
            console.error("ProjectDetail users snapshot error:", error);
        });

        // Fetch directories for materials tab
        const collections = ['materials', 'units', 'drivers', 'carriers', 'companies', 'contacts'];
        const unsubs = collections.map(col =>
            onSnapshot(collection(db, col), (snap) => {
                setDirectories(prev => ({
                    ...prev,
                    [col]: snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                }));
            }, (error) => {
                console.error(`ProjectDetail directory ${col} snapshot error:`, error);
            })
        );

        return () => {
            unsub();
            unsubs.forEach(u => u());
        };
    }, []);

    const canEdit = appUser?.fullProjectAccess === true ||
        appUser?.projectsAccess?.[projectId] === 'edit' ||
        project?.leadManagerId === appUser?.uid;

    const {
        canSeeFinancialData,
        canDisplayFinancialAmounts,
        needsCodeGate,
        unlock,
    } = useFinanceAccess(appUser);

    useEffect(() => {
        if (!canSeeFinancialData && activeSegment === 'finance') {
            setActiveSegment('info');
        }
    }, [canSeeFinancialData, activeSegment]);

    useEffect(() => {
        const unsubProject = onSnapshot(doc(db, 'projects', projectId), (doc) => {
            if (doc.exists()) {
                setProject({ id: doc.id, ...doc.data() } as Project);
            }
            setLoading(false);
        }, (error) => {
            handleFirestoreError(error, OperationType.GET, `projects/${projectId}`);
        });

        const unsubTasks = onSnapshot(collection(db, 'projects', projectId, 'tasks'), (snapshot) => {
            setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProjectTask)));
        }, (error) => {
            handleFirestoreError(error, OperationType.GET, `projects/${projectId}/tasks`);
        });

        const unsubTrustDeeds = onSnapshot(collection(db, 'projects', projectId, 'trust_deeds'), (snapshot) => {
            setTrustDeeds(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrustDeed)));
        }, (error) => {
            console.error("Trust deeds error:", error);
        });

        return () => {
            unsubProject();
            unsubTasks();
            unsubTrustDeeds();
        };
    }, [projectId]);

    useEffect(() => {
        if (initialTaskId && !loading && activeSegment === 'activity' && tasks.length > 0) {
            // Small timeout to ensure DOM is rendered
            const timer = setTimeout(() => {
                const element = document.getElementById(`task-${initialTaskId}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.classList.add('bg-ochre/10');
                    setTimeout(() => {
                        element.classList.remove('bg-ochre/10');
                    }, 3000);
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [initialTaskId, loading, activeSegment, tasks.length]);

    if (loading) return <div className={cn("h-96 flex items-center justify-center transition-colors", "text-[#5A5A40]/40")}>Загрузка...</div>;
    if (!project) return <div className="h-96 flex items-center justify-center text-rose-500">Проект не найден</div>;

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'active': return "bg-[#7cb244]/10 text-[#7cb244] focus:ring-[#7cb244]/20";
            case 'completed': return "bg-[#4fb47c]/10 text-[#4fb47c] focus:ring-[#4fb47c]/20";
            case 'cancelled': return "bg-[#bc5c5c]/10 text-[#bc5c5c] focus:ring-[#bc5c5c]/20";
            default: return "bg-[#4b7095]/10 text-[#4b7095] focus:ring-[#4b7095]/20";
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'active': return 'В работе';
            case 'completed': return 'Завершен';
            case 'cancelled': return 'Отменен';
            case 'lead': return 'Лид';
            default: return status;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'active': return "text-[#7cb244] bg-[#7cb244]/10";
            case 'completed': return "text-[#4fb47c] bg-[#4fb47c]/10";
            case 'cancelled': return "text-rose-500 bg-rose-500/10";
            default: return "text-[#4b7095] bg-[#4b7095]/10";
        }
    };

    const formatMln = (val: number) => {
        if (!val) return '0';
        return (val / 1000000).toFixed(1);
    };

    // Calculate days remaining
    const daysRemaining = (() => {
        if (!project.deadline) return 0;
        const deadlineDate = project.deadline.toDate
            ? project.deadline.toDate()
            : new Date(project.deadline);
        if (isNaN(deadlineDate.getTime())) return 0;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        deadlineDate.setHours(0, 0, 0, 0);
        return Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    })();

    const shippingProgress = getShippingProgress(project, trustDeeds);

    const isDone = project.status === 'done' || project.status === 'completed';
    const isCanceled = project.status === 'cancelled' || project.status === 'canceled';
    const overdue = daysRemaining < 0 && !isDone && !isCanceled;

    const manager = {
        name: project.leadManagerName || '—'
    };

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
        >
            {/* Breadcrumbs */}
            <div className="flex items-center gap-2 text-[12px] text-ink-3 mb-4">
                <button onClick={onBack} className="hover:text-ink transition-colors">Проекты</button>
                <ChevronRight size={12} className="text-ink-4" />
                <span className="text-ink-2 truncate">{project.name}</span>
            </div>

            {/* Header Card */}
            <div className={cn(
                "rounded-2xl border shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] px-[22px] py-[18px] mb-5 overflow-hidden",
                overdue
                    ? "bg-gradient-to-b from-[#f1d9cf] to-surface border-[#f1d9cf]"
                    : "bg-surface border-line"
            )}>
                <div className={cn(
                    'grid grid-cols-1 gap-6 items-center',
                    canDisplayFinancialAmounts
                        ? 'lg:grid-cols-[1.4fr_1fr_1fr_1fr]'
                        : 'lg:grid-cols-[1.4fr_1fr]'
                )}>
                    {/* Левая часть: статус + название + мета */}
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
                            <StatusPill status={project.status} />

                            <span className="text-[11.5px] text-ink-3 inline-flex items-center gap-1 whitespace-nowrap">
                <Calendar size={11} />
                Создан {formatDateToDisplay(project.createdAt || (project as any).creationDate)}
              </span>

                            {/* Маленькая «Завершён» — ТОЛЬКО когда completed есть, но статус НЕ done.
                 Это редкий кейс, когда дату оставили исторически, а статус сменили обратно. */}
                            {(project.completed || project.actualCompletionDate) && !isDone && (
                                <span className="text-[11.5px] text-ink-3 inline-flex items-center gap-1 whitespace-nowrap">
                  <CheckCircle size={11} />
                  Завершён {formatDateToDisplay(project.completed || project.actualCompletionDate)}
                </span>
                            )}
                        </div>

                        <h1 className="font-display text-[26px] font-normal text-ink leading-[1.1] tracking-[-0.01em] mb-2 truncate">
                            {project.name}
                        </h1>

                        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-3">
                            <span className="inline-flex items-center gap-1"><MapPin size={13} />{project.address}</span>
                            <span>·</span>
                            <span className="italic font-display text-[13px] text-ink-2">{project.stakeholders?.client?.companyName || project.client}</span>
                        </div>
                    </div>

                    {canDisplayFinancialAmounts && (() => {
                        const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
                        const marginPct = Math.round(getMarginPercent(f));
                        const marginColor = getMarginColor(marginPct);
                        return (
                            <>
                                <div>
                                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Контракт</p>
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="font-display text-[24px] font-normal text-ink leading-none tabular-nums">{formatMln(f.contractSum)}</span>
                                        <span className="font-display text-[13px] text-ink-3">млн ₽</span>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Маржа</p>
                                    <p className="font-display text-[24px] font-normal leading-none tabular-nums" style={{ color: marginColor }}>{marginPct}%</p>
                                </div>
                            </>
                        );
                    })()}

                    {/* Правая (последняя) колонка грида шапки — срок */}
                    <div className="flex flex-col items-end justify-center text-right">
                        {/* Блок срока — теперь с text-right */}
                        <DueBlock project={project} overdue={overdue} daysRemaining={daysRemaining} />
                    </div>
                </div>

                {/* Прогресс-бар */}
                <div className="mt-[14px]">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Отгружено</span>
                        <span className="text-[12px] font-semibold text-ink tabular-nums">
              {formatShippingProgressLabel(shippingProgress)}
            </span>
                    </div>
                    <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${shippingProgress.barPercent}%` }}
                            className={cn(
                                "h-full transition-all duration-700",
                                !shippingProgress.isComplete && "bg-ochre"
                            )}
                            style={shippingProgress.isComplete ? { backgroundColor: SHIPPING_PROGRESS_COMPLETE_COLOR } : undefined}
                        />
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-line flex gap-6 overflow-x-auto no-scrollbar mb-6">
                <TabButton active={activeSegment === 'info'} onClick={() => setActiveSegment('info')} label="Информация" />
                <TabButton active={activeSegment === 'materials'} onClick={() => setActiveSegment('materials')} label="Материалы и отгрузки" count={project.shipments?.length} />
                <TabButton active={activeSegment === 'activity'} onClick={() => setActiveSegment('activity')} label="Задачи" count={tasks.length} />
                {canSeeFinancialData && (
                    <TabButton
                        active={activeSegment === 'finance'}
                        onClick={() => setActiveSegment('finance')}
                        label="Финансы и бонусы"
                    />
                )}
                <TabButton active={activeSegment === 'trust'} onClick={() => setActiveSegment('trust')} label="Доверенности" count={trustDeeds.length} />
            </div>

            {/* Content Area */}
            <div className="grid grid-cols-1 gap-8">
                <AnimatePresence mode="wait">
                    {activeSegment === 'info' && <motion.div key="info"><PersonalInfoTab project={project} canEdit={canEdit} users={users} /></motion.div>}
                    {activeSegment === 'materials' && <motion.div key="materials"><MaterialsTab project={project} canEdit={canEdit} directories={directories} trustDeeds={trustDeeds} /></motion.div>}
                    {activeSegment === 'activity' && <motion.div key="activity"><ActivityTab tasks={tasks} projectId={projectId} canEdit={canEdit} project={project} accessToken={accessToken} onConnectCalendar={onConnectCalendar} onClearCalendarToken={onClearCalendarToken} /></motion.div>}
                    {activeSegment === 'finance' && canSeeFinancialData && (
                        <motion.div key="finance">
                            <FinanceTab
                                project={project}
                                canEdit={canEdit}
                                users={users}
                                appUser={appUser}
                                needsCodeGate={needsCodeGate}
                                onUnlock={unlock}
                            />
                        </motion.div>
                    )}
                    {activeSegment === 'trust' && <motion.div key="trust"><TrustDeedsTab project={project} canEdit={canEdit} directories={directories} trustDeeds={trustDeeds} /></motion.div>}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

function TabButton({ active, onClick, label, count }: { active: boolean, onClick: () => void, label: string, count?: number }) {
    // Иконка по лейблу
    const iconNode =
        label === 'Информация'           ? <FileText size={13} /> :
            label === 'Материалы и отгрузки' ? <Truck size={13} /> :
                label === 'Задачи'               ? <Check size={13} /> :
                    label === 'Финансы и бонусы'     ? <DollarSign size={13} /> :
                        label === 'Доверенности'         ? <FileText size={13} /> :
                            null;

    return (
        <button
            onClick={onClick}
            className={cn(
                "pb-3 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors relative inline-flex items-center gap-2 whitespace-nowrap",
                active ? "text-ink" : "text-ink-3 hover:text-ink-2"
            )}
        >
      <span className={cn("flex items-center", active ? "text-ink" : "text-ink-3")}>
        {iconNode}
      </span>
            <span>{label}</span>
            {count !== undefined && count > 0 && (
                <span className={cn(
                    "text-[10px] font-semibold tabular-nums px-1.5 py-[1px] rounded-full leading-tight tracking-normal",
                    active ? "bg-ochre-bg text-ochre" : "bg-surface-2 text-ink-3"
                )}>
          {count}
        </span>
            )}
            {active && (
                <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-ochre rounded-full"
                />
            )}
        </button>
    );
}

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

function PersonalInfoTab({ project, canEdit, users }: { project: Project, canEdit: boolean, users: AppUser[] }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedProject, setEditedProject] = useState(() => ({
        ...project,
        createdAt: formatDateForInput(project.createdAt || (project as any).creationDate),
        deadline: formatDateForInput(project.deadline),
        actualCompletionDate: formatDateForInput(project.actualCompletionDate || project.completed)
    }));
    const [editingRole, setEditingRole] = useState<string | null>(null);

    const [managerDropdownOpen, setManagerDropdownOpen] = useState(false);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const statusTriggerRef = React.useRef<HTMLButtonElement>(null);
    const managerTriggerRef = React.useRef<HTMLButtonElement>(null);

    const getAsString = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        return formatDateForInput(val);
    };

    useEffect(() => {
        if (!isEditing) {
            setEditedProject({
                ...project,
                createdAt: formatDateForInput(project.createdAt || (project as any).creationDate),
                deadline: formatDateForInput(project.deadline),
                actualCompletionDate: formatDateForInput(project.actualCompletionDate || project.completed)
            });
        }
    }, [project, isEditing]);

    const handleSave = async () => {
        if (!canEdit) return;
        try {
            const { id, ...data } = editedProject;
            const leadManager = users.find(u => u.uid === editedProject.leadManagerId);
            const newLeadManagerName = leadManager?.displayName || '';
            const actualCompStr = getAsString(editedProject.actualCompletionDate);
            const finalCompletionDate = (actualCompStr && actualCompStr.trim() !== "") ? new Date(actualCompStr) : null;
            const createdStr = getAsString(editedProject.createdAt);
            const deadlineStr = getAsString(editedProject.deadline);
            const updateData: any = {
                ...data,
                createdAt: (createdStr && createdStr.trim() !== "") ? new Date(createdStr) : null,
                creationDate: (createdStr && createdStr.trim() !== "") ? new Date(createdStr) : null,
                deadline: (deadlineStr && deadlineStr.trim() !== "") ? new Date(deadlineStr) : null,
                actualCompletionDate: finalCompletionDate,
                completed: finalCompletionDate,
                leadManagerName: newLeadManagerName,
                updatedAt: serverTimestamp(),
                status: editedProject.status
            };
            await updateDoc(doc(db, 'projects', project.id), updateData);
            setEditedProject(prev => ({ ...prev, leadManagerName: newLeadManagerName }));
            setIsEditing(false);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const rawStatus = editedProject.status as any;
    const currentStatus: ProjectStatus =
        rawStatus === 'lead' || rawStatus === 'active' ? 'in_progress' :
            rawStatus === 'completed' ? 'done' :
                rawStatus === 'cancelled' ? 'canceled' :
                    (rawStatus as ProjectStatus) || 'in_progress';

    const handleStatusChange = (next: ProjectStatus) => {
        const prev = currentStatus;
        let newActualCompletion = editedProject.actualCompletionDate;

        // При переключении на "Завершён" или "Отменён" — проставляем сегодняшнюю локальную дату,
        // если поле ещё не заполнено.
        if ((next === 'done' || next === 'canceled') && (!newActualCompletion || getAsString(newActualCompletion).trim() === '')) {
            newActualCompletion = todayLocalISO();
        }

        // При смене статуса с «Завершён» или «Отменён» на любой другой («В работе» или др.) — поле «Дата фактического завершения» нужно очищать автоматически
        if ((prev === 'done' || prev === 'canceled') && next !== 'done' && next !== 'canceled') {
            newActualCompletion = '';
        }

        setEditedProject(prevProj => ({
            ...prevProj,
            status: next,
            actualCompletionDate: newActualCompletion
        }));
    };

    const s = project.stakeholders || {};

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5">
            {/* Левая колонка: Основная информация + Документы */}
            <div className="flex flex-col gap-5">
                {/* Основная информация */}
                <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
                    <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
                        <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Основная информация</h3>
                        {canEdit && (
                            <button
                                type="button"
                                onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                            >
                                {isEditing
                                    ? <><Check size={12} /> Готово</>
                                    : <><Pencil size={12} /> Редактировать</>}
                            </button>
                        )}
                    </div>

                    <div className="px-5 py-1 divide-y divide-line">
                        <EditField label="Наименование проекта" value={editedProject.name} isEditing={isEditing} onChange={(v) => setEditedProject({...editedProject, name: v})} icon={<Briefcase />} placeholder="не указано" />
                        <EditField label="Адрес объекта" value={editedProject.address} isEditing={isEditing} onChange={(v) => setEditedProject({...editedProject, address: v})} icon={<MapPin />} placeholder="не указан" />

                        {/* Статус */}
                        <div className="grid items-start gap-3.5 py-3.5 relative" style={{ gridTemplateColumns: '32px 1fr' }}>
                            <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink-3 shrink-0">
                                {isEditing ? (
                                    <Circle size={14} className="text-ink-3" />
                                ) : (
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[currentStatus] }} />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Статус</p>
                                <div className="max-w-[220px]">
                                    {isEditing ? (
                                        <div className="relative">
                                            <button
                                                ref={statusTriggerRef}
                                                type="button"
                                                onClick={() => setStatusDropdownOpen(o => !o)}
                                                className="w-full flex items-center justify-between gap-2 bg-surface border border-line rounded-md px-3 py-2.5 text-[13px] text-ink hover:bg-surface-2 focus:border-ochre focus:outline-none transition-colors"
                                            >
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[currentStatus] }} />
                            {STATUS_LABEL[currentStatus]}
                        </span>
                                                <ChevronDown size={14} className="text-ink-3 shrink-0" />
                                            </button>
                                            <PortalDropdown
                                                anchorRef={statusTriggerRef}
                                                open={statusDropdownOpen}
                                                onClose={() => setStatusDropdownOpen(false)}
                                            >
                                                {STATUS_LIST.map(s => (
                                                    <button
                                                        key={s}
                                                        type="button"
                                                        onClick={() => {
                                                            handleStatusChange(s);
                                                            setStatusDropdownOpen(false);
                                                        }}
                                                        className={cn(
                                                            "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                                                            s === currentStatus
                                                                ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold"
                                                                : "text-ink hover:bg-surface-2"
                                                        )}
                                                    >
                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[s] }} />
                                                        <span className="truncate">{STATUS_LABEL[s]}</span>
                                                    </button>
                                                ))}
                                            </PortalDropdown>
                                        </div>
                                    ) : (
                                        <StatusPill status={currentStatus} />
                                    )}
                                </div>
                            </div>
                        </div>

                        <EditField
                            label="Дата создания"
                            value={isEditing ? formatDateForInput(editedProject.createdAt) : formatDateToDisplay(editedProject.createdAt)}
                            isEditing={isEditing}
                            type="date"
                            onChange={(v) => setEditedProject({...editedProject, createdAt: v})}
                            icon={<Calendar />}
                            placeholder="не указана"
                        />
                        <EditField label="Срок проекта" value={isEditing ? formatDateForInput(editedProject.deadline) : formatDateToDisplay(editedProject.deadline)} isEditing={isEditing} type="date" onChange={(v) => setEditedProject({...editedProject, deadline: v})} icon={<Flag />} placeholder="не указан" />

                        {(currentStatus === 'done' || (editedProject.actualCompletionDate && getAsString(editedProject.actualCompletionDate).trim() !== "")) && (
                            <EditField
                                label="Дата фактического завершения"
                                value={isEditing ? formatDateForInput(editedProject.actualCompletionDate) : formatDateToDisplay(editedProject.actualCompletionDate)}
                                isEditing={isEditing}
                                type="date"
                                onChange={(v) => setEditedProject({...editedProject, actualCompletionDate: v})}
                                icon={<CheckCircle2 />}
                                placeholder="не указана"
                            />
                        )}

                        {/* Ведущий менеджер */}
                        <div className="grid items-start gap-3.5 py-3.5 relative" style={{ gridTemplateColumns: '32px 1fr' }}>
                            {editedProject.leadManagerId && editedProject.leadManagerName ? (
                                <UserAvatar
                                    uid={editedProject.leadManagerId}
                                    name={editedProject.leadManagerName}
                                    size="sm"
                                />
                            ) : (
                                <UserAvatar
                                    uid=""
                                    name=""
                                    size="sm"
                                />
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Ведущий менеджер</p>
                                <div className="max-w-[260px]">
                                    {isEditing ? (
                                        <div className="relative">
                                            <button
                                                ref={managerTriggerRef}
                                                type="button"
                                                onClick={() => setManagerDropdownOpen(o => !o)}
                                                className="w-full flex items-center justify-between gap-2 bg-surface border border-line rounded-md px-3 py-2.5 text-[13px] text-ink hover:bg-surface-2 focus:border-ochre focus:outline-none transition-colors"
                                            >
                        <span className={editedProject.leadManagerId ? "" : "text-ink-4"}>
                          {users.find(u => u.uid === editedProject.leadManagerId)?.displayName || 'Не назначен'}
                        </span>
                                                <ChevronDown size={14} className="text-ink-3 shrink-0" />
                                            </button>
                                            <PortalDropdown
                                                anchorRef={managerTriggerRef}
                                                open={managerDropdownOpen}
                                                onClose={() => setManagerDropdownOpen(false)}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditedProject({ ...editedProject, leadManagerId: '', leadManagerName: '' });
                                                        setManagerDropdownOpen(false);
                                                    }}
                                                    className={cn(
                                                        "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                                                        !editedProject.leadManagerId
                                                            ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold"
                                                            : "text-ink hover:bg-surface-2"
                                                    )}
                                                >
                                                    <UserAvatar uid="" name="" size="xs" />
                                                    <span className="truncate">Не назначен</span>
                                                </button>
                                                {users.map(u => (
                                                    <button
                                                        key={u.uid}
                                                        type="button"
                                                        onClick={() => {
                                                            setEditedProject({ ...editedProject, leadManagerId: u.uid, leadManagerName: u.displayName });
                                                            setManagerDropdownOpen(false);
                                                        }}
                                                        className={cn(
                                                            "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                                                            u.uid === editedProject.leadManagerId
                                                                ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold"
                                                                : "text-ink hover:bg-surface-2"
                                                        )}
                                                    >
                                                        <UserAvatar
                                                            uid={u.uid}
                                                            name={u.displayName}
                                                            photoURL={u.photoURL}
                                                            size="xs"
                                                        />
                                                        <span className="truncate">{u.displayName}</span>
                                                    </button>
                                                ))}
                                            </PortalDropdown>
                                        </div>
                                    ) : (
                                        editedProject.leadManagerName
                                            ? <p className="text-[14px] font-medium text-ink leading-snug">{editedProject.leadManagerName}</p>
                                            : <p className="text-[14px] italic text-ink-4 leading-snug">не назначен</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Документы */}
                <ProjectDocuments projectId={project.id} canEdit={canEdit} />
            </div>

            {/* Правая колонка: Участники проекта */}
            <div className="flex flex-col gap-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 px-1">Участники проекта</p>
                <StakeholderCard title="Заказчик" data={s.client} onEdit={() => setEditingRole('client')} canEdit={canEdit} />
                <StakeholderCard title="Генподрядчик" data={s.generalContractor} onEdit={() => setEditingRole('generalContractor')} canEdit={canEdit} />
                <StakeholderCard title="Подрядчик" data={s.subcontractor} onEdit={() => setEditingRole('subcontractor')} canEdit={canEdit} />
                <StakeholderCard title="Архитектор" data={s.architect} onEdit={() => setEditingRole('architect')} canEdit={canEdit} />
            </div>

            <AnimatePresence>
                {editingRole && (
                    <StakeholderEditForm
                        projectId={project.id}
                        role={editingRole}
                        currentData={s[editingRole as keyof typeof s] as StakeholderGroup | undefined}
                        onClose={() => setEditingRole(null)}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function MaterialModal({ project, editingId, onClose, directories }: { project: Project, editingId: string | null, onClose: () => void, directories: any }) {
    const editingMaterial = project.materials?.find(m => m.id === editingId);
    const [form, setForm] = useState<Partial<ProjectMaterial>>(editingMaterial || {
        materialName: '',
        quantity: undefined,
        unitName: 'шт.',
        deliveryMonth: '',
        supplierName: '',
        supplierContactId: ''
    });

    const [showAddSupplierContact, setShowAddSupplierContact] = useState(false);
    const [supplierContact, setSupplierContact] = useState({ name: '', position: '', phone: '' });
    const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);

    const selectedSupplierCompany = directories.companies?.find((c: any) => c.name === form.supplierName);
    const supplierId = selectedSupplierCompany?.id;

    // Track contacts for the selected supplier
    useEffect(() => {
        if (supplierId) {
            const q = query(collection(db, 'contacts'), where('companyId', '==', supplierId));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setAvailableContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
            });
            return () => unsubscribe();
        } else {
            setAvailableContacts([]);
        }
    }, [supplierId]);

    const handleCreateSupplierContact = async () => {
        if (!supplierId || !supplierContact.name) return;
        try {
            const docRef = await addDoc(collection(db, 'contacts'), {
                companyId: supplierId,
                ...supplierContact,
                createdAt: serverTimestamp()
            });
            setForm(prev => ({ ...prev, supplierContactId: docRef.id }));
            setSupplierContact({ name: '', position: '', phone: '' });
            setShowAddSupplierContact(false);
        } catch (error) {
            console.error(error);
        }
    };

    const handleSave = async () => {
        try {
            const materials = project.materials || [];
            const newMaterial = {
                ...form,
                quantity: form.quantity || 0,
                id: editingId || crypto.randomUUID(),
            } as ProjectMaterial;

            let updated;
            if (editingId) {
                updated = materials.map(m => m.id === editingId ? newMaterial : m);
            } else {
                updated = [...materials, newMaterial];
            }

            await updateDoc(doc(db, 'projects', project.id), {
                materials: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const handleDelete = async () => {
        if (!editingId || !confirm('Удалить этот материал из проекта?')) return;
        try {
            const updated = (project.materials || []).filter(m => m.id !== editingId);
            await updateDoc(doc(db, 'projects', project.id), {
                materials: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/materials/${editingId}`);
        }
    };

    const inputClass = cn(
        "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
    );

    const isContactFormOpen = supplierId && (availableContacts.length === 0 || showAddSupplierContact);

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="fixed inset-0"
                style={{ backgroundColor: 'rgba(31,28,20,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-[560px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto overflow-hidden"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                        {editingId ? 'Редактировать материал' : 'Добавить материал'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 flex-1 overflow-y-auto flex flex-col gap-5">
                    {/* Материал */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                            МАТЕРИАЛ
                        </label>
                        <MaterialSelect
                            value={form.materialName || ''}
                            onChange={(name, id) => setForm({...form, materialName: name, materialId: id})}
                            placeholder="Выбрать из справочника..."
                        />
                    </div>

                    {/* Количество, Ед. изм., Месяц поставки */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                                КОЛИЧЕСТВО
                            </label>
                            <input
                                type="number"
                                value={form.quantity !== undefined ? form.quantity : ''}
                                onChange={e => setForm({...form, quantity: e.target.value ? Number(e.target.value) : undefined})}
                                className={inputClass}
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                                ЕД. ИЗМ.
                            </label>
                            <DirectorySelect
                                value={form.unitName || ''}
                                options={directories.units}
                                onChange={v => setForm({...form, unitName: v})}
                                onAdd={async name => {
                                    await addDoc(collection(db, 'units'), { name, createdAt: serverTimestamp() });
                                    setForm({...form, unitName: name});
                                }}
                                placeholder="шт., м2..."
                                className={inputClass}
                                iconType="unit"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                                МЕСЯЦ ПОСТАВКИ
                            </label>
                            <input
                                value={form.deliveryMonth || ''}
                                onChange={e => setForm({...form, deliveryMonth: e.target.value})}
                                placeholder="напр. июнь"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {/* Поставщик */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574]">
                                ПОСТАВЩИК
                            </label>
                            {supplierId && !isContactFormOpen && (
                                <button
                                    type="button"
                                    onClick={() => setShowAddSupplierContact(true)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                                >
                                    <Plus size={11} className="text-ochre" /> Добавить контактное лицо
                                </button>
                            )}
                        </div>
                        <CompanySelect
                            value={form.supplierName || ''}
                            onChange={(name, id) => {
                                setForm({...form, supplierName: name, supplierId: id, supplierContactId: ''});
                                setShowAddSupplierContact(false);
                            }}
                            placeholder="Выбрать компанию-поставщика..."
                            companyType="Поставщик"
                            onCreateCompany={{ companyType: 'Поставщик' }}
                        />

                        {/* Контактные лица */}
                        {supplierId && (
                            <div className="mt-3.5">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8574] mb-2">
                                    КОНТАКТНЫЕ ЛИЦА
                                </p>

                                {availableContacts.length > 0 && (
                                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto mb-3">
                                        {availableContacts.map(contact => {
                                            const selected = form.supplierContactId === contact.id;
                                            return (
                                                <div
                                                    key={contact.id}
                                                    className={cn(
                                                        "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors group",
                                                        selected
                                                            ? "bg-ochre-bg border-[var(--ochre-soft)]"
                                                            : "bg-surface-2 border-transparent hover:bg-surface hover:border-line"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setForm(prev => ({
                                                                ...prev,
                                                                supplierContactId: selected ? undefined : contact.id
                                                            }));
                                                        }}
                                                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                                                    >
                            <span className="w-7 h-7 rounded-full bg-surface border border-line flex items-center justify-center text-ink-3 shrink-0">
                              <UserIcon size={13} />
                            </span>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-[13px] font-semibold text-ink truncate leading-tight">{contact.name}</p>
                                                            {(contact.position || contact.phone) && (
                                                                <p className="text-[11px] text-ink-3 truncate mt-0.5">
                                                                    {contact.position}
                                                                    {contact.position && contact.phone && ' · '}
                                                                    {contact.phone && <span className="tabular-nums">{contact.phone}</span>}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </button>
                                                    {selected && (
                                                        <CheckCircle2 size={14} className="text-ochre shrink-0" />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {isContactFormOpen && (
                                    <div className={cn(
                                        "p-4 rounded-xl bg-[var(--ochre-bg)] border border-[var(--ochre-soft)] flex flex-col gap-2.5",
                                        availableContacts.length > 0 && "mt-3"
                                    )}>
                                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ochre)]">
                                            {availableContacts.length === 0
                                                ? `Первое контактное лицо для ${form.supplierName || 'компании'}`
                                                : `Новое контактное лицо для ${form.supplierName}`}
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                placeholder="ФИО"
                                                value={supplierContact.name}
                                                onChange={e => setSupplierContact({...supplierContact, name: e.target.value})}
                                                className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4 h-10"
                                            />
                                            <input
                                                placeholder="Должность"
                                                value={supplierContact.position}
                                                onChange={e => setSupplierContact({...supplierContact, position: e.target.value})}
                                                className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4 h-10"
                                            />
                                            <input
                                                placeholder="Телефон"
                                                value={supplierContact.phone}
                                                onChange={e => setSupplierContact({...supplierContact, phone: e.target.value})}
                                                className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4 col-span-2 h-10"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleCreateSupplierContact}
                                                disabled={!supplierContact.name}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--ochre)] text-[var(--bg-elev)] hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                Сохранить контакт
                                            </button>
                                            {availableContacts.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setShowAddSupplierContact(false); setSupplierContact({ name: '', position: '', phone: '' }); }}
                                                    className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[#c4a484] hover:bg-surface transition-colors"
                                                >
                                                    Отмена
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-between items-center shrink-0 rounded-b-2xl">
                    <div>
                        {editingId && (
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 rounded-md text-[13px] font-semibold text-rose-500 border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500 hover:text-white transition-colors flex items-center gap-1.5"
                            >
                                <Trash2 size={14} /> Удалить
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors"
                        >
                            {editingId ? 'Сохранить изменения' : 'Добавить материал'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>,
        document.body
    );
}

function ShipmentModal({ project, editingId, onClose, directories, trustDeeds = [] }: { project: Project, editingId: string | null, onClose: () => void, directories: any, trustDeeds?: TrustDeed[] }) {
    const editingShipment = project.shipments?.find(s => s.id === editingId);

    // Resolve deed for editing shipment
    const editingDeed = editingShipment?.poaNumber
        ? trustDeeds.find(d => d.number === editingShipment.poaNumber)
        : null;

    const [form, setForm] = useState<Partial<Shipment>>(() => {
        const isSent = editingShipment
            ? (editingShipment.scanSentToAccounting === true || editingShipment.scanSentToAccounting === 'yes')
            : false;

        const base = editingShipment
            ? { ...editingShipment, autoNumber: editingShipment.autoNumber || String((project.shipments || []).indexOf(editingShipment) + 1) }
            : {
                docType: 'upd',
                incomingUPD: '',
                outgoingUPD: '',
                poaNumber: '',
                autoNumber: String((project.shipments || []).length + 1),
                loadingDate: '',
                unloadingDate: '',
                totalCarryingCost: 0,
                carrierUPD: '',
            };

        return { ...base, scanSentToAccounting: isSent };
    });

    const [quantityError, setQuantityError] = useState<string | null>(null);

    // Resolve current deed from form selection
    const selectedDeed = form.poaNumber
        ? trustDeeds.find(d => d.number === form.poaNumber)
        : null;

    // Derive locked fields from deed
    const deedMaterial = selectedDeed
        ? (() => {
            const mat = project.materials?.find(
                m => m.id === selectedDeed.materialId || m.materialName === selectedDeed.materialName
            );
            return mat
                ? `${mat.materialName}${(mat as any).supplierName ? ' ' + (mat as any).supplierName : ''}`
                : selectedDeed.materialName || '';
        })()
        : '';
    const deedQuantity = selectedDeed?.quantity ?? 0;
    const deedCarryingCost = selectedDeed?.rate ?? 0;
    const deedCarrierInvoice = selectedDeed
        ? `Счёт №${selectedDeed.accountNumber || ''}${(selectedDeed as any).accountDate ? ' от ' + formatDateToDisplay((selectedDeed as any).accountDate) : ''}`
        : '';
    const deedCarrierName = selectedDeed?.carrierName || '';

    const handleSave = async () => {
        if (!form.poaNumber) {
            setQuantityError('Выберите доверенность — это обязательное поле.');
            return;
        }

        setQuantityError(null);

        try {
            const shipments = project.shipments || [];
            // Store only fields NOT derivable from deed
            const newShipment: any = {
                id: editingId || crypto.randomUUID(),
                autoNumber: form.autoNumber,
                poaNumber: form.poaNumber,
                trustDeedId: selectedDeed?.id || editingDeed?.id || '',
                docType: form.docType || 'upd',
                incomingUPD: form.incomingUPD || '',
                outgoingUPD: form.outgoingUPD || '',
                scanSentToAccounting: form.scanSentToAccounting || false,
                loadingDate: form.loadingDate || '',
                unloadingDate: form.unloadingDate || '',
                totalCarryingCost: form.totalCarryingCost || 0,
                carrierUPD: form.carrierUPD || '',
                createdAt: editingShipment?.createdAt || new Date().toISOString(),
            };

            let updated;
            if (editingId) {
                updated = shipments.map(s => s.id === editingId ? newShipment : s);
            } else {
                updated = [...shipments, newShipment];
            }

            await updateDoc(doc(db, 'projects', project.id), {
                shipments: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const handleDelete = async () => {
        if (!editingId || !confirm('Удалить эту отгрузку?')) return;
        try {
            const updated = (project.shipments || []).filter(s => s.id !== editingId);
            await updateDoc(doc(db, 'projects', project.id), {
                shipments: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/shipments/${editingId}`);
        }
    };

    const inputClass = cn(
        "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
    );

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="fixed inset-0"
                style={{ backgroundColor: 'rgba(31,28,20,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-3xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden p-0 transition-colors"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex flex-col gap-1.5 shrink-0">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                            {editingId ? 'Редактировать отгрузку' : 'Новая отгрузка'}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 flex-1 overflow-y-auto flex flex-col gap-6 custom-scrollbar">
                    {/* Document Section — одна строка */}
                    <div className="space-y-3">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C]">ДОКУМЕНТЫ</h3>
                        <div className="flex flex-wrap items-end gap-3">
                            {/* Тоггер Акт/МХ-3 */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block">Тип</label>
                                <button
                                    type="button"
                                    onClick={() => setForm({ ...form, docType: form.docType === 'act' ? 'upd' : 'act' })}
                                    className="flex items-center gap-2 group focus:outline-none h-9 px-2"
                                >
                                    <div className={cn(
                                        "w-8 h-[18px] rounded-full p-0.5 transition-all duration-300 ease-in-out relative flex items-center cursor-pointer shrink-0",
                                        form.docType === 'act' ? "bg-[#A67C3C]" : "bg-[#F5F2E9] border border-line"
                                    )}>
                                        <motion.div
                                            layout
                                            className="w-3.5 h-3.5 rounded-full bg-white shadow-sm"
                                            animate={{ x: form.docType === 'act' ? 14 : 0 }}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        />
                                    </div>
                                    <span className={cn(
                                        "text-[10px] uppercase tracking-widest select-none transition-colors whitespace-nowrap",
                                        form.docType === 'act' ? "text-[#A67C3C]" : "text-[#8A8574]"
                                    )}>
                    Акт / МХ-3
                  </span>
                                </button>
                            </div>

                            {/* Входящий */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] whitespace-nowrap">
                                    Вх. {form.docType === 'upd' ? 'УПД' : 'Акт'}
                                </label>
                                <input
                                    value={form.incomingUPD || ''}
                                    onChange={e => setForm({...form, incomingUPD: e.target.value})}
                                    className={cn(inputClass, "w-28")}
                                    placeholder="Номер"
                                />
                            </div>

                            {/* Исходящий */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] whitespace-nowrap">
                                    Исх. {form.docType === 'upd' ? 'УПД' : 'МХ-3'}
                                </label>
                                <input
                                    value={form.outgoingUPD || ''}
                                    onChange={e => setForm({...form, outgoingUPD: e.target.value})}
                                    className={cn(inputClass, "w-28")}
                                    placeholder="Номер"
                                />
                            </div>

                            {/* Чекбокс Скан */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block">Скан</label>
                                <button
                                    type="button"
                                    title="Отправлен скан в бухгалтерию"
                                    onClick={() => setForm({ ...form, scanSentToAccounting: !form.scanSentToAccounting })}
                                    className="flex items-center gap-2 focus:outline-none cursor-pointer h-9 px-2"
                                >
                                    <div className={cn(
                                        "w-5 h-5 rounded border transition-all duration-200 flex items-center justify-center shrink-0",
                                        form.scanSentToAccounting
                                            ? "bg-[#7cb244] border-[#7cb244] text-white"
                                            : "bg-[#FDFBF7] border-[#A67C3C]/30 text-transparent"
                                    )}>
                                        <Check size={13} className="stroke-[3px]" />
                                    </div>
                                    <span className={cn(
                                        "text-[10px] uppercase tracking-widest select-none transition-colors",
                                        form.scanSentToAccounting ? "text-[#7cb244]" : "text-[#8A8574]"
                                    )}>
                    {form.scanSentToAccounting ? 'Да' : 'Нет'}
                  </span>
                                </button>
                            </div>
                        </div>

                        {/* Поле доверенности — часть блока документов */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">
                                Доверенность <span className="text-terracotta ml-1">*</span>
                            </label>
                            <select
                                value={form.poaNumber || ''}
                                onChange={e => {
                                    setForm({ ...form, poaNumber: e.target.value });
                                    setQuantityError(null);
                                }}
                                className={cn(inputClass, "appearance-none bg-surface pr-8 cursor-pointer", !form.poaNumber && quantityError && 'border-terracotta')}
                            >
                                <option value="">Выберите доверенность...</option>
                                {trustDeeds.map(deed => (
                                    <option key={deed.id} value={deed.number}>
                                        № {deed.number} от {formatDateToDisplay(deed.issueDate)} · {deed.driverName} · {deed.materialName}
                                    </option>
                                ))}
                            </select>
                            {!form.poaNumber && quantityError && (
                                <p className="mt-1.5 text-[11px] text-terracotta font-medium">{quantityError}</p>
                            )}
                        </div>
                    </div>

                    {/* Transport Section */}
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Перевозка</h3>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="w-full sm:w-[180px]">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Дата загрузки</label>
                                <DatePicker
                                    value={form.loadingDate || ''}
                                    onChange={v => setForm({...form, loadingDate: v})}
                                    variant="compact"
                                />
                            </div>
                            <div className="w-full sm:w-[180px]">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Дата выгрузки</label>
                                <DatePicker
                                    value={form.unloadingDate || ''}
                                    onChange={v => setForm({...form, unloadingDate: v})}
                                    variant="compact"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Cargo Section */}
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Груз</h3>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Номер а/м</label>
                                <input value={form.autoNumber || ''} readOnly disabled className={cn(inputClass, "opacity-75 bg-surface-2 cursor-not-allowed")} />
                            </div>
                            <div className="md:col-span-6">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Материал</label>
                                <input value={deedMaterial} readOnly className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")} placeholder="— из доверенности" />
                            </div>
                            <div className="md:col-span-4">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Количество</label>
                                <input value={selectedDeed ? deedQuantity.toLocaleString('ru-RU') : ''} readOnly className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")} placeholder="— из доверенности" />
                            </div>
                        </div>
                    </div>

                    {/* Costs Section */}
                    <div className="space-y-3">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Стоимость и документы перевозчика</h3>

                        {/* Строка 1: Перевозчик, Счёт, УПД */}
                        <div className="grid grid-cols-[1fr_160px_110px] gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Перевозчик</label>
                                <input
                                    value={selectedDeed ? deedCarrierName : ''}
                                    readOnly
                                    className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")}
                                    placeholder="— из доверенности"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Счёт</label>
                                <input
                                    value={selectedDeed ? deedCarrierInvoice : ''}
                                    readOnly
                                    className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")}
                                    placeholder="— из дов."
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">УПД</label>
                                <input
                                    value={form.carrierUPD || ''}
                                    onChange={e => setForm({...form, carrierUPD: e.target.value})}
                                    className={inputClass}
                                    placeholder="Номер"
                                />
                            </div>
                        </div>

                        {/* Строка 2: Стоимость, Стоимость общая */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Стоимость перевозки, ₽</label>
                                <input
                                    type="text"
                                    value={selectedDeed ? deedCarryingCost.toLocaleString('ru-RU') : ''}
                                    readOnly
                                    className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")}
                                    placeholder="— из доверенности"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Стоимость перевозки (общая), ₽</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={form.totalCarryingCost ? form.totalCarryingCost.toLocaleString('ru-RU') : ''}
                                    onChange={e => {
                                        const raw = e.target.value.replace(/\s/g, '').replace(/[^\d]/g, '');
                                        setForm({...form, totalCarryingCost: raw ? Number(raw) : undefined});
                                    }}
                                    className={inputClass}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-between items-center shrink-0 rounded-b-2xl">
                    <div>
                        {editingId && (
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 rounded-md text-[13px] font-semibold text-rose-500 border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500 hover:text-white transition-colors flex items-center gap-1.5"
                            >
                                <Trash2 size={14} /> Удалить
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors"
                        >
                            {editingId ? 'Сохранить изменения' : 'Добавить отгрузку'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>,
        document.body
    );
}

const SCAN_BADGE_BASE = 'inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-semibold uppercase whitespace-nowrap font-ui';

function getShipmentScanMeta(scan: Shipment['scanSentToAccounting']) {
    if (scan === true || scan === 'yes') {
        return {
            label: 'ОТПРАВЛЕН',
            badge: cn(SCAN_BADGE_BASE, 'tracking-[0.04em]'),
            badgeStyle: { backgroundColor: STATUS_BG.shipping, color: STATUS_COLOR.shipping },
        };
    }
    return {
        label: 'НЕТ',
        badge: cn(SCAN_BADGE_BASE, 'bg-[#f1d9cf] text-terracotta tracking-[0.12em]'),
    };
}

function getScanDisplayValue(scan: Shipment['scanSentToAccounting']) {
    if (scan === true || scan === 'yes') return 'Да';
    if (scan === false || scan === 'no') return 'Нет';
    return '—';
}

function ShipmentDetailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">
                {title}
            </h5>
            <div>{children}</div>
        </div>
    );
}

function ShipmentDetailField({
                                 label,
                                 value,
                                 showDivider = true,
                             }: {
    label: string;
    value?: React.ReactNode;
    showDivider?: boolean;
}) {
    return (
        <div className={cn('py-2', showDivider && 'border-b border-dashed border-[#E5E0D6]')}>
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#8A8574] mb-0.5 leading-tight">{label}</p>
            <div className="text-[12px] font-semibold text-[#2C2922] leading-tight">{value ?? '—'}</div>
        </div>
    );
}

function ShipmentDetailPanel({
                                 shipment,
                                 canEdit,
                                 onEdit,
                                 onDelete,
                                 onClose,
                                 trustDeeds = [],
                                 project,
                             }: {
    shipment: Shipment;
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onClose: () => void;
    trustDeeds?: TrustDeed[];
    project: Project;
}) {
    const machineLabel = shipment.autoNumber ? `Машина №${shipment.autoNumber}` : 'Отгрузка';
    const isUpd = shipment.docType === 'upd';
    const incomingDocLabel = isUpd ? 'Входящий УПД' : 'Входящий акт';
    const outgoingDocLabel = isUpd ? 'Исходящий УПД' : 'Исходящий МХ-3';

    // Resolve deed
    const deed = shipment.poaNumber ? trustDeeds.find(d => d.number === shipment.poaNumber) : null;
    const mat = deed ? project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName) : null;
    const materialLabel = mat
        ? `${mat.materialName}${(mat as any).supplierName ? ' ' + (mat as any).supplierName : ''}`
        : deed?.materialName || '';
    const carrierInvoiceLabel = deed?.accountNumber
        ? `Счёт №${deed.accountNumber}${(deed as any).accountDate ? ' от ' + formatDateToDisplay((deed as any).accountDate) : ''}`
        : '';

    return (
        <div className="flex flex-col max-h-[75vh] bg-[#FCF9F2]">
            <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-[#E8E4DC]">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] mb-0.5">Отгрузка</p>
                        <h4 className="font-serif text-[20px] font-normal text-[#2C2922] leading-[1.15] truncate">{machineLabel}</h4>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {canEdit && (
                            <>
                                <button type="button" onClick={onEdit} title="Редактировать" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><Pencil size={13} /></button>
                                <button type="button" onClick={onDelete} title="Удалить" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#A04930] hover:bg-[#F5E6E2] transition-colors"><Trash2 size={13} /></button>
                            </>
                        )}
                        <button type="button" onClick={onClose} title="Свернуть" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><X size={13} /></button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4">
                <ShipmentDetailSection title="Документы">
                    <ShipmentDetailField label={incomingDocLabel} value={shipment.incomingUPD} />
                    <ShipmentDetailField label="Отправлен скан в бухгалтерию" value={getScanDisplayValue(shipment.scanSentToAccounting)} />
                    <ShipmentDetailField label={outgoingDocLabel} value={shipment.outgoingUPD} />
                    <ShipmentDetailField label="Доверенность №" value={shipment.poaNumber} showDivider={false} />
                </ShipmentDetailSection>

                <ShipmentDetailSection title="Перевозка">
                    <ShipmentDetailField label="Дата загрузки" value={shipment.loadingDate ? formatDate(shipment.loadingDate) : undefined} />
                    <ShipmentDetailField label="Дата выгрузки" value={shipment.unloadingDate ? formatDate(shipment.unloadingDate) : undefined} />
                    <ShipmentDetailField label="Перевозчик" value={deed?.carrierName} />
                    <ShipmentDetailField label="Водитель" value={deed?.driverName} />
                    <ShipmentDetailField label="Стоимость перевозки" value={deed?.rate ? formatCurrency(deed.rate) : undefined} />
                    <ShipmentDetailField label="Стоимость перевозки (общая)" value={formatCurrency(shipment.totalCarryingCost || 0)} />
                    <ShipmentDetailField label="Счёт от перевозчика" value={carrierInvoiceLabel || undefined} />
                    <ShipmentDetailField label="УПД перевозчика" value={shipment.carrierUPD} showDivider={false} />
                </ShipmentDetailSection>

                <ShipmentDetailSection title="Груз">
                    <ShipmentDetailField label="Материал" value={materialLabel || undefined} />
                    <ShipmentDetailField label="Количество" value={deed?.quantity != null ? deed.quantity.toLocaleString('ru-RU') : undefined} showDivider={false} />
                </ShipmentDetailSection>
            </div>
        </div>
    );
}

function MaterialsTab({ project, canEdit, directories, trustDeeds = [] }: { project: Project, canEdit: boolean, directories: any, trustDeeds?: TrustDeed[] }) {
    const [isAddingMaterial, setIsAddingMaterial] = useState(false);
    const [isAddingShipment, setIsAddingShipment] = useState(false);
    const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
    const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
    const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
    const [migrationDone, setMigrationDone] = useState(false);

    const materials = project.materials || [];
    const shipments = project.shipments || [];
    const selectedShipment = shipments.find(s => s.id === selectedShipmentId) ?? null;
    const allMaterialShipped = useMemo(
        () => getShippingProgress(project, trustDeeds).isComplete,
        [project.materials, project.shipments]
    );

    // Миграция: удаляем отгрузки без привязки к доверенности
    useEffect(() => {
        if (migrationDone || !canEdit) return;
        const oldShipments = shipments.filter(s => !(s as any).trustDeedId);
        if (oldShipments.length === 0) { setMigrationDone(true); return; }
        const clean = shipments.filter(s => (s as any).trustDeedId);
        updateDoc(doc(db, 'projects', project.id), { shipments: clean, updatedAt: serverTimestamp() })
            .then(() => setMigrationDone(true))
            .catch(console.error);
    }, [project.id, canEdit]);

    useEffect(() => {
        setSelectedShipmentId(prev => {
            if (shipments.length === 0) return null;
            if (prev && shipments.some(s => s.id === prev)) return prev;
            return shipments[0].id;
        });
    }, [shipments]);

    const handleDeleteShipment = async (shipmentId: string) => {
        if (!confirm('Удалить эту отгрузку?')) return;
        try {
            const updated = shipments.filter(s => s.id !== shipmentId);
            await updateDoc(doc(db, 'projects', project.id), {
                shipments: updated,
                updatedAt: serverTimestamp(),
            });
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/shipments/${shipmentId}`);
        }
    };

    const handleExportToExcel = () => {
        exportShipmentsToExcel(shipments, project.name);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            {/* Materials Section */}
            <div className={cn(
                "rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
            )}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                    <div className="flex items-center gap-4">
                        <h3 className={cn("text-[14px] font-serif font-medium flex items-center gap-2", "text-ink")}>
                            Материалы по проекту
                            <span className="text-[11px] font-serif opacity-40">· {materials.length}</span>
                        </h3>
                    </div>
                    {materials.length > 0 && canEdit && (
                        <Button
                            variant="ochre"
                            size="sm"
                            className="h-8 px-2.5 text-[11.5px] font-semibold"
                            icon={<Plus size={12} />}
                            onClick={() => {
                                setEditingMaterialId(null);
                                setIsAddingMaterial(true);
                            }}
                        >
                            Добавить материал
                        </Button>
                    )}
                </div>

                <div className="p-4">
                    {materials.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {materials.map((m) => {
                                const contact = directories.contacts?.find((c: any) => c.id === m.supplierContactId) ||
                                    (m.supplierId ? directories.contacts?.find((c: any) => c.companyId === m.supplierId) : null);

                                return (
                                    <div
                                        key={m.id}
                                        className={cn(
                                            "p-4 rounded-xl transition-all group relative border bg-[#F5F2E9] border-transparent hover:bg-[#EBE5D6]"
                                        )}
                                    >
                                        <div className="flex justify-between items-start gap-2.5">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className={cn(
                                                    "w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0",
                                                    "bg-[#F3EAD4] text-[#A67C3C]"
                                                )}>
                                                    <Layers size={14.5} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h4 className={cn(
                                                        "font-bold text-[13.5px] leading-tight truncate",
                                                        "text-ink"
                                                    )}>
                                                        {m.materialName}
                                                    </h4>
                                                    <p className={cn(
                                                        "text-[11.5px] mt-0.5 tracking-wide font-medium truncate",
                                                        "text-[#8A8574]"
                                                    )}>
                                                        {m.quantity} {m.unitName}{m.deliveryMonth ? ` · поставка ${m.deliveryMonth.toLowerCase()}` : ''}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center shrink-0">
                                                {canEdit && <button
                                                    onClick={() => {
                                                        setEditingMaterialId(m.id);
                                                        setIsAddingMaterial(true);
                                                    }}
                                                    className={cn(
                                                        "p-1.5 rounded-full transition-colors",
                                                        "hover:bg-white/50 text-[#7A7564]"
                                                    )}
                                                    title="Редактировать"
                                                >
                                                    <Pencil size={12.5} />
                                                </button>}
                                            </div>
                                        </div>

                                        <div className={cn(
                                            "border-t border-dashed my-2.5",
                                            "border-[#DAD3C1]"
                                        )} />

                                        <div className="space-y-0.5">
                      <span className={cn(
                          "text-[9px] font-bold uppercase tracking-widest block",
                          "text-[#8A8574]"
                      )}>
                        ПОСТАВЩИК
                      </span>
                                            <p className={cn(
                                                "text-[12.5px] font-bold leading-tight",
                                                "text-ink"
                                            )}>
                                                {m.supplierName || 'Не указан'}
                                            </p>
                                            {contact && (
                                                <p className={cn(
                                                    "text-[11px] leading-normal font-medium truncate",
                                                    "text-[#7A7564]"
                                                )}>
                                                    {contact.name}{contact.phone ? `, ${contact.phone}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className={cn("py-7 px-5 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5", "border-line bg-transparent")}>
                            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", "bg-white border border-line text-ink-3 shadow-sm")}>
                                <Layers size={16} />
                            </div>
                            <div className="text-center space-y-0.5">
                                <p className={cn("text-[13px] font-serif font-medium", "text-ink")}>Материалы ещё не добавлены</p>
                                <p className={cn("text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60", "text-ink-4")}>Сначала добавьте материалы — потом по ним пойдут отгрузки</p>
                            </div>
                            <Button
                                variant="ochre"
                                size="sm"
                                className="mt-2 px-3 h-8 text-[11.5px] font-semibold"
                                icon={<Plus size={12} />}
                                onClick={() => {
                                    setEditingMaterialId(null);
                                    setIsAddingMaterial(true);
                                }}
                                style={{ display: canEdit ? undefined : 'none' }}
                            >
                                Добавить материал
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Shipments Section */}
            {shipments.length > 0 ? (
                <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 items-start">
                    {/* Table card — 2/3 width, height by content only */}
                    <div className={cn(
                        "lg:col-span-2 min-w-0 self-start rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden"
                    )}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3 shrink-0">
                            <h3 className={cn("text-[14px] font-serif font-medium flex items-center gap-2", "text-ink")}>
                                Отгрузки
                                <span className="text-[11px] font-serif opacity-40">· {shipments.length}</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="soft"
                                    size="sm"
                                    className="h-8 px-2.5 text-[11.5px] font-medium"
                                    icon={<Download size={12} />}
                                    onClick={handleExportToExcel}
                                >
                                    Экспорт в Excel
                                </Button>
                                {canEdit && (
                                    <span
                                        className="inline-flex"
                                        title={allMaterialShipped ? 'Весь материал отгружен' : undefined}
                                    >
                  <Button
                      variant="primary"
                      size="sm"
                      className="h-8 px-2.5 text-[11.5px] font-semibold"
                      icon={<Plus size={12} />}
                      disabled={allMaterialShipped}
                      onClick={() => {
                          if (allMaterialShipped) return;
                          setEditingShipmentId(null);
                          setIsAddingShipment(true);
                      }}
                  >
                    Новая отгрузка
                  </Button>
                </span>
                                )}
                            </div>
                        </div>

                        <div className="overflow-x-auto custom-scrollbar p-4 pt-2">
                            <table className="w-full text-left">
                                <thead>
                                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                                    <th className="px-4 py-3 font-bold">Тип / Номер</th>
                                    <th className="px-4 py-3 font-bold">Скан</th>
                                    <th className="px-4 py-3 font-bold">Материал / Кол-во</th>
                                    <th className="px-4 py-3 font-bold">Даты</th>
                                    <th className="px-4 py-3 font-bold">Перевозчик / Стоимость</th>
                                    <th className="w-8 px-2 py-3" aria-hidden />
                                </tr>
                                </thead>
                                <tbody>
                                {shipments.map((s) => {
                                    const isSelected = s.id === selectedShipmentId;
                                    const scan = getShipmentScanMeta(s.scanSentToAccounting);
                                    // Подтягиваем данные из доверенности
                                    const deed = s.poaNumber ? trustDeeds.find(d => d.number === s.poaNumber) : null;
                                    const mat = deed ? project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName) : null;
                                    const materialLabel = mat
                                        ? `${mat.materialName}${(mat as any).supplierName ? ' · ' + (mat as any).supplierName : ''}`
                                        : deed?.materialName || s.materialName || '—';
                                    const quantityLabel = deed?.quantity != null ? deed.quantity.toLocaleString('ru-RU') : (s.quantity || '—');
                                    const carrierLabel = deed?.carrierName || s.carrierName || '—';
                                    return (
                                        <tr
                                            key={s.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedShipmentId(s.id)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedShipmentId(s.id); } }}
                                            className={cn(
                                                "cursor-pointer transition-colors border-b border-[#E1D8C5]/60 last:border-b-0",
                                                isSelected
                                                    ? "bg-[#F5E9CC] shadow-[inset_3px_0_0_0_#B07A2C]"
                                                    : "hover:bg-[#F5F2E9]/80"
                                            )}
                                        >
                                            <td className="px-4 py-3.5 align-top">
                                                <div className="space-y-0.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-black/5 text-[#141414]/60">
                                {s.docType === 'upd' ? 'УПД' : 'АКТ'}
                              </span>
                                                        <span className="text-[12px] font-bold text-ink">{s.incomingUPD} / {s.outgoingUPD}</span>
                                                    </div>
                                                    <p className="text-[10px] text-ink-4 font-mono">Дов: {s.poaNumber || '—'}{s.poaDate ? ` от ${formatDateToDisplay(s.poaDate)}` : ''}</p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                          <span className={scan.badge} style={scan.badgeStyle}>
                            {scan.label}
                          </span>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                                                <p className="text-[12px] font-bold text-ink">{materialLabel}</p>
                                                <p className="text-[12px] font-mono font-semibold text-ink-3">{quantityLabel}</p>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                                                <p className="text-[12px] text-ink">{formatDate(s.loadingDate)}</p>
                                                <p className="text-[11px] text-ink-4">{formatDate(s.unloadingDate)}</p>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                                                <p className="text-[12px] font-bold text-ink">{carrierLabel}</p>
                                                <p className="text-[12px] font-mono font-semibold text-[#5a6b3c]">{formatCurrency(s.totalCarryingCost)}</p>
                                            </td>
                                            <td className="px-2 py-3.5 align-middle text-ink-4">
                                                <ChevronRight size={14} className={cn("transition-opacity", isSelected ? "opacity-80" : "opacity-30")} />
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Detail card */}
                    {selectedShipment && (
                        <div className={cn(
                            "w-full lg:col-span-1 self-start flex flex-col rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden"
                        )}>
                            <ShipmentDetailPanel
                                shipment={selectedShipment}
                                canEdit={canEdit}
                                onEdit={() => {
                                    setEditingShipmentId(selectedShipment.id);
                                    setIsAddingShipment(true);
                                }}
                                onDelete={() => handleDeleteShipment(selectedShipment.id)}
                                onClose={() => setSelectedShipmentId(null)}
                                trustDeeds={trustDeeds}
                                project={project}
                            />
                        </div>
                    )}
                </div>
            ) : (
                <div className={cn(
                    "rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden"
                )}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                        <h3 className={cn("text-[14px] font-serif font-medium flex items-center gap-2", "text-ink")}>
                            Отгрузки
                            <span className="text-[11px] font-serif opacity-40">· 0</span>
                        </h3>
                    </div>
                    <div className={cn("py-7 px-5 m-4 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5", "border-line bg-transparent")}>
                        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", "bg-white border border-line text-ink-3 shadow-sm")}>
                            <Truck size={16} />
                        </div>
                        <div className="text-center space-y-0.5">
                            <p className={cn("text-[13px] font-serif font-medium", "text-ink")}>Отгрузок пока нет</p>
                            <p className={cn("text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60", "text-ink-4")}>Машины и доверенности появятся здесь</p>
                        </div>
                        {canEdit && <Button
                            variant="ochre"
                            size="sm"
                            className="mt-2 px-3 h-8 text-[11.5px] font-semibold"
                            icon={<Plus size={12} />}
                            onClick={() => {
                                setEditingShipmentId(null);
                                setIsAddingShipment(true);
                            }}
                        >
                            Добавить отгрузку
                        </Button>}
                    </div>
                </div>
            )}

            <AnimatePresence>
                {isAddingMaterial && (
                    <MaterialModal
                        project={project}
                        editingId={editingMaterialId}
                        onClose={() => setIsAddingMaterial(false)}
                        directories={directories}
                    />
                )}
                {isAddingShipment && (
                    <ShipmentModal
                        project={project}
                        editingId={editingShipmentId}
                        onClose={() => setIsAddingShipment(false)}
                        directories={directories}
                        trustDeeds={trustDeeds}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function DirectorySelect({
                             value,
                             options,
                             onChange,
                             onAdd,
                             placeholder,
                             className,
                             iconType,
                             inputHeight = 'h-11'
                         }: {
    value: string,
    options: any[],
    onChange: (v: string) => void,
    onAdd?: (name: string) => Promise<void>,
    placeholder: string,
    className?: string,
    iconType?: 'carrier' | 'driver' | 'unit' | 'material',
    inputHeight?: string
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(value);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        setSearchTerm(value);
    }, [value]);

    useEffect(() => {
        const updateCoords = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setCoords({
                    top: rect.bottom + window.scrollY,
                    left: rect.left + window.scrollX,
                    width: rect.width
                });
            }
        };

        if (isOpen) {
            updateCoords();
            window.addEventListener('resize', updateCoords);
            window.addEventListener('scroll', updateCoords, true);
        }
        return () => {
            window.removeEventListener('resize', updateCoords);
            window.removeEventListener('scroll', updateCoords, true);
        };
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                containerRef.current && !containerRef.current.contains(target) &&
                (!dropdownRef.current || !dropdownRef.current.contains(target))
            ) {
                setIsOpen(false);
                setSearchTerm(value);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [value]);

    const filtered = options.filter(o =>
        (o.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const showCreate = onAdd && searchTerm.trim() !== '' &&
        !options.some(o => (o.name || '').toLowerCase() === searchTerm.toLowerCase().trim());

    const handleSelect = (name: string) => {
        onChange(name);
        setSearchTerm(name);
        setIsOpen(false);
    };

    const handleCreateNew = async () => {
        const name = searchTerm.trim();
        if (!name) return;
        setIsOpen(false);
        try {
            if (onAdd) {
                await onAdd(name);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        onChange(e.target.value);
        setIsOpen(true);
    };

    const getDropdownIcon = () => {
        switch (iconType) {
            case 'carrier':
                return <Truck size={13} />;
            case 'driver':
                return <UserIcon size={13} />;
            case 'material':
                return <Package size={13} />;
            default:
                return <Briefcase size={13} />;
        }
    };

    const hasLeftSearchIcon = iconType !== 'unit';

    return (
        <div className="relative w-full" ref={containerRef}>
            <div className="relative">
                {hasLeftSearchIcon && (
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                )}
                <input
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    className={cn(
                        "w-full bg-surface border border-line rounded-md text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 pr-9",
                        inputHeight,
                        hasLeftSearchIcon ? "pl-9" : "pl-3"
                    )}
                    placeholder={placeholder || "Начните вводить..."}
                />
                <ChevronDown size={14} className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none transition-transform", isOpen && "rotate-180")} />
            </div>

            {isOpen && createPortal(
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'absolute',
                        top: `${coords.top}px`,
                        left: `${coords.left}px`,
                        width: `${coords.width}px`,
                        zIndex: 999999
                    }}
                >
                    <AnimatePresence>
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="w-full rounded-md bg-surface border border-line shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] overflow-hidden mt-1.5"
                        >
                            <div className="max-h-[240px] overflow-y-auto no-scrollbar">
                                {filtered.length > 0 ? (
                                    filtered.map(opt => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => handleSelect(opt.name)}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                                        >
                                            {iconType !== 'unit' && (
                                                <span className="w-7 h-7 rounded-full bg-ochre-bg flex items-center justify-center text-ochre shrink-0">
                          {getDropdownIcon()}
                        </span>
                                            )}
                                            <span className="text-[13px] font-medium text-ink truncate">{opt.name}</span>
                                        </button>
                                    ))
                                ) : !showCreate ? (
                                    <p className="px-3 py-3 text-[12px] italic text-ink-4">Ничего не найдено</p>
                                ) : null}
                            </div>
                            {showCreate && onAdd && (
                                <button
                                    type="button"
                                    onClick={handleCreateNew}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-[12.5px] font-semibold text-ochre border-t border-line bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
                                >
                                    <Plus size={13} />
                                    Создать «{searchTerm.trim()}»
                                </button>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>,
                document.body
            )}
        </div>
    );
}

function EditField({
                       label,
                       value,
                       isEditing,
                       onChange,
                       icon,
                       type = "text",
                       placeholder = "не указано"
                   }: {
    label: string,
    value: string,
    isEditing: boolean,
    onChange: (v: string) => void,
    icon: React.ReactNode,
    type?: string,
    placeholder?: string
}) {
    return (
        <div className="grid items-start gap-3.5 py-3.5" style={{ gridTemplateColumns: '32px 1fr' }}>
            <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink-3 shrink-0">
                <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
            </div>
            <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">{label}</p>
                {isEditing ? (
                    type === 'date' ? (
                        <DatePicker value={value} onChange={onChange} className="w-full" variant="compact" />
                    ) : (
                        <input
                            type={type}
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[14px] text-ink focus:border-ochre focus:outline-none transition-colors"
                        />
                    )
                ) : (
                    value ? (
                        <p className="text-[14px] font-medium text-ink leading-snug">{value}</p>
                    ) : (
                        <p className="text-[14px] italic text-ink-4 leading-snug">{placeholder}</p>
                    )
                )}
            </div>
        </div>
    );
}

function StakeholderCard({ title, data, onEdit, canEdit }: { title: string, data?: StakeholderGroup, onEdit: () => void, canEdit: boolean }) {
    const [contacts, setContacts] = useState<Contact[]>([]);

    useEffect(() => {
        if (data?.contactIds?.length) {
            const q = query(collection(db, 'contacts'), where('__name__', 'in', data.contactIds));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
            });
            return () => unsubscribe();
        } else {
            setContacts([]);
        }
    }, [data?.contactIds]);

    const iconNode = title === 'Заказчик' ? <UserIcon size={14} />
        : title === 'Генподрядчик' ? <Briefcase size={14} />
            : title === 'Подрядчик' ? <Users size={14} />
                : <Edit3 size={14} />;

    return (
        <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden group">
            <div className="px-5 py-3.5 flex items-center justify-between gap-2 border-b border-line">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-ochre-bg flex items-center justify-center text-ochre shrink-0">
                        {iconNode}
                    </div>
                    <h3 className="font-display text-[15px] font-medium text-ink leading-tight">{title}</h3>
                </div>
                {canEdit && (
                    <button
                        onClick={onEdit}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                        <Edit3 size={13} />
                    </button>
                )}
            </div>

            <div className="px-5 py-4 flex flex-col gap-3.5">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Компания</p>
                    {data?.companyName ? (
                        <p className="text-[13px] font-semibold text-ink">{data.companyName}</p>
                    ) : (
                        <p className="text-[12px] italic text-ink-4">не указана</p>
                    )}
                </div>

                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Контактные лица</p>
                    {contacts.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            {contacts.map(contact => (
                                <div key={contact.id} className="flex items-center gap-2.5 px-2.5 py-2 bg-surface-2 rounded-md">
                  <span className="w-6 h-6 rounded-full bg-surface flex items-center justify-center text-ink-3 shrink-0">
                    <UserIcon size={12} />
                  </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12.5px] font-semibold text-ink truncate leading-tight">{contact.name}</p>
                                        <p className="text-[11px] text-ink-3 truncate mt-0.5">
                                            {contact.position}{contact.position && contact.phone && ' · '}{contact.phone && <span className="tabular-nums">{contact.phone}</span>}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11.5px] italic text-ink-4">не добавлены</p>
                    )}
                </div>
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

function StakeholderEditForm({ projectId, role, currentData, onClose }: { projectId: string, role: string, currentData?: StakeholderGroup, onClose: () => void }) {
    const [companyName, setCompanyName] = useState(currentData?.companyName || '');
    const [companyId, setCompanyId] = useState(currentData?.companyId || '');
    const [selectedContactIds, setSelectedContactIds] = useState<string[]>(currentData?.contactIds || []);
    const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);
    const [showAddContact, setShowAddContact] = useState(false);
    const [newContact, setNewContact] = useState({ name: '', position: '', phone: '' });
    const [isChangingCompany, setIsChangingCompany] = useState(false);

    useEffect(() => {
        if (companyId) {
            const q = query(collection(db, 'contacts'), where('companyId', '==', companyId));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setAvailableContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
            });
            return () => unsubscribe();
        } else {
            setAvailableContacts([]);
        }
    }, [companyId]);

    const handleCompanyChange = async (name: string, id?: string) => {
        setCompanyName(name);
        setCompanyId(id || '');
        setSelectedContactIds([]);
        setShowAddContact(false);
    };

    const handleCreateContact = async () => {
        if (!companyId || !newContact.name) return;
        try {
            const docRef = await addDoc(collection(db, 'contacts'), {
                companyId,
                ...newContact,
                createdAt: serverTimestamp()
            });
            setSelectedContactIds([...selectedContactIds, docRef.id]);
            setNewContact({ name: '', position: '', phone: '' });
            setShowAddContact(false);
        } catch (error) {
            console.error(error);
        }
    };

    const roleToCompanyType = (r: string): string => {
        switch (r) {
            case 'client':              return 'Заказчик';
            case 'generalContractor':   return 'Генподрядчик';
            case 'subcontractor':       return 'Подрядчик';
            case 'architect':           return 'Архитектор';
            default:                    return '';
        }
    };

    const handleSave = async () => {
        try {
            let finalCompanyId = companyId;
            if (!finalCompanyId && companyName) {
                const companyRef = await addDoc(collection(db, 'companies'), {
                    name: companyName,
                    companyType: roleToCompanyType(role),
                    managerId: auth.currentUser?.uid,
                    createdAt: serverTimestamp()
                });
                finalCompanyId = companyRef.id;
            }
            const updates: any = {
                [`stakeholders.${role}`]: {
                    companyId: finalCompanyId,
                    companyName,
                    contactIds: selectedContactIds
                },
                updatedAt: serverTimestamp()
            };
            if (role === 'client') {
                updates.client = companyName;
            }
            await updateDoc(doc(db, 'projects', projectId), updates);
            onClose();
        } catch (error) {
            console.error(error);
        }
    };

    const roleLabel =
        role === 'generalContractor' ? 'Генподрядчик' :
            role === 'subcontractor' ? 'Подрядчик' :
                role === 'architect' ? 'Архитектор' : 'Заказчик';

    const isContactFormOpen = showAddContact || (Boolean(companyId) && availableContacts.length === 0);

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0"
                style={{ backgroundColor: 'rgba(31,28,20,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
            />

            {/* Dialog */}
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="relative w-full max-w-[560px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col max-h-[90vh] overflow-hidden"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
                    <h2 className="font-display text-[20px] font-medium text-ink leading-tight">
                        Редактировать: {roleLabel}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 flex-1 overflow-y-auto flex flex-col gap-5">
                    {/* Компания */}
                    <div>
                        <label className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 block mb-2">
                            Компания
                        </label>
                        {companyId && !isChangingCompany ? (
                            <div className="flex items-center justify-between gap-3 bg-surface border border-line rounded-md px-3 py-2.5">
                                <span className="text-[13px] font-semibold text-ink truncate">{companyName}</span>
                                <button
                                    onClick={() => {
                                        setCompanyName('');
                                        setCompanyId('');
                                        setSelectedContactIds([]);
                                        setShowAddContact(false);
                                        setIsChangingCompany(true);
                                    }}
                                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                                >
                                    Сменить
                                </button>
                            </div>
                        ) : (
                            <CompanySelect
                                value={companyName}
                                onChange={(name, id) => {
                                    handleCompanyChange(name, id);
                                    setIsChangingCompany(false);
                                }}
                                placeholder="Поиск по справочнику..."
                                companyType={roleToCompanyType(role)}
                            />
                        )}
                    </div>

                    {/* Контактные лица */}
                    <div>
                        <div className="flex items-center justify-between mb-2.5">
                            <label className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                                Контактные лица
                            </label>
                            {companyId && !isContactFormOpen && (
                                <button
                                    onClick={() => setShowAddContact(true)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                                >
                                    <Plus size={12} /> Добавить
                                </button>
                            )}
                        </div>

                        {/* Список выбранных контактов компании */}
                        {availableContacts.length > 0 && (
                            <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
                                {availableContacts.map(contact => {
                                    const selected = selectedContactIds.includes(contact.id);
                                    return (
                                        <div
                                            key={contact.id}
                                            className={cn(
                                                "flex items-center gap-2.5 px-3 py-2.5 rounded-md border transition-colors group",
                                                selected
                                                    ? "bg-ochre-bg border-[var(--ochre-soft)]"
                                                    : "bg-surface-2 border-transparent hover:bg-surface hover:border-line"
                                            )}
                                        >
                                            <button
                                                onClick={() => {
                                                    setSelectedContactIds(
                                                        selected
                                                            ? selectedContactIds.filter(id => id !== contact.id)
                                                            : [...selectedContactIds, contact.id]
                                                    );
                                                }}
                                                className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                                            >
                        <span className="w-7 h-7 rounded-full bg-surface border border-line flex items-center justify-center text-ink-3 shrink-0">
                          <UserIcon size={13} />
                        </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-semibold text-ink truncate leading-tight">{contact.name}</p>
                                                    {(contact.position || contact.phone) && (
                                                        <p className="text-[11px] text-ink-3 truncate mt-0.5">
                                                            {contact.position}
                                                            {contact.position && contact.phone && ' · '}
                                                            {contact.phone && <span className="tabular-nums">{contact.phone}</span>}
                                                        </p>
                                                    )}
                                                </div>
                                            </button>
                                            {selected && (
                                                <CheckCircle2 size={14} className="text-ochre shrink-0" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Форма «Новый контакт» */}
                        {isContactFormOpen && (
                            <div className={cn(
                                "p-4 rounded-md bg-[var(--ochre-bg)] border border-[var(--ochre-soft)] flex flex-col gap-2.5",
                                availableContacts.length > 0 && "mt-3"
                            )}>
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ochre)]">
                                    {availableContacts.length === 0
                                        ? `Первый контакт для ${companyName || 'компании'}`
                                        : `Новый контакт для ${companyName}`}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        placeholder="ФИО"
                                        value={newContact.name}
                                        onChange={e => setNewContact({...newContact, name: e.target.value})}
                                        className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
                                    />
                                    <input
                                        placeholder="Должность"
                                        value={newContact.position}
                                        onChange={e => setNewContact({...newContact, position: e.target.value})}
                                        className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
                                    />
                                    <input
                                        placeholder="Телефон"
                                        value={newContact.phone}
                                        onChange={e => setNewContact({...newContact, phone: e.target.value})}
                                        className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 col-span-2"
                                    />
                                </div>
                                <div className="flex gap-2 mt-1">
                                    <button
                                        type="button"
                                        onClick={handleCreateContact}
                                        disabled={!newContact.name || !companyId}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--ochre)] text-[var(--bg-elev)] hover:brightness-95 transition-[filter,background] disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Сохранить контакт
                                    </button>
                                    {availableContacts.length > 0 && (
                                        <button
                                            onClick={() => { setShowAddContact(false); setNewContact({ name: '', position: '', phone: '' }); }}
                                            className="px-3 py-1.5 rounded-md text-[12px] font-medium text-ink-2 hover:bg-surface transition-colors"
                                        >
                                            Отмена
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {!companyId && (
                            <p className="text-[11.5px] italic text-ink-4 mt-1">
                                Сначала выберите компанию, затем сможете добавить контакты.
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-end gap-2 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors"
                    >
                        Сохранить изменения
                    </button>
                </div>
            </motion.div>
        </div>,
        document.body
    );
}

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
                    subtitle="Для просмотра вкладки «Финансы и бонусы» введите код доступа"
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
                        <Cell key={entry.name} fill={getExpenseCategoryColor(entry.name, index)} />
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

/** Стили карточек как SummaryCard на дашборде */
const DASHBOARD_CARD_LABEL = 'text-[10.5px] font-semibold uppercase tracking-[0.14em]';
const DASHBOARD_CARD_VALUE = 'font-display text-[34px] leading-[1.05] tabular-nums';
const DASHBOARD_CARD_UNIT = 'font-display text-[14px] opacity-70';
const DASHBOARD_CARD_SUB = 'text-[11.5px] text-ink-3 mt-0.5';

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


const TASK_CARD_CLASS =
    'rounded-2xl border bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden';
const TASK_LABEL_CLASS =
    'text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5';

function parseTaskDate(dateVal: ProjectTask['date'] | unknown): Date | null {
    if (dateVal == null || dateVal === '') return null;
    if (
        typeof dateVal === 'object' &&
        'toDate' in dateVal &&
        typeof (dateVal as { toDate: () => Date }).toDate === 'function'
    ) {
        return (dateVal as { toDate: () => Date }).toDate();
    }
    const d = new Date(String(dateVal));
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Метка времени для сортировки: дата + время; без даты — в конец списка */
function getTaskSortTimestamp(task: ProjectTask): number {
    const d = parseTaskDate(task.date);
    if (!d) return Number.MAX_SAFE_INTEGER;
    const time = task.time?.trim();
    if (time && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
        const [h, m] = time.split(':').map(Number);
        d.setHours(h, m, 0, 0);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d.getTime();
}

function compareTasksBySchedule(a: ProjectTask, b: ProjectTask): number {
    const dateDiff = getTaskSortTimestamp(a) - getTaskSortTimestamp(b);
    if (dateDiff !== 0) return dateDiff;
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.id.localeCompare(b.id);
}

function sortTasksForDisplay(list: ProjectTask[]): ProjectTask[] {
    return [...list].sort(compareTasksBySchedule);
}

function CalendarReconnectBanner({
                                     onConnect,
                                     detail,
                                     isConnecting,
                                 }: {
    onConnect: () => void | Promise<void>;
    detail?: string | null;
    isConnecting?: boolean;
}) {
    return (
        <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Синхронизация с Google Календарём отключена</p>
                <p className="text-[12px] text-ink-3 mt-1 leading-snug">
                    {detail ||
                        'Подключите календарь — задачи с датой будут автоматически появляться в Google Calendar.'}
                </p>
            </div>
            <button
                type="button"
                onClick={onConnect}
                disabled={isConnecting}
                className="shrink-0 h-9 px-4 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
                {isConnecting ? 'Подключение…' : 'Подключить Google Календарь'}
            </button>
        </div>
    );
}

function ActivityTab({ tasks, projectId, canEdit, project, accessToken, onConnectCalendar, onClearCalendarToken }: { tasks: ProjectTask[], projectId: string, canEdit: boolean, project: Project | null, accessToken?: string | null, onConnectCalendar?: () => Promise<boolean>, onClearCalendarToken?: () => void }) {
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskDate, setNewTaskDate] = useState('');
    const [newTaskTime, setNewTaskTime] = useState('');

    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editingTaskData, setEditingTaskData] = useState<Partial<ProjectTask>>({});
    const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);
    const [calendarNeedsReconnect, setCalendarNeedsReconnect] = useState(() => !accessToken);
    const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
    const [completedTasksExpanded, setCompletedTasksExpanded] = useState(false);

    const handleConnectCalendar = async () => {
        if (!onConnectCalendar || isConnectingCalendar) return;
        setIsConnectingCalendar(true);
        try {
            const ok = await onConnectCalendar();
            if (ok) {
                setCalendarNeedsReconnect(false);
                setCalendarSyncError(null);
            }
        } finally {
            setIsConnectingCalendar(false);
        }
    };

    const markCalendarDisconnected = (detail: string, calError?: unknown) => {
        setCalendarNeedsReconnect(true);
        setCalendarSyncError(detail);
        if (!calError || isCalendarAuthError(calError)) onClearCalendarToken?.();
    };

    useEffect(() => {
        if (!accessToken) {
            setCalendarNeedsReconnect(true);
            return;
        }

        let cancelled = false;
        verifyCalendarAccess(accessToken).then(({ valid, unauthorized }) => {
            if (cancelled) return;
            if (!valid) {
                setCalendarNeedsReconnect(true);
                if (unauthorized) {
                    setCalendarSyncError('Доступ к Google Календарю недействителен. Подключите календарь снова.');
                    onClearCalendarToken?.();
                } else {
                    setCalendarSyncError('Не удалось проверить календарь. Проверьте интернет.');
                }
            } else {
                setCalendarNeedsReconnect(false);
                setCalendarSyncError(null);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [accessToken, onClearCalendarToken]);

    const showCalendarBanner = calendarNeedsReconnect && Boolean(onConnectCalendar);

    const handleUpdateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTaskId || !canEdit) return;
        setCalendarSyncError(null);
        try {
            await updateDoc(doc(db, 'projects', projectId, 'tasks', editingTaskId), {
                ...editingTaskData,
                updatedAt: serverTimestamp()
            });

            if (accessToken && project && editingTaskData.date) {
                try {
                    await createCalendarEvent(accessToken, project, {
                        ...editingTaskData,
                        id: editingTaskId
                    });
                } catch (calError: unknown) {
                    const message = calError instanceof Error ? calError.message : 'Ошибка календаря';
                    markCalendarDisconnected(
                        isCalendarAuthError(calError)
                            ? 'Доступ к Google Календарю истёк. Подключите календарь снова.'
                            : `Не удалось обновить календарь: ${message}`,
                        calError
                    );
                    console.error('Calendar sync error:', calError);
                }
            }

            setEditingTaskId(null);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks/${editingTaskId}`);
        }
    };

    const toggleTask = async (task: ProjectTask) => {
        if (!canEdit) return;
        try {
            await updateDoc(doc(db, 'projects', projectId, 'tasks', task.id), {
                completed: !task.completed
            });
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks/${task.id}`);
        }
    };

    const deleteTask = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!canEdit) return;
        try {
            await deleteDoc(doc(db, 'projects', projectId, 'tasks', id));
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/tasks/${id}`);
        }
    };

    const addTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle || !canEdit) return;
        setCalendarSyncError(null);
        try {
            const taskData: Partial<ProjectTask> & { projectId: string; createdAt: ReturnType<typeof serverTimestamp>; order: number } = {
                projectId,
                title: newTaskTitle,
                description: '',
                date: newTaskDate || undefined,
                time: newTaskTime || undefined,
                completed: false,
                type: 'task',
                createdAt: serverTimestamp(),
                order: tasks.length,
            };

            await addDoc(collection(db, 'projects', projectId, 'tasks'), taskData);

            if (accessToken && project && newTaskDate) {
                try {
                    await createCalendarEvent(accessToken, project, taskData);
                    setCalendarNeedsReconnect(false);
                    setCalendarSyncError(null);
                } catch (calError: unknown) {
                    const message = calError instanceof Error ? calError.message : 'Ошибка календаря';
                    console.error('Calendar sync failed', calError);
                    markCalendarDisconnected(
                        isCalendarAuthError(calError)
                            ? 'Задача сохранена в CRM, но доступ к Google Календарю истёк. Подключите календарь снова.'
                            : `Задача сохранена в CRM, но не попала в календарь: ${message}`,
                        calError
                    );
                }
            } else if (newTaskDate && !accessToken) {
                markCalendarDisconnected(
                    'Задача сохранена в CRM. Подключите Google Календарь, чтобы она попала в календарь.'
                );
            }

            setNewTaskTitle('');
            setNewTaskDate('');
            setNewTaskTime('');
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks`);
        }
    };

    const activeTasks = useMemo(
        () => sortTasksForDisplay(tasks.filter((t) => !t.completed)),
        [tasks]
    );

    const completedTasks = useMemo(
        () => sortTasksForDisplay(tasks.filter((t) => t.completed)),
        [tasks]
    );

    const renderTaskList = (list: ProjectTask[], emptyLabel: string) => (
        <div className="divide-y divide-[#E5E0D6]">
            {list.map((task) => (
                <TaskItem
                    key={task.id}
                    task={task}
                    canEdit={canEdit}
                    onToggle={toggleTask}
                    onDelete={deleteTask}
                    onBeginEdit={(t) => {
                        setEditingTaskId(t.id);
                        setEditingTaskData({ title: t.title, date: t.date, time: t.time });
                    }}
                    isEditing={editingTaskId === task.id}
                    editingData={editingTaskData}
                    onEditDataChange={setEditingTaskData}
                    onSaveEdit={handleUpdateTask}
                    onCancelEdit={() => setEditingTaskId(null)}
                />
            ))}
            {list.length === 0 && (
                <div className="px-4 py-10 text-center text-[11px] text-ink-3">
                    {emptyLabel}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            {showCalendarBanner && onConnectCalendar && (
                <CalendarReconnectBanner
                    onConnect={handleConnectCalendar}
                    detail={calendarSyncError}
                    isConnecting={isConnectingCalendar}
                />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
                {/* Форма добавления — 2/5 */}
                <div className={cn(TASK_CARD_CLASS, 'p-5 lg:col-span-2')}>
                    <h3 className="text-[15px] font-serif font-medium text-ink mb-4">Добавить задачу</h3>

                    <form onSubmit={addTask} className="space-y-4">
                        <div>
                            <label className={TASK_LABEL_CLASS}>Что нужно сделать?</label>
                            <textarea
                                value={newTaskTitle}
                                onChange={(e) => setNewTaskTitle(e.target.value)}
                                placeholder="Напр. Отправить КП заказчику"
                                rows={3}
                                disabled={!canEdit}
                                className="w-full min-h-[88px] bg-[#F5F2E9] border border-transparent rounded-lg px-3.5 py-3 text-[13px] font-medium text-ink placeholder:text-ink-4 focus:border-ochre/50 focus:outline-none transition-colors resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={TASK_LABEL_CLASS}>Дата</label>
                                <DatePicker
                                    value={newTaskDate}
                                    onChange={setNewTaskDate}
                                    placeholder="дд.мм.гггг"
                                    variant="compact"
                                />
                            </div>
                            <div>
                                <label className={TASK_LABEL_CLASS}>Время</label>
                                <TimeInput
                                    value={newTaskTime}
                                    onChange={setNewTaskTime}
                                    placeholder="--:--"
                                    variant="compact"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={!newTaskTitle.trim() || !canEdit}
                            className="w-full h-10 rounded-lg text-[12.5px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 active:scale-[0.99]"
                        >
                            <Plus size={15} strokeWidth={2.5} />
                            Добавить задачу
                        </button>

                        <p className="text-[11px] leading-relaxed text-[#8A8574]">
                            Часть задач подгружается автоматически при создании проекта — даты можно проставить позже.
                        </p>
                    </form>
                </div>

                {/* Списки задач — 3/5 */}
                <div className="flex flex-col gap-4 min-w-0 lg:col-span-3">
                    <div className={TASK_CARD_CLASS}>
                        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[#E5E0D6]">
                            <span className="text-[14px] font-serif font-medium text-ink">Задачи</span>
                            <span className="text-[12px] text-ink-3 tabular-nums">· {activeTasks.length}</span>
                        </div>
                        {renderTaskList(activeTasks, 'Нет активных задач')}
                    </div>

                    {completedTasks.length > 0 && (
                        <div className={TASK_CARD_CLASS}>
                            <button
                                type="button"
                                onClick={() => setCompletedTasksExpanded((v) => !v)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E5E0D6] text-left hover:bg-[#F5F2E9]/60 transition-colors"
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[14px] font-serif font-medium text-ink">Завершенные задачи</span>
                                    <span className="text-[12px] text-ink-3 tabular-nums">· {completedTasks.length}</span>
                                </div>
                                <ChevronDown
                                    size={16}
                                    className={cn(
                                        'text-ink-3 shrink-0 transition-transform duration-200',
                                        completedTasksExpanded && 'rotate-180'
                                    )}
                                />
                            </button>
                            {completedTasksExpanded && renderTaskList(completedTasks, '')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function TaskItem({
                      task,
                      canEdit,
                      onToggle,
                      onDelete,
                      onBeginEdit,
                      isEditing,
                      editingData,
                      onEditDataChange,
                      onSaveEdit,
                      onCancelEdit
                  }: {
    task: ProjectTask,
    canEdit: boolean,
    onToggle: (t: ProjectTask) => Promise<void> | void,
    onDelete: (e: React.MouseEvent, id: string) => Promise<void> | void,
    onBeginEdit?: (t: ProjectTask) => void,
    isEditing?: boolean,
    editingData?: Partial<ProjectTask>,
    onEditDataChange?: (d: Partial<ProjectTask>) => void,
    onSaveEdit?: (e: React.FormEvent) => Promise<void> | void,
    onCancelEdit?: () => void,
    key?: string | number
}) {
    const d = parseTaskDate(task.date);
    const day = d ? d.toLocaleDateString('ru-RU', { day: '2-digit' }) : '';
    const month = d
        ? d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '').toUpperCase()
        : '';
    const timeLabel = task.time || (d ? '—' : '');

    if (isEditing && onEditDataChange && onSaveEdit && onCancelEdit) {
        return (
            <div className="px-4 py-4 space-y-3 bg-[#FBF8F2]">
        <textarea
            value={editingData?.title || ''}
            onChange={(e) => onEditDataChange({ ...editingData, title: e.target.value })}
            rows={2}
            className="w-full bg-[#F5F2E9] border border-transparent rounded-lg px-3.5 py-2.5 text-[13px] font-medium text-ink focus:border-ochre/50 focus:outline-none resize-none"
        />
                <div className="grid grid-cols-2 gap-3">
                    <DatePicker
                        value={editingData?.date || ''}
                        onChange={(v) => onEditDataChange({ ...editingData, date: v })}
                        variant="compact"
                    />
                    <TimeInput
                        value={editingData?.time || ''}
                        onChange={(v) => onEditDataChange({ ...editingData, time: v })}
                        variant="compact"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onSaveEdit}
                        className="flex-1 h-9 rounded-lg text-[11px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] transition-colors"
                    >
                        Сохранить
                    </button>
                    <button
                        type="button"
                        onClick={onCancelEdit}
                        className="px-4 h-9 rounded-lg text-[11px] font-semibold bg-surface-2 text-ink-3 hover:text-ink transition-colors"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            id={`task-${task.id}`}
            className={cn(
                'px-4 py-3.5 flex items-center gap-3 group transition-colors',
                task.completed ? 'bg-[#FAFAF7]/60' : 'hover:bg-[#F5F2E9]/50'
            )}
        >
            <button
                type="button"
                onClick={() => onToggle(task)}
                disabled={!canEdit}
                className={cn(
                    'w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-all shrink-0',
                    task.completed
                        ? 'bg-[#4fb47c] border-[#4fb47c]'
                        : 'border-[#C8C0AE] bg-white hover:border-[#A67C3C]'
                )}
            >
                {task.completed && <Check size={11} className="text-white stroke-[3px]" />}
            </button>

            <div className="w-[52px] flex flex-col items-center shrink-0 text-center leading-none">
                {task.date ? (
                    <>
            <span
                className={cn(
                    'text-[15px] font-semibold tabular-nums',
                    task.completed ? 'text-ink-3' : 'text-ink'
                )}
            >
              {day}
            </span>
                        <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-ink-3 mt-0.5">
              {month}
            </span>
                        {timeLabel && (
                            <span className="text-[10px] text-ink-3 mt-1 tabular-nums">{timeLabel}</span>
                        )}
                    </>
                ) : (
                    <Clock size={15} className="text-ink-4/50 mt-1" strokeWidth={1.75} />
                )}
            </div>

            <div className="flex-1 min-w-0 py-0.5">
                <p
                    className={cn(
                        'text-[13px] font-medium leading-snug',
                        task.completed ? 'text-ink-3 line-through' : 'text-ink'
                    )}
                >
                    {task.title}
                </p>
                {!task.date && (
                    <p className="text-[10px] text-ink-3 mt-0.5">без даты</p>
                )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
                {canEdit && onBeginEdit && (
                    <button
                        type="button"
                        onClick={() => onBeginEdit(task)}
                        className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-black/[0.04] transition-colors"
                        title="Редактировать"
                    >
                        <Pencil size={13} strokeWidth={1.75} />
                    </button>
                )}
                {canEdit && (
                    <button
                        type="button"
                        onClick={(e) => onDelete(e, task.id)}
                        className="p-1.5 rounded-md text-ink-3 hover:text-terracotta hover:bg-terracotta/5 transition-colors"
                        title="Удалить"
                    >
                        <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                )}
            </div>
        </div>
    );
}


function TrustDeedsTab({ project, canEdit, directories, trustDeeds }: { project: Project, canEdit: boolean, directories: any, trustDeeds: TrustDeed[] }) {
    const [selectedDeedId, setSelectedDeedId] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<TrustDeed>>({});

    const selectedDeed = trustDeeds.find(d => d.id === selectedDeedId);

    const handleGenerateDeed = async (deed: TrustDeed) => {
        const mat = project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName);
        const materialSupplier = (mat as any)?.supplierName || deed.supplierName || '';

        const data: TrustDeedDocxData = {
            number: deed.number,
            issueDate: formatDateToDisplay(deed.issueDate),
            expiryDate: formatDateToDisplay(deed.expiryDate),
            organization: 'ООО "АРХИХАБ", ИНН 1655466404, КПП 165501001, 420021, Республика Татарстан, г. Казань, ул. Николая Столбова, д. 1/3, пом. 1014',
            driverName: deed.driverName || '',
            driverPosition: '',
            driverPassportSeries: deed.driverPassportSeries || '',
            driverPassportNumber: deed.driverPassportNumber || '',
            driverPassportIssuedBy: (deed as any).driverPassportIssuedBy || '',
            driverPassportIssuedDate: formatDateToDisplay((deed as any).driverPassportIssuedDate),
            supplierName: materialSupplier,
            accountNumber: deed.accountNumber || '',
            accountDate: formatDateToDisplay((deed as any).accountDate),
            bankAccount: '',
            bankName: '',
            materialName: deed.materialName || '',
            materialUnit: 'Шт.',
            quantity: String(deed.quantity || ''),
            quantityText: '',
            headName: 'Аухадуллина Д.Н.',
            chiefAccountantName: 'Аухадуллина Д.Н.',
        };

        // Формируем имя файла: номер_Поставщик_ставка_Фамилия_Перевозчик
        const stripAbbr = (name: string) =>
            name.replace(/^(ООО|ОАО|ЗАО|АО|ИП|НКО|ПАО)\s+["«»"']?/i, '').replace(/["«»"']/g, '').trim();
        const supplier = stripAbbr(materialSupplier);
        const rateK = deed.rate ? Math.floor(deed.rate / 1000) : 0;
        const driverLastName = (deed.driverName || '').split(' ')[0] || '';
        const carrier = stripAbbr(deed.carrierName || '');
        const filename = `${deed.number}_${supplier}_${rateK}_${driverLastName}_${carrier}.docx`
            .replace(/\s+/g, '_').replace(/[/\\:*?"<>|]/g, '');

        try {
            const blob = await generateTrustDeedDocx(data);
            downloadBlob(blob, filename);
        } catch (e) {
            console.error('Ошибка генерации документа:', e);
        }
    };

    const allTrustDeeds: any[] = [];

    const getNextNumber = () => {
        if (allTrustDeeds.length === 0 && trustDeeds.length === 0) return "1";
        const all = [...allTrustDeeds, ...trustDeeds];
        return (Math.max(...all.map(d => parseInt(d.number) || 0)) + 1).toString();
    };

    const addExpiryWeek = (issueDate: string) => {
        if (!issueDate) return '';
        const d = new Date(issueDate);
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
    };

    const handleAdd = () => {
        if (!canEdit) return;
        const issueDate = new Date().toISOString().split('T')[0];
        setFormData({
            number: getNextNumber(),
            issueDate,
            expiryDate: addExpiryWeek(issueDate),
            supplierId: '', supplierName: '',
            carrierId: '', carrierName: '',
            accountNumber: '', accountDate: '',
            rate: 0,
            driverId: '', driverName: '',
            driverPassportSeries: '', driverPassportNumber: '',
            driverPassportIssuedBy: '', driverPassportIssuedDate: '',
            materialId: '', materialName: '',
            quantity: 0,
        });
        setIsAdding(true);
        setIsEditing(false);
    };

    const handleEdit = (deed: TrustDeed) => {
        setFormData(deed);
        setIsAdding(true);
        setIsEditing(true);
    };

    const handleSave = async () => {
        if (!canEdit) return;
        const path = isEditing && formData.id
            ? `projects/${project.id}/trust_deeds/${formData.id}`
            : `projects/${project.id}/trust_deeds`;
        try {
            // ── Синхронизация водителя со справочником ────────────────────────────
            let driverId = formData.driverId || '';
            const driverPayload: any = {};
            if (formData.driverPassportSeries)     driverPayload.passportSeries     = formData.driverPassportSeries;
            if (formData.driverPassportNumber)     driverPayload.passportNumber     = formData.driverPassportNumber;
            if (formData.driverPassportIssuedBy)   driverPayload.passportIssuedBy   = formData.driverPassportIssuedBy;
            if (formData.driverPassportIssuedDate) driverPayload.passportIssuedDate = formData.driverPassportIssuedDate;
            if ((formData as any).driverPhone)     driverPayload.phone              = (formData as any).driverPhone;

            if (formData.driverName) {
                if (driverId) {
                    // Водитель выбран из справочника — обновляем его данные
                    if (Object.keys(driverPayload).length > 0) {
                        await updateDoc(doc(db, 'drivers', driverId), driverPayload).catch(console.error);
                    }
                } else {
                    // Новый водитель — создаём запись в справочнике
                    const newDriverRef = await addDoc(collection(db, 'drivers'), {
                        name: formData.driverName,
                        ...driverPayload,
                        createdAt: serverTimestamp(),
                    });
                    driverId = newDriverRef.id;
                }
            }

            // Обновляем formData с актуальным driverId перед сохранением доверенности
            const dataToSave = { ...formData, driverId };

            if (isEditing && formData.id) {
                await updateDoc(doc(db, 'projects', project.id, 'trust_deeds', formData.id), {
                    ...dataToSave, updatedAt: serverTimestamp()
                });
            } else {
                // Сохраняем доверенность
                const deedRef = await addDoc(collection(db, 'projects', project.id, 'trust_deeds'), {
                    ...dataToSave, createdAt: serverTimestamp()
                });

                // Автоматически создаём строку в таблице отгрузок
                const existingShipments = project.shipments || [];
                const mat = project.materials?.find(
                    m => m.id === dataToSave.materialId || m.materialName === dataToSave.materialName
                );
                const matLabel = mat
                    ? `${mat.materialName}${(mat as any).supplierName ? ' ' + (mat as any).supplierName : ''}`
                    : dataToSave.materialName || '';

                const newShipment: any = {
                    id: crypto.randomUUID(),
                    autoNumber: String(existingShipments.length + 1),
                    trustDeedId: deedRef.id,
                    trustDeedNumber: dataToSave.number || '',
                    poaNumber: dataToSave.number || '',
                    materialName: matLabel,
                    materialId: dataToSave.materialId || '',
                    quantity: dataToSave.quantity || 0,
                    carryingCost: dataToSave.rate || 0,
                    totalCarryingCost: 0,
                    carrierName: dataToSave.carrierName || '',
                    docType: 'upd',
                    incomingUPD: '',
                    outgoingUPD: '',
                    scanSentToAccounting: false,
                    loadingDate: '',
                    unloadingDate: '',
                    carrierUPD: '',
                    createdAt: new Date().toISOString(),
                };

                await updateDoc(doc(db, 'projects', project.id), {
                    shipments: [...existingShipments, newShipment],
                    updatedAt: serverTimestamp(),
                });
            }
            setIsAdding(false);
            setFormData({});
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, path);
        }
    };

    const handleSaveAndGenerate = async () => {
        const snapshot = { ...formData } as TrustDeed;
        await handleSave();
        await handleGenerateDeed(snapshot);
    };

    const handleDelete = async (id: string) => {
        if (!canEdit || !window.confirm('Вы уверены, что хотите удалить эту доверенность?')) return;
        try {
            await deleteDoc(doc(db, 'projects', project.id, 'trust_deeds', id));
            if (selectedDeedId === id) setSelectedDeedId(null);
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/trust_deeds/${id}`);
        }
    };

    const sortedTrustDeeds = [...trustDeeds].sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));

    useEffect(() => {
        setSelectedDeedId(prev => {
            if (sortedTrustDeeds.length === 0) return null;
            if (prev && sortedTrustDeeds.some(d => d.id === prev)) return prev;
            return sortedTrustDeeds[0].id;
        });
    }, [trustDeeds.length]);

    return (
        <div className="space-y-4">
            {sortedTrustDeeds.length > 0 ? (
                <div className="flex flex-col lg:grid lg:grid-cols-5 gap-4 items-start">
                    {/* Table card — 3/5 width */}
                    <div className="lg:col-span-3 min-w-0 self-start rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3 shrink-0">
                            <h3 className="text-[14px] font-serif font-medium flex items-center gap-2 text-ink">
                                Реестр доверенностей
                                <span className="text-[11px] font-serif opacity-40">· {trustDeeds.length}</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => selectedDeed && handleGenerateDeed(selectedDeed)}
                                    disabled={!selectedDeed}
                                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-semibold border border-line text-ink-2 bg-surface hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <Printer size={12} /> Печать
                                </button>
                                {canEdit && (
                                    <button onClick={handleAdd} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-semibold bg-[#B48444] text-white hover:bg-[#A6783D] transition-colors">
                                        <Plus size={12} /> Новая доверенность
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="overflow-x-auto custom-scrollbar p-4 pt-2">
                            <table className="w-full text-left">
                                <thead>
                                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                                    <th className="px-4 py-3 font-bold w-10">№</th>
                                    <th className="px-2 py-3 font-bold w-24">Выдана</th>
                                    <th className="px-2 py-3 font-bold w-24">До</th>
                                    <th className="px-4 py-3 font-bold">Водитель</th>
                                    <th className="px-4 py-3 font-bold">Перевозчик</th>
                                    <th className="px-4 py-3 font-bold text-right w-36">Кол-во</th>
                                    <th className="w-8 px-2 py-3" />
                                </tr>
                                </thead>
                                <tbody>
                                {sortedTrustDeeds.map((deed) => {
                                    const isSelected = deed.id === selectedDeedId;
                                    return (
                                        <tr
                                            key={deed.id}
                                            onClick={() => setSelectedDeedId(deed.id === selectedDeedId ? null : deed.id)}
                                            className={cn(
                                                "cursor-pointer transition-colors border-b border-[#E1D8C5]/60 last:border-b-0",
                                                isSelected ? "bg-[#F5E9CC] shadow-[inset_3px_0_0_0_#B07A2C]" : "hover:bg-[#F5F2E9]/80"
                                            )}
                                        >
                                            <td className="px-4 py-3.5">
                                                <span className="text-[11px] text-ink-4 font-mono mr-0.5">№</span>
                                                <span className="text-[13px] font-bold text-ink">{deed.number}</span>
                                            </td>
                                            <td className="px-2 py-3.5"><span className="text-[11px] font-mono text-ink-3 whitespace-nowrap">{deed.issueDate ? formatDateToDisplay(deed.issueDate) : '—'}</span></td>
                                            <td className="px-2 py-3.5"><span className="text-[11px] font-mono text-ink-3 whitespace-nowrap">{deed.expiryDate ? formatDateToDisplay(deed.expiryDate) : '—'}</span></td>
                                            <td className="px-4 py-3.5"><span className="text-[12px] font-medium text-ink">{deed.driverName || '—'}</span></td>
                                            <td className="px-4 py-3.5"><span className="text-[12px] text-ink-3">{deed.carrierName || '—'}</span></td>
                                            <td className="px-4 py-3.5 text-right"><span className="text-[12px] font-mono font-semibold text-ink">{deed.quantity ? (() => {
                                                const mat = project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName);
                                                const unit = (mat as any)?.unitName || '';
                                                return `${deed.quantity.toLocaleString('ru-RU')}${unit ? ' ' + unit : ''}`;
                                            })() : '—'}</span></td>
                                            <td className="px-2 py-3.5 align-middle text-ink-4">
                                                <ChevronRight size={14} className={cn("transition-opacity", isSelected ? "opacity-80" : "opacity-30")} />
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Detail card — 2/5 width */}
                    {selectedDeed ? (
                        <div className="lg:col-span-2 w-full self-start rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col max-h-[75vh]">
                            <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-[#E8E4DC] bg-[#FCF9F2]">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] mb-0.5">Доверенность</p>
                                        <h4 className="font-serif text-[20px] font-normal text-[#2C2922] leading-[1.15]">№ {selectedDeed.number}</h4>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {canEdit && (
                                            <>
                                                <button onClick={() => handleEdit(selectedDeed)} title="Редактировать" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><Pencil size={13} /></button>
                                                <button onClick={() => handleDelete(selectedDeed.id)} title="Удалить" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#A04930] hover:bg-[#F5E6E2] transition-colors"><Trash2 size={13} /></button>
                                            </>
                                        )}
                                        <button onClick={() => setSelectedDeedId(null)} title="Свернуть" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><X size={13} /></button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4 bg-[#FCF9F2]">
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Сроки</h5>
                                    <div>
                                        <ShipmentDetailField label="Дата выдачи" value={selectedDeed.issueDate ? formatDateToDisplay(selectedDeed.issueDate) : undefined} />
                                        <ShipmentDetailField label="Действует до" value={selectedDeed.expiryDate ? formatDateToDisplay(selectedDeed.expiryDate) : undefined} showDivider={false} />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Груз</h5>
                                    <div>
                                        <ShipmentDetailField label="Материал" value={(() => {
                                            const mat = project.materials?.find(m => m.id === selectedDeed.materialId || m.materialName === selectedDeed.materialName);
                                            const supplier = (mat as any)?.supplierName;
                                            return selectedDeed.materialName
                                                ? (supplier ? `${selectedDeed.materialName} · ${supplier}` : selectedDeed.materialName)
                                                : undefined;
                                        })()} />
                                        <ShipmentDetailField label="Количество" value={selectedDeed.quantity ? `${selectedDeed.quantity.toLocaleString('ru-RU')} шт` : undefined} showDivider={false} />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Логистика</h5>
                                    <div>
                                        <ShipmentDetailField label="Перевозчик" value={selectedDeed.carrierName} />
                                        <ShipmentDetailField label="Счёт №" value={selectedDeed.accountNumber} />
                                        <ShipmentDetailField label="Дата счёта" value={(selectedDeed as any).accountDate ? formatDateToDisplay((selectedDeed as any).accountDate) : undefined} />
                                        <ShipmentDetailField label="Ставка" value={selectedDeed.rate ? formatCurrency(selectedDeed.rate) : undefined} showDivider={false} />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Кому</h5>
                                    <div>
                                        <ShipmentDetailField label="ФИО водителя" value={selectedDeed.driverName} />
                                        <ShipmentDetailField label="Паспорт — серия" value={selectedDeed.driverPassportSeries} />
                                        <ShipmentDetailField label="Паспорт — номер" value={selectedDeed.driverPassportNumber} />
                                        <ShipmentDetailField label="Кем выдан" value={(selectedDeed as any).driverPassportIssuedBy} />
                                        <ShipmentDetailField label="Когда выдан" value={(selectedDeed as any).driverPassportIssuedDate ? formatDateToDisplay((selectedDeed as any).driverPassportIssuedDate) : undefined} showDivider={false} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="lg:col-span-2 w-full self-start rounded-2xl border border-dashed border-line bg-transparent p-8 flex flex-col items-center justify-center gap-2 text-center">
                            <ChevronRight size={18} className="text-ink-4 opacity-40" />
                            <p className="text-[12px] font-medium text-ink-3">Выберите доверенность</p>
                            <p className="text-[10px] text-ink-4">для просмотра подробностей</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                        <h3 className="text-[14px] font-serif font-medium flex items-center gap-2 text-ink">
                            Реестр доверенностей <span className="text-[11px] font-serif opacity-40">· 0</span>
                        </h3>
                    </div>
                    <div className="py-7 px-5 m-4 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5 border-line bg-transparent">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center bg-white border border-line text-ink-3 shadow-sm">
                            <FileText size={16} />
                        </div>
                        <div className="text-center space-y-0.5">
                            <p className="text-[13px] font-serif font-medium text-ink">Доверенностей пока нет</p>
                            <p className="text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60 text-ink-4">Создавайте и формируйте документ прямо отсюда</p>
                        </div>
                        {canEdit && (
                            <button onClick={handleAdd} className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-semibold bg-[#B48444] text-white hover:bg-[#A6783D] transition-colors">
                                <Plus size={12} /> Новая доверенность
                            </button>
                        )}
                    </div>
                </div>
            )}

            <AnimatePresence>
                {isAdding && (
                    <TrustDeedModal
                        formData={formData}
                        setFormData={(data: Partial<TrustDeed>) => {
                            if (data.issueDate !== formData.issueDate && data.issueDate) {
                                setFormData({ ...data, expiryDate: addExpiryWeek(data.issueDate) });
                            } else {
                                setFormData(data);
                            }
                        }}
                        onClose={() => { setIsAdding(false); setFormData({}); }}
                        onSave={handleSave}
                        onSaveAndGenerate={handleSaveAndGenerate}
                        directories={directories}
                        project={project}
                        isEditing={isEditing}
                    />
                )}
            </AnimatePresence>
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


function TrustDeedModal({ formData, setFormData, onClose, onSave, onSaveAndGenerate, directories, project, isEditing }: { formData: Partial<TrustDeed> & { accountDate?: string; driverPassportIssuedBy?: string; driverPassportIssuedDate?: string; driverPhone?: string }, setFormData: any, onClose: () => void, onSave: () => void, onSaveAndGenerate: () => void, directories: any, project: Project, isEditing: boolean }) {
    const inputClass = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
    const labelClass = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";
    const sectionLabel = "text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5";

    const materialOptions = (project.materials || []).map(m => ({
        id: m.id,
        name: m.materialName,
        sub: (m as any).supplierName || '',
    }));

    const driverOptions = (directories.drivers || []).map((d: any) => ({ id: d.id, name: d.name }));

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0" style={{ backgroundColor: 'rgba(31,28,20,0.45)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-2xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                            {isEditing ? 'Редактировать доверенность' : 'Новая доверенность'}
                        </h2>
                        <p className="text-[11px] text-ink-3 mt-0.5">Номер сквозной по всем проектам, доступен для редактирования</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={labelClass}>Номер</label>
                            <input type="text" value={formData.number || ''} onChange={e => setFormData({...formData, number: e.target.value})} className={inputClass} placeholder="Авто" />
                        </div>
                        <div>
                            <label className={labelClass}>Дата выдачи</label>
                            <DatePicker value={formData.issueDate || ''} onChange={v => setFormData({...formData, issueDate: v})} variant="compact" className="[&_input]:h-9" />
                        </div>
                        <div>
                            <label className={labelClass}>Действует до</label>
                            <DatePicker value={formData.expiryDate || ''} onChange={v => setFormData({...formData, expiryDate: v})} variant="compact" className="[&_input]:h-9" />
                        </div>
                    </div>

                    <div>
                        <h3 className={sectionLabel}>Груз</h3>
                        <div className="mt-3 grid grid-cols-[1fr_100px] gap-4">
                            <div>
                                <label className={labelClass}>Материал</label>
                                <DirectorySelect
                                    value={formData.materialName || ''}
                                    options={materialOptions.map(m => ({ id: m.id, name: m.sub ? `${m.name} · ${m.sub}` : m.name }))}
                                    onChange={v => {
                                        const mat = materialOptions.find(m => `${m.name} · ${m.sub}` === v || m.name === v);
                                        setFormData({...formData, materialName: mat?.name || v, materialId: mat?.id || ''});
                                    }}
                                    onAdd={async () => {}}
                                    placeholder="Выбрать материал..."
                                    iconType="material"
                                    inputHeight="h-9"
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Количество</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={formData.quantity ? formData.quantity.toLocaleString('ru-RU') : ''}
                                    onChange={e => {
                                        const raw = e.target.value.replace(/\s/g, '').replace(/[^\d]/g, '');
                                        setFormData({...formData, quantity: raw ? Number(raw) : 0});
                                    }}
                                    className={inputClass}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className={sectionLabel}>Логистика</h3>
                        <div className="mt-3 space-y-4">
                            <div>
                                <label className={labelClass}>Логистическая компания</label>
                                <DirectorySelect
                                    value={formData.carrierName || ''}
                                    options={(directories.carriers || []).map((c: any) => ({ id: c.id, name: c.name }))}
                                    onChange={v => {
                                        const carrier = (directories.carriers || []).find((c: any) => c.name === v);
                                        setFormData({...formData, carrierName: v, carrierId: carrier?.id || ''});
                                    }}
                                    onAdd={async (name) => {
                                        const ref = await addDoc(collection(db, 'carriers'), { name, createdAt: serverTimestamp() });
                                        await addDoc(collection(db, 'companies'), { name, companyType: 'Перевозчик', createdAt: serverTimestamp() });
                                        setFormData({...formData, carrierName: name, carrierId: ref.id});
                                    }}
                                    placeholder="Выбрать перевозчика..."
                                    iconType="carrier"
                                    inputHeight="h-9"
                                />
                            </div>
                            <div className="grid grid-cols-[140px_130px_1fr] gap-3">
                                <div>
                                    <label className={labelClass}>Счёт №</label>
                                    <input type="text" value={formData.accountNumber || ''} onChange={e => setFormData({...formData, accountNumber: e.target.value})} className={inputClass} placeholder="Номер" />
                                </div>
                                <div>
                                    <label className={labelClass}>от</label>
                                    <DatePicker value={formData.accountDate || ''} onChange={v => setFormData({...formData, accountDate: v})} variant="compact" className="[&_input]:h-9" />
                                </div>
                                <div>
                                    <label className={labelClass}>Ставка, ₽</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={formData.rate ? formData.rate.toLocaleString('ru-RU') : ''}
                                        onChange={e => {
                                            const raw = e.target.value.replace(/\s/g, '').replace(/[^\d]/g, '');
                                            setFormData({...formData, rate: raw ? Number(raw) : 0});
                                        }}
                                        className={inputClass}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className={sectionLabel}>Кому</h3>
                        <div className="mt-3 space-y-4">
                            <div className="grid grid-cols-[1fr_80px_100px] gap-3">
                                <div>
                                    <label className={labelClass}>ФИО водителя</label>
                                    <DirectorySelect
                                        value={formData.driverName || ''}
                                        options={driverOptions}
                                        onChange={v => {
                                            const driver = (directories.drivers || []).find((d: any) => d.name === v);
                                            setFormData({
                                                ...formData,
                                                driverName: v,
                                                driverId: driver?.id || '',
                                                driverPassportSeries: driver?.passportSeries || formData.driverPassportSeries || '',
                                                driverPassportNumber: driver?.passportNumber || formData.driverPassportNumber || '',
                                                driverPassportIssuedBy: driver?.passportIssuedBy || formData.driverPassportIssuedBy || '',
                                                driverPassportIssuedDate: driver?.passportIssuedDate || formData.driverPassportIssuedDate || '',
                                                driverPhone: driver?.phone || formData.driverPhone || '',
                                            });
                                        }}
                                        onAdd={async () => {}}
                                        placeholder="Выбрать водителя..."
                                        iconType="driver"
                                        inputHeight="h-9"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Серия</label>
                                    <input type="text" maxLength={6} value={formData.driverPassportSeries || ''} onChange={e => setFormData({...formData, driverPassportSeries: e.target.value})} className={inputClass} placeholder="0000" />
                                </div>
                                <div>
                                    <label className={labelClass}>Номер</label>
                                    <input type="text" maxLength={6} value={formData.driverPassportNumber || ''} onChange={e => setFormData({...formData, driverPassportNumber: e.target.value})} className={inputClass} placeholder="000000" />
                                </div>
                            </div>
                            <div className="grid grid-cols-[1fr_130px_130px] gap-3">
                                <div>
                                    <label className={labelClass}>Кем выдан</label>
                                    <input type="text" value={formData.driverPassportIssuedBy || ''} onChange={e => setFormData({...formData, driverPassportIssuedBy: e.target.value})} className={inputClass} placeholder="Наименование органа" />
                                </div>
                                <div>
                                    <label className={labelClass}>Когда выдан</label>
                                    <DatePicker value={formData.driverPassportIssuedDate || ''} onChange={v => setFormData({...formData, driverPassportIssuedDate: v})} variant="compact" className="[&_input]:h-9" />
                                </div>
                                <div>
                                    <label className={labelClass}>Телефон</label>
                                    <input type="text" value={formData.driverPhone || ''} onChange={e => setFormData({...formData, driverPhone: e.target.value})} className={inputClass} placeholder="+7..." />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-line flex flex-col sm:flex-row items-center justify-end gap-3 shrink-0 bg-surface-2/30">
                    <button onClick={onClose} className="w-full sm:w-auto inline-flex items-center justify-center h-9 px-4 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        Отмена
                    </button>
                    <button onClick={onSaveAndGenerate} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md text-[13px] font-semibold border border-line text-ink-3 hover:bg-surface-2 transition-colors">
                        <Download size={14} /> Сохранить и сформировать
                    </button>
                    <button onClick={onSave} className="w-full sm:w-auto inline-flex items-center justify-center h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors">
                        {isEditing ? 'Сохранить изменения' : 'Создать доверенность'}
                    </button>
                </div>
            </motion.div>
        </div>,
        document.body
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
