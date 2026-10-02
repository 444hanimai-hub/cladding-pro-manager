import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy, documentId, collectionGroup } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Project, AppUser, ProjectTask, ProjectEvent } from '../types';
import { motion } from 'motion/react';
import {
  Users as UsersIcon,
  Calendar,
  ListFilter,
  TrendingUp,
  ChevronRight,
  ArrowRight,
  TrendingDown,
  Plus,
  Flag,
  ChevronDown,
  Check,
  Circle
} from 'lucide-react';
import { formatCurrency, cn, getShippingProgress, formatShippingProgressLabel, SHIPPING_PROGRESS_COMPLETE_COLOR, formatAmountGrouped } from '../lib/utils';
import { getMarginColor, getActualExpensesTotal, getPlannedExpensesTotal, getExpensesTotalByTypeAndCategory, getNetProfitActual, getNetProfitPlanned, getActualIncomeTotal } from '../lib/financeCalculations';
import { EXPENSE_CATEGORY_TAX } from '../lib/plannedExpenses';
import { FinanceCodeGate } from './CodeProtection';
import { useFinanceAccess } from '../hooks/useFinanceAccess';
import UserAvatar from './UserAvatar';
import StatusPill from './StatusPill';
import { Card } from './ui/Card';
import { Pill } from './ui/Pill';
import { Progress } from './ui/Progress';
import {
  PeriodSelector,
  DateTypeSelector,
  StatusSelector,
  ManagerSelector,
  LegalEntitySelector,
  PeriodType
} from './shared/DashboardFilters';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

export const getNormalizedStatus = (raw: string | undefined): 'in_progress' | 'shipping' | 'done' | 'canceled' => {
  if (!raw) return 'in_progress';
  if (raw === 'lead' || raw === 'active' || raw === 'in_progress') return 'in_progress';
  if (raw === 'completed' || raw === 'done') return 'done';
  if (raw === 'cancelled' || raw === 'canceled') return 'canceled';
  if (raw === 'shipping') return 'shipping';
  return 'in_progress';
};

function getPeriodRange(type: PeriodType) {
  const now = new Date();
  if (type === 'quarter') {
    const quarter = Math.floor(now.getMonth() / 3);
    const qStart = new Date(now.getFullYear(), quarter * 3, 1);
    const qEnd = new Date(now.getFullYear(), (quarter + 1) * 3, 0);
    return { start: qStart, end: qEnd };
  }
  if (type === 'year') {
    const yStart = new Date(now.getFullYear(), 0, 1);
    const yEnd = new Date(now.getFullYear(), 11, 31);
    return { start: yStart, end: yEnd };
  }
  return { start: null, end: null };
}

function formatDateRange(period: PeriodType, start: Date | null, end: Date | null) {
  if (!start || !end) return 'Всё время';
  if (period === 'year') return `${start.getFullYear()}г.`;
  const f = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

interface DashboardProps {
  onSelectProject: (id: string) => void;
  onSelectTask?: (projectId: string, taskId: string) => void;
  onViewAllProjects?: () => void;
  appUser: AppUser | null;
}

export default function Dashboard({ onSelectProject, onSelectTask, onViewAllProjects, appUser }: DashboardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AppUser[]>([]);
  const { needsCodeGate, unlock } = useFinanceAccess(appUser);
  const [allTasks, setAllTasks] = useState<ProjectTask[]>([]);
  const [allTrustDeeds, setAllTrustDeeds] = useState<any[]>([]);
  const [allEvents, setAllEvents] = useState<ProjectEvent[]>([]);

  const [dateFilterType, setDateFilterType] = useState<'createdAt' | 'deadline'>('createdAt');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('year');
  const [filterManagerId, setFilterManagerId] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterLegalEntityId, setFilterLegalEntityId] = useState('');
  const isInitialized = useRef(false);

  useEffect(() => {
    if (!appUser?.uid || isInitialized.current) return;
    const saved = localStorage.getItem(`dashboardFilters_${appUser.uid}`);
    if (saved) {
      try {
        const filters = JSON.parse(saved);
        if (filters.dateFilterType) setDateFilterType(filters.dateFilterType);
        if (filters.selectedPeriod) setSelectedPeriod(filters.selectedPeriod);
        if (filters.filterManagerId !== undefined) setFilterManagerId(filters.filterManagerId);
        if (filters.filterStatuses) setFilterStatuses(filters.filterStatuses);
        if (filters.filterLegalEntityId !== undefined) setFilterLegalEntityId(filters.filterLegalEntityId);
      } catch (e) { console.error("Failed to load dashboard filters", e); }
    }
    isInitialized.current = true;
  }, [appUser?.uid]);

  useEffect(() => {
    if (!appUser?.uid || !isInitialized.current) return;
    const filters = { dateFilterType, selectedPeriod, filterManagerId, filterStatuses, filterLegalEntityId };
    localStorage.setItem(`dashboardFilters_${appUser.uid}`, JSON.stringify(filters));
  }, [dateFilterType, selectedPeriod, filterManagerId, filterStatuses, filterLegalEntityId, appUser?.uid]);

  const activeRange = useMemo(() => getPeriodRange(selectedPeriod), [selectedPeriod]);

  // Явная клиентская фильтрация по правам доступа — независимо от того что вернул Firebase
  const accessibleProjects = useMemo(() => {
    if (!appUser) return [];
    if (appUser.fullProjectAccess) return projects;
    const uid = auth.currentUser?.uid;
    const accessIds = new Set(Object.keys(appUser.projectsAccess || {}));
    return projects.filter(p =>
        p.leadManagerId === uid ||
        accessIds.has(p.id)
    );
  }, [projects, appUser]);

  const filteredProjects = useMemo(() => {
    return accessibleProjects.filter(p => {
      if (filterManagerId && p.leadManagerId !== filterManagerId) return false;
      if (filterLegalEntityId && p.sellerLegalEntityId !== filterLegalEntityId) return false;
      if (filterStatuses.length > 0) {
        const normalized = getNormalizedStatus(p.status as string);
        if (!filterStatuses.includes(normalized)) return false;
      }
      if (activeRange.start && activeRange.end) {
        if (dateFilterType === 'createdAt') {
          if (!p.createdAt) return false;
          const d = p.createdAt.toDate();
          if (d < activeRange.start || d > new Date(activeRange.end.getTime() + 86400000)) return false;
        } else {
          if (!p.deadline) return false;
          const d = p.deadline.toDate ? p.deadline.toDate() : new Date(p.deadline);
          if (d < activeRange.start || d > activeRange.end) return false;
        }
      }
      return true;
    });
  }, [accessibleProjects, filterManagerId, filterLegalEntityId, filterStatuses, activeRange, dateFilterType]);

  // ── Итоги по ВСЕМ отфильтрованным проектам — ПЛАН и ФАКТ по каждой метрике,
  // та же модель и те же формулы, что и на вкладке «Финансы» внутри проекта:
  // расходы БЕЗ налога (он своей отдельной карточкой), факт прибыли — поступления
  // минус фактические расходы (см. lib/financeCalculations.ts). ──
  const totals = useMemo(() => {
    return filteredProjects.reduce((acc, p) => {
      const f = p.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
      acc.contractSum += f.contractSum || 0;
      acc.incomeActual += getActualIncomeTotal(f);
      acc.expensesPlanned += getPlannedExpensesTotal(f);
      acc.expensesActual += getActualExpensesTotal(f);
      acc.taxPlanned += getExpensesTotalByTypeAndCategory(f, 'planned', EXPENSE_CATEGORY_TAX);
      acc.taxActual += getExpensesTotalByTypeAndCategory(f, 'actual', EXPENSE_CATEGORY_TAX);
      acc.netProfitPlanned += getNetProfitPlanned(f);
      acc.netProfitActual += getNetProfitActual(f);
      return acc;
    }, {
      contractSum: 0, incomeActual: 0,
      expensesPlanned: 0, expensesActual: 0,
      taxPlanned: 0, taxActual: 0,
      netProfitPlanned: 0, netProfitActual: 0,
    });
  }, [filteredProjects]);

  const marginPlanned = useMemo(() => {
    return totals.contractSum > 0 ? (totals.netProfitPlanned / totals.contractSum) * 100 : 0;
  }, [totals.contractSum, totals.netProfitPlanned]);

  const marginActual = useMemo(() => {
    return totals.contractSum > 0 ? (totals.netProfitActual / totals.contractSum) * 100 : 0;
  }, [totals.contractSum, totals.netProfitActual]);

  const upcomingItems = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const limit = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const items: any[] = [];
    const projectMap = new Map<string, Project>(filteredProjects.map(p => [p.id, p]));
    console.log(`Analyzing ${allTasks.length} tasks and ${allEvents.length} events for upcoming`);

    allTasks.forEach(t => {
      if (t.completed) return;
      const project = projectMap.get(t.projectId);
      if (!project) return;
      let d: Date | null = null;
      if (t.date && typeof t.date === 'string' && t.date.trim()) {
        const parts = t.date.split('-');
        if (parts.length === 3) {
          d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        } else {
          d = new Date(t.date);
        }
      } else if (t.date?.toDate) {
        d = t.date.toDate();
      } else if (t.dueDate?.toDate) {
        d = t.dueDate.toDate();
      } else if (t.dueDate && typeof t.dueDate === 'string' && t.dueDate.trim()) {
        const parts = t.dueDate.split('-');
        d = parts.length === 3
            ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
            : new Date(t.dueDate);
      }
      if (d && d >= now && d < limit) {
        items.push({ id: t.id, projectId: t.projectId, projectName: project.name, managerId: project.leadManagerId || '', managerName: project.leadManagerName || '', title: t.title, type: 'task', date: d, time: t.time });
      }
    });

    allEvents.forEach(e => {
      if (e.type === 'completed' || e.type === 'cancelled') return;
      const project = projectMap.get(e.projectId);
      if (!project) return;
      let d: Date | null = null;
      if (e.date?.toDate) d = e.date.toDate();
      else if (typeof e.date === 'string') d = new Date(e.date);
      if (d && d >= now && d < limit) {
        items.push({ id: e.id, projectId: e.projectId, projectName: project.name, managerId: project.leadManagerId || '', managerName: project.leadManagerName || '', title: e.title, type: 'event', date: d, time: e.time });
      }
    });

    return items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [allTasks, allEvents, filteredProjects]);

  const activeProjectsInfo = useMemo(() => {
    const baseList = filteredProjects.filter(p => {
      const norm = getNormalizedStatus(p.status as string);
      return norm === 'in_progress' || norm === 'shipping';
    });
    const inProgress = baseList.filter(p => getNormalizedStatus(p.status as string) === 'in_progress').sort((a, b) => {
      const t = (p: any) => p.deadline ? (p.deadline.toDate ? p.deadline.toDate() : new Date(p.deadline)).getTime() : 9999999999999;
      return t(a) - t(b);
    });
    const shipping = baseList.filter(p => getNormalizedStatus(p.status as string) === 'shipping').sort((a, b) => (b.finance?.contractSum || 0) - (a.finance?.contractSum || 0));
    return { totalCount: baseList.length, displayProjects: [...inProgress, ...shipping] };
  }, [filteredProjects]);

  const expensesChartData = useMemo(() => {
    const map = new Map<string, number>();
    filteredProjects.forEach(p => {
      const expenses = p.finance?.expenses || [];
      expenses.forEach((e: any) => {
        const cat = e.category || 'Прочее';
        map.set(cat, (map.get(cat) || 0) + (e.amount || 0));
      });
    });
    return Array.from(map.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
  }, [filteredProjects]);

  const conversion = useMemo(() => {
    const s1 = filteredProjects.filter(p => { const n = getNormalizedStatus(p.status as string); return n === 'in_progress' || n === 'shipping'; }).length;
    const s2 = filteredProjects.filter(p => getNormalizedStatus(p.status as string) === 'shipping').length;
    if (s1 === 0) return 0;
    return Math.round((s2 * 100) / s1);
  }, [filteredProjects]);

  const avgDuration = useMemo(() => {
    const getCompletionDate = (p: Project): Date | null => {
      const raw = p.actualCompletionDate || p.completedAt || p.completed;
      if (!raw) return null;
      if (raw.toDate) return raw.toDate();
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    };
    const rel = filteredProjects.filter(p => {
      const norm = getNormalizedStatus(p.status as string);
      if (norm !== 'done') return false;
      if (!p.createdAt) return false;
      const end = getCompletionDate(p);
      if (!end) return false;
      const start = p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
      return end.getTime() > start.getTime();
    });
    if (rel.length === 0) return 0;
    const total = rel.reduce((sum, p) => {
      const start = p.createdAt.toDate ? p.createdAt.toDate().getTime() : new Date(p.createdAt).getTime();
      const end = getCompletionDate(p)!.getTime();
      return sum + (end - start) / (1000 * 60 * 60 * 24 * 7);
    }, 0);
    return Math.ceil(total / rel.length);
  }, [filteredProjects]);

  const overdueCount = useMemo(() => {
    const now = new Date().getTime();
    return filteredProjects.filter(p => {
      if (!p.deadline) return false;
      const dl = p.deadline.toDate ? p.deadline.toDate().getTime() : new Date(p.deadline).getTime();
      const norm = getNormalizedStatus(p.status as string);
      if ((norm === 'done') && p.completedAt) {
        const cd = p.completedAt.toDate ? p.completedAt.toDate().getTime() : new Date(p.completedAt).getTime();
        return cd > dl;
      }
      if (norm === 'in_progress' || norm === 'shipping') return now > dl;
      return false;
    }).length;
  }, [filteredProjects]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!appUser) return;

    const unsubTasks = onSnapshot(collectionGroup(db, 'tasks'), (snap) => {
      setAllTasks(snap.docs.map(doc => {
        const data = doc.data();
        const parts = doc.ref.path.split('/');
        const projectId = data.projectId || (parts.length >= 2 ? parts[1] : null);
        return { id: doc.id, projectId, ...data } as ProjectTask;
      }));
    }, (error) => { console.error("Dashboard tasks group snapshot error:", error); });

    const unsubEvents = onSnapshot(collectionGroup(db, 'events'), (snap) => {
      setAllEvents(snap.docs.map(doc => {
        const data = doc.data();
        const parts = doc.ref.path.split('/');
        const projectId = data.projectId || (parts.length >= 2 ? parts[1] : null);
        return { id: doc.id, projectId, ...data } as ProjectEvent;
      }));
    }, (error) => { console.error("Dashboard events group snapshot error:", error); });

    // trust_deeds — коллекция верхнего уровня (не подколлекция проекта), номера
    // уникальны сквозно по всей системе — поэтому безопасно грузить единым списком,
    // без фильтрации по конкретному проекту (см. getShippingProgress в lib/utils.ts).
    const unsubTrustDeeds = onSnapshot(collection(db, 'trust_deeds'), (snap) => {
      setAllTrustDeeds(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => { console.error("Dashboard trust_deeds snapshot error:", error); });

    return () => { unsubTasks(); unsubEvents(); unsubTrustDeeds(); };
  }, [appUser]);

  useEffect(() => {
    if (!appUser) return;
    setLoading(true);

    // Полный доступ — грузим все проекты
    if (appUser.fullProjectAccess) {
      const q = query(collection(db, 'projects'), orderBy('updatedAt', 'desc'));
      const unsub = onSnapshot(q, (snap) => {
        setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
        setLoading(false);
      }, () => setLoading(false));
      return () => unsub();
    }

    // Ограниченный доступ
    const unsubs: (() => void)[] = [];
    const projectsMap = new Map<string, Project>();

    const updateProjectsState = () => {
      const all = Array.from(projectsMap.values()).sort((a, b) => {
        const dA = a.updatedAt?.toDate?.() || new Date(0);
        const dB = b.updatedAt?.toDate?.() || new Date(0);
        return dB.getTime() - dA.getTime();
      });
      setProjects(all);
      setLoading(false);
    };

    const currentUid = appUser.uid || auth.currentUser?.uid;
    if (!currentUid) {
      setLoading(false);
      return;
    }

    // Проекты где пользователь — ведущий менеджер
    const qManager = query(collection(db, 'projects'), where('leadManagerId', '==', currentUid));
    unsubs.push(onSnapshot(qManager, (snap) => {
      snap.docs.forEach(doc => projectsMap.set(doc.id, { id: doc.id, ...doc.data() } as Project));
      updateProjectsState();
    }, () => setLoading(false)));

    // Проекты из projectsAccess
    const accessProjectIds = Object.entries(appUser.projectsAccess || {})
        .filter(([, v]) => v === 'view' || v === 'edit')
        .map(([k]) => k);

    if (accessProjectIds.length > 0) {
      for (let i = 0; i < accessProjectIds.length; i += 30) {
        const chunk = accessProjectIds.slice(i, i + 30);
        const q = query(collection(db, 'projects'), where(documentId(), 'in', chunk));
        unsubs.push(onSnapshot(q, (snap) => {
          snap.docs.forEach(doc => projectsMap.set(doc.id, { id: doc.id, ...doc.data() } as Project));
          updateProjectsState();
        }, () => setLoading(false)));
      }
    }

    const timeout = setTimeout(() => { if (projectsMap.size === 0) setLoading(false); }, 2000);
    return () => { clearTimeout(timeout); unsubs.forEach(u => u()); };
  }, [appUser?.uid, appUser?.fullProjectAccess, JSON.stringify(appUser?.projectsAccess)]);

  if (loading) return (
      <div className="h-96 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#c4a483] border-t-transparent rounded-full animate-spin" />
      </div>
  );

  if (needsCodeGate) {
    return <FinanceCodeGate correctCode={appUser?.financeCode || ''} onSuccess={unlock} moduleName="Дашборд" />;
  }

  return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <div className="px-[18px] py-3 bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] flex items-center justify-between gap-4 overflow-visible mb-4" style={{ overflow: 'visible' }}>
          <div className="flex items-center gap-4 overflow-visible">
            <PeriodSelector label="ПЕРИОД" selectedPeriod={selectedPeriod} onPeriodChange={setSelectedPeriod} start={activeRange.start} end={activeRange.end} />
            <div className="h-6 w-px bg-line mx-1" />
            <DateTypeSelector value={dateFilterType} onChange={setDateFilterType} />
            <StatusSelector values={filterStatuses} onChange={setFilterStatuses} />
            <ManagerSelector value={filterManagerId} onChange={setFilterManagerId} users={users} />
            <LegalEntitySelector value={filterLegalEntityId} onChange={setFilterLegalEntityId} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div
              className="flex min-h-[108px] flex-col gap-1.5 rounded-2xl p-[18px_20px] relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, var(--ink) 0%, #2a2618 100%)', border: '1px solid #2a2618' }}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'rgba(245,233,204,0.6)' }}>СУММА КОНТРАКТОВ</p>
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums whitespace-nowrap" style={{ background: 'rgba(245,233,204,0.12)', color: 'rgba(245,233,204,0.85)' }}>
                {formatRatioBadge(totals.contractSum, totals.incomeActual)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="font-display text-[34px] leading-[1.05] tabular-nums text-bg">{formatAmountGrouped(totals.contractSum)}</span>
              <span className="font-display text-[14px] opacity-70 shrink-0 text-bg">₽</span>
            </div>
            <p className="text-[13px] font-semibold tabular-nums" style={{ color: '#7fc98f' }}>
              {formatAmountGrouped(totals.incomeActual)} ₽
            </p>
          </div>

          <DashPlanFactCard label="РАСХОДЫ" plannedValue={totals.expensesPlanned} actualValue={totals.expensesActual} colorCategory="expense" />
          <DashPlanFactCard label="НАЛОГ К УПЛАТЕ" plannedValue={totals.taxPlanned} actualValue={totals.taxActual} colorCategory="expense" />
          <DashPlanFactCard label="ЧИСТАЯ ПРИБЫЛЬ" plannedValue={totals.netProfitPlanned} actualValue={totals.netProfitActual} colorCategory="profit" />
          <DashPlanFactCard label="РЕНТАБЕЛЬНОСТЬ" plannedValue={marginPlanned} actualValue={marginActual} colorCategory="profit" isPercentage badgeMode="diffPP" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8">
            <div className="h-full bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col">
              <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
                <h3 className="font-display text-[17px] font-medium text-ink leading-tight flex items-baseline gap-2">
                  <span>Активные проекты</span>
                  <span className="text-[12px] text-ink-3 font-normal">· {activeProjectsInfo.totalCount}</span>
                </h3>
                <button onClick={onViewAllProjects} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-ink-2 hover:bg-surface-2 transition-colors">
                  Все проекты <ArrowRight size={13} />
                </button>
              </div>
              {activeProjectsInfo.displayProjects.length === 0 ? (
                  <div className="py-20 text-center text-ink-4 italic">Нет активных проектов</div>
              ) : (
                  <div>
                    {activeProjectsInfo.displayProjects.map((project, idx) => (
                        <ProjectFinancialBlock
                            key={project.id}
                            project={project}
                            trustDeeds={allTrustDeeds.filter(d => d.projectId === project.id)}
                            isFirst={idx === 0}
                            onClick={() => onSelectProject(project.id)}
                        />
                    ))}
                  </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-4">
            <div className="h-full bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col">
              <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
                <h3 className="font-display text-[17px] font-medium text-ink leading-tight flex items-baseline gap-2">
                  <span>Ближайшие задачи</span>
                  {upcomingItems.length > 0 && <span className="text-[12px] text-ink-3 font-normal">· {upcomingItems.length}</span>}
                </h3>
              </div>
              <div className="flex-1 overflow-auto max-h-[600px]">
                {upcomingItems.length === 0 ? (
                    <div className="py-16 text-center text-[12px] text-ink-3">Событий нет</div>
                ) : (
                    upcomingItems.map((item, idx) => {
                      const day = item.date.toLocaleDateString('ru-RU', { day: '2-digit' });
                      const month = item.date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '').toLowerCase();
                      const weekday = item.date.toLocaleDateString('ru-RU', { weekday: 'short' }).toLowerCase().replace('.', '');
                      return (
                          <button key={item.id} onClick={() => (item.type === 'task' && onSelectTask) ? onSelectTask(item.projectId, item.id) : onSelectProject(item.projectId)}
                                  className={cn("w-full px-5 py-3 flex items-center gap-4 hover:bg-surface-2 text-left group transition-colors", idx > 0 && "border-t border-line")}>
                            <div className="w-9 flex flex-col items-center shrink-0">
                              <span className="font-display text-[20px] font-normal text-ink leading-none tabular-nums">{day}</span>
                              <span className="text-[9.5px] font-semibold tracking-[0.14em] text-ochre uppercase mt-1 leading-none">{month}</span>
                              <span className="text-[9px] font-semibold tracking-[0.14em] text-ink-4 uppercase mt-[3px] leading-none">{weekday}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-[13px] font-semibold text-ink leading-snug truncate">{item.title}</h4>
                              <p className="text-[11.5px] text-ink-3 truncate mt-1">
                                {item.time && <span className="tabular-nums">{item.time}</span>}
                                {item.time && item.projectName && <span className="text-ink-4"> · </span>}
                                {item.projectName}
                              </p>
                            </div>
                            <UserAvatar uid={item.managerId} name={item.managerName} size="sm" />
                          </button>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-4 items-start">
          <div className="lg:col-span-5">
            <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] px-5 py-4 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Воронка проектов</h3>
                <span className="text-[11.5px] text-ink-3">по сумме контрактов</span>
              </div>
              <ProjectFunnel projects={filteredProjects} />
              <div className="border-t border-line mt-5 mb-4" />
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 leading-snug">Конверсия В работе → Отгрузки</p>
                  <p className="font-display text-[28px] font-normal text-ink tabular-nums leading-none mt-1">{conversion}<span className="text-[16px] opacity-60">%</span></p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 leading-snug">Средний цикл</p>
                  <div className="flex items-baseline gap-1 mt-1">
                    <p className="font-display text-[28px] font-normal text-ink tabular-nums leading-none">{avgDuration}</p>
                    <span className="font-display text-[13px] italic text-ink-3">нед.</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 leading-snug">Просрочено</p>
                  <p className="font-display text-[28px] font-normal tabular-nums leading-none mt-1" style={{ color: overdueCount > 0 ? 'var(--terracotta)' : 'var(--ink)' }}>{overdueCount}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] px-5 py-4 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Расходы по категориям</h3>
                <span className="text-[11.5px] text-ink-3">за выбранный период</span>
              </div>
              <ExpensesChart data={expensesChartData} />
            </div>
          </div>
        </div>
      </motion.div>
  );
}

// ── Цвета для категорий расходов ─────────────────────────────────────────────
const EXPENSE_COLORS: Record<string, string> = {
  Логистика: '#b07a2c',
  Мокап: '#2d4f35',
  Образцы: '#3b4a55',
  Монтаж: '#a04930',
  Закупка: '#5a6b3c',
  'Бонус менеджера': '#7a5c2e',
};
const FALLBACK_COLORS = ['#b07a2c', '#2d4f35', '#3b4a55', '#a04930', '#5a6b3c', '#7a7565', '#4a6b6b', '#6b4a6b'];
function getExpenseColor(name: string, idx: number) {
  return EXPENSE_COLORS[name] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

function ExpensesChart({ data }: { data: { name: string; value: number }[] }) {
  const formatVal = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)} млн ₽`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)} тыс ₽`;
    return `${v} ₽`;
  };

  if (data.length === 0) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
          <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3 text-ink-4">
            <TrendingDown size={22} />
          </div>
          <p className="text-[13px] font-medium text-ink-3">Расходов нет</p>
          <p className="text-[11px] text-ink-4 mt-1">Добавьте расходы в карточках проектов</p>
        </div>
    );
  }

  const total = data.reduce((s, d) => s + d.value, 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const { name, value } = payload[0].payload;
    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
    return (
        <div className="bg-surface border border-line rounded-lg px-3 py-2 shadow-lg">
          <p className="text-[12px] font-semibold text-ink">{name}</p>
          <p className="text-[12px] text-ink-2 tabular-nums">{formatVal(value)}</p>
          <p className="text-[11px] text-ink-3">{pct}%</p>
        </div>
    );
  };

  return (
      <div className="flex gap-4 min-h-0 items-center">
        <div className="w-[200px] h-[200px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                  data={data.map((d, i) => ({ ...d, fill: getExpenseColor(d.name, i) }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  stroke="none"
              >
                {data.map((entry, index) => (
                    <Cell key={entry.name} fill={getExpenseColor(entry.name, index)} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto max-h-[220px] min-w-0">
          {data.map((entry, idx) => {
            const color = getExpenseColor(entry.name, idx);
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0';
            return (
                <div key={entry.name} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[12px] text-ink flex-1 truncate">{entry.name}</span>
                  <span className="text-[11px] text-ink-3 tabular-nums shrink-0">{pct}%</span>
                  <span className="text-[11px] font-semibold text-ink tabular-nums shrink-0 min-w-[65px] text-right">{formatVal(entry.value)}</span>
                </div>
            );
          })}
          <div className="flex items-center gap-2 border-t border-line pt-1.5 mt-0.5">
            <span className="w-2 h-2 shrink-0" />
            <span className="text-[12px] font-semibold text-ink flex-1">Итого</span>
            <span className="text-[11px] text-ink-3 shrink-0">100%</span>
            <span className="text-[11px] font-bold text-ink tabular-nums shrink-0 min-w-[65px] text-right">{formatVal(total)}</span>
          </div>
        </div>
      </div>
  );
}

function ProjectFunnel({ projects }: { projects: Project[] }) {
  const funnelData = useMemo(() => {
    const cats = [
      { key: 'in_progress', label: 'В работе', color: '#3b4a55' },
      { key: 'shipping', label: 'Отгрузки', color: '#5a6b3c' },
      { key: 'done', label: 'Завершён', color: '#2f5e3f' },
      { key: 'canceled', label: 'Отменён', color: '#a04930' },
    ];
    const stats = projects.reduce((acc, p) => {
      const norm = getNormalizedStatus(p.status as string);
      acc[norm].count += 1;
      acc[norm].sum += p.finance?.contractSum || 0;
      return acc;
    }, { in_progress: { count: 0, sum: 0 }, shipping: { count: 0, sum: 0 }, done: { count: 0, sum: 0 }, canceled: { count: 0, sum: 0 } });
    const maxSum = Math.max(...Object.values(stats).map((s: any) => s.sum), 1);
    return cats.map(c => ({ ...c, ...stats[c.key as keyof typeof stats], percentage: (stats[c.key as keyof typeof stats].sum / maxSum) * 100 }));
  }, [projects]);

  const fSum = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1).replace('.0', '')} млн ₽` : v >= 1000 ? `${(v / 1000).toFixed(0)} тыс ₽` : `${v} ₽`;
  const MIN_INSIDE_PCT = 28;

  return (
      <div className="flex flex-col gap-4">
        {funnelData.map((it) => {
          const showInside = it.percentage >= MIN_INSIDE_PCT && it.sum > 0;
          const barPct = Math.max(it.percentage, it.sum > 0 ? 4 : 0);
          return (
              <div key={it.key} className="grid items-center gap-4" style={{ gridTemplateColumns: '110px 1fr 30px' }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
                  <span className="text-[13px] font-medium text-ink truncate">{it.label}</span>
                </div>
                <div className="relative h-6 shrink-0">
                  <div className="absolute inset-0 h-6 bg-surface-2 rounded-[5px] overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${barPct}%` }} transition={{ duration: 0.5, ease: 'easeOut' }}
                                className="absolute inset-y-0 left-0 h-6 max-h-6 rounded-[5px] flex items-center overflow-hidden px-2.5"
                                style={{ backgroundColor: it.color, opacity: it.sum > 0 ? 1 : 0.35 }}>
                      {showInside && <span className="text-[11px] leading-none font-semibold text-white whitespace-nowrap tabular-nums">{fSum(it.sum)}</span>}
                    </motion.div>
                  </div>
                  {!showInside && it.sum > 0 && (
                      <span className="absolute top-1/2 -translate-y-1/2 text-[11px] leading-none font-semibold text-ink-2 whitespace-nowrap tabular-nums pointer-events-none" style={{ left: `calc(${barPct}% + 8px)` }}>
                  {fSum(it.sum)}
                </span>
                  )}
                </div>
                <span className="text-[13px] font-semibold text-ink-2 tabular-nums text-right">{it.count}</span>
              </div>
          );
        })}
      </div>
  );
}

// ── Карточка план/факт (как на вкладке «Финансы»): план крупно и нейтрально
// сверху, факт мелкой цветной строкой снизу, плашка справа — соотношение факт/план
// (или разница в п.п. для рентабельности). ──
const DASH_PLAN_FACT_COLORS = {
  profit: '#2f5e3f',
  expense: '#8a3f47',
  negative: '#a04930',
} as const;

function formatRatioBadge(planned: number, actual: number): string {
  if (!planned) return '—';
  return `${Math.round((actual / planned) * 100)}%`;
}

function formatPercentPointsDiff(planned: number, actual: number): string {
  const diff = Math.round((actual - planned) * 10) / 10;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const abs = Math.abs(diff).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${sign}${abs} п.п.`;
}

function DashPlanFactCard({
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

  const factColor = actualValue < 0 ? DASH_PLAN_FACT_COLORS.negative : DASH_PLAN_FACT_COLORS[colorCategory];
  const badgeText = badgeMode === 'diffPP'
      ? formatPercentPointsDiff(plannedValue, actualValue)
      : formatRatioBadge(plannedValue, actualValue);

  return (
      <div className="flex min-h-[108px] flex-col gap-1.5 rounded-2xl border border-line bg-surface p-[18px_20px] shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">{label}</p>
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-surface-2 text-[10.5px] font-semibold text-ink-3 tabular-nums whitespace-nowrap">
            {badgeText}
          </span>
        </div>
        <p className="font-display text-[34px] leading-[1.05] tabular-nums text-ink">{formatValue(plannedValue)}</p>
        <p className="text-[13px] font-semibold tabular-nums" style={{ color: factColor }}>
          {formatValue(actualValue)}
        </p>
      </div>
  );
}

function ProjectFinancialBlock({ project, trustDeeds, onClick, isFirst }: {
  key?: any;
  project: any;
  trustDeeds?: any[];
  onClick: () => void;
  isFirst?: boolean;
}) {
  const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
  // Рентабельность по карточке проекта — фактическая (поступления минус
  // фактические расходы, та же формула, что и в общих карточках сверху и на
  // вкладке «Финансы» внутри проекта).
  const netProfitActual = getNetProfitActual(f);
  const profitability = f.contractSum ? (netProfitActual / f.contractSum) * 100 : 0;
  const shippingProgress = getShippingProgress(project, trustDeeds);

  const isOverdue = (() => {
    if (!project.deadline || project.status === 'completed' || project.status === 'cancelled') return false;
    const d = project.deadline.toDate ? project.deadline.toDate() : new Date(project.deadline);
    return new Date() > d;
  })();
  const daysOverdue = (() => {
    if (!isOverdue) return 0;
    const d = project.deadline.toDate ? project.deadline.toDate() : new Date(project.deadline);
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  })();

  const formatSum = (val: number) => {
    if (val >= 1000000) { const n = val / 1000000; return { main: n % 1 === 0 ? n.toFixed(0) : n.toFixed(1), unit: 'млн ₽' }; }
    if (val >= 1000) return { main: `${(val / 1000).toFixed(0)}`, unit: 'тыс ₽' };
    return { main: `${val}`, unit: '₽' };
  };
  const contract = formatSum(f.contractSum);
  const marginColor = getMarginColor(profitability);

  return (
      <button onClick={onClick}
              className={cn("w-full grid items-center gap-4 px-5 py-3 hover:bg-surface-2 text-left group transition-colors", !isFirst && "border-t border-line")}
              style={{ gridTemplateColumns: '1fr 105px minmax(150px, 1fr) 80px 30px 16px' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <StatusPill status={project.status as any} />
            {isOverdue && daysOverdue > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[9.5px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap bg-[#f1d9cf] text-terracotta">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              просрочка {daysOverdue} дн.
            </span>
            )}
          </div>
          <h4 className="font-display text-[17px] font-normal text-ink leading-[1.15] tracking-[-0.005em] truncate group-hover:text-ochre transition-colors">{project.name}</h4>
          <p className="text-[11.5px] text-ink-3 truncate mt-0.5">{project.client}</p>
        </div>
        <div>
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Контракт</p>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="font-display text-[16px] tabular-nums text-ink leading-none">{contract.main}</span>
            <span className="text-[10.5px] text-ink-3">{contract.unit}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-[5px]">
            <span className="text-[10.5px] text-ink-3 shrink-0">Отгружено</span>
            <span className="text-[10px] font-semibold text-ink tabular-nums text-right leading-tight">{formatShippingProgressLabel(shippingProgress)}</span>
          </div>
          <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", !shippingProgress.isComplete && "bg-ochre")}
                 style={{ width: `${shippingProgress.barPercent}%`, ...(shippingProgress.isComplete ? { backgroundColor: SHIPPING_PROGRESS_COMPLETE_COLOR } : {}) }} />
          </div>
        </div>
        <div className="text-right">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Маржа</p>
          <p className="font-display text-[20px] leading-none mt-0.5 tabular-nums" style={{ color: marginColor }}>{profitability.toFixed(0)}%</p>
        </div>
        <UserAvatar uid={project.leadManagerId || ''} name={project.leadManagerName || '—'} size="sm" />
        <ChevronRight size={14} className="text-ink-3 justify-self-end" />
      </button>
  );
}