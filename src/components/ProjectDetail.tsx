import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, query, where, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Project, ProjectTask, TrustDeed, AppUser } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, CheckCircle, ChevronRight, MapPin, FileText, Truck, Check, DollarSign } from 'lucide-react';
import { cn, formatDateToDisplay, getShippingProgress, formatShippingProgressLabel, SHIPPING_PROGRESS_COMPLETE_COLOR } from '../lib/utils';
import { getMarginColor, getMarginPercent } from '../lib/financeCalculations';
import { OperationType, handleFirestoreError } from '../lib/firestore-errors';
import { useFinanceAccess } from '../hooks/useFinanceAccess';
import StatusPill from './StatusPill';

import PersonalInfoTab from './project-detail/PersonalInfoTab';
import MaterialsTab from './project-detail/MaterialsTab';
import TrustDeedsTab from './project-detail/TrustDeedsTab';
import ShipmentsTab from './project-detail/ShipmentsTab';
import ActivityTab from './project-detail/ActivityTab';
import FinanceTab from './project-detail/FinanceTab';

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
    const [activeSegment, setActiveSegment] = useState<'info' | 'materials' | 'trust' | 'shipments' | 'activity' | 'finance'>(
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

        // trust_deeds теперь коллекция верхнего уровня (не подколлекция проекта) — так номер
        // доверенности можно сделать сквозным по всей системе, а не только в рамках проекта.
        // Связь с проектом — через поле projectId, поэтому фильтруем через where().
        const unsubTrustDeeds = onSnapshot(
            query(collection(db, 'trust_deeds'), where('projectId', '==', projectId)),
            (snapshot) => {
                setTrustDeeds(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrustDeed)));
            }, (error) => {
                console.error("Trust deeds error:", error);
            }
        );

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
                <TabButton active={activeSegment === 'materials'} onClick={() => setActiveSegment('materials')} label="Материалы" count={project.materials?.length} />
                <TabButton active={activeSegment === 'trust'} onClick={() => setActiveSegment('trust')} label="Доверенности" count={trustDeeds.length} />
                <TabButton active={activeSegment === 'shipments'} onClick={() => setActiveSegment('shipments')} label="Отгрузки" count={project.shipments?.length} />
                {canSeeFinancialData && (
                    <TabButton
                        active={activeSegment === 'finance'}
                        onClick={() => setActiveSegment('finance')}
                        label="Финансы"
                    />
                )}
                <TabButton active={activeSegment === 'activity'} onClick={() => setActiveSegment('activity')} label="Задачи" count={tasks.length} />
            </div>

            {/* Content Area */}
            <div className="grid grid-cols-1 gap-8">
                <AnimatePresence mode="wait">
                    {activeSegment === 'info' && <motion.div key="info"><PersonalInfoTab project={project} canEdit={canEdit} users={users} /></motion.div>}
                    {activeSegment === 'materials' && <motion.div key="materials"><MaterialsTab project={project} canEdit={canEdit} directories={directories} /></motion.div>}
                    {activeSegment === 'trust' && <motion.div key="trust"><TrustDeedsTab project={project} canEdit={canEdit} directories={directories} trustDeeds={trustDeeds} accessToken={accessToken} /></motion.div>}
                    {activeSegment === 'shipments' && <motion.div key="shipments"><ShipmentsTab project={project} canEdit={canEdit} trustDeeds={trustDeeds} /></motion.div>}
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
                    {activeSegment === 'activity' && <motion.div key="activity"><ActivityTab tasks={tasks} projectId={projectId} canEdit={canEdit} project={project} accessToken={accessToken} onConnectCalendar={onConnectCalendar} onClearCalendarToken={onClearCalendarToken} /></motion.div>}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

function TabButton({ active, onClick, label, count }: { active: boolean, onClick: () => void, label: string, count?: number }) {
    // Иконка по лейблу
    const iconNode =
        label === 'Информация'   ? <FileText size={13} /> :
            label === 'Материалы'    ? <Truck size={13} /> :
                label === 'Доверенности' ? <FileText size={13} /> :
                    label === 'Отгрузки'     ? <Truck size={13} /> :
                        label === 'Задачи'        ? <Check size={13} /> :
                            label === 'Финансы' ? <DollarSign size={13} /> :
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