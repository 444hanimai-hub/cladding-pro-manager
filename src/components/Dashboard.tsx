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
  ArrowUpRight,
  Plus,
  Flag,
  ChevronDown,
  Check,
  Circle,
  Download
} from 'lucide-react';
import { formatCurrency, cn, getShippingProgress, formatShippingProgressLabel, SHIPPING_PROGRESS_COMPLETE_COLOR } from '../lib/utils';
import CodeProtection from './CodeProtection';
import UserAvatar from './UserAvatar';
import StatusPill from './StatusPill';
import { Card } from './ui/Card';
import { Pill } from './ui/Pill';
import { Progress } from './ui/Progress';
import { Button } from './ui/Button';
import { 
  PeriodSelector, 
  DateTypeSelector, 
  StatusSelector, 
  ManagerSelector,
  PeriodType 
} from './shared/DashboardFilters';

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

function getPreviousPeriodRange(type: PeriodType) {
  const current = getPeriodRange(type);
  if (!current.start || !current.end) return { start: null, end: null };

  const start = new Date(current.start);
  const end = new Date(current.end);

  if (type === 'year') {
    start.setFullYear(start.getFullYear() - 1);
    end.setFullYear(end.getFullYear() - 1);
  } else if (type === 'quarter') {
    // End is one day before current start
    const prevEnd = new Date(current.start.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 2, 1);
    return { start: prevStart, end: prevEnd };
  }

  return { start, end };
}

function formatDateRange(period: PeriodType, start: Date | null, end: Date | null) {
  if (!start || !end) return 'Всё время';
  if (period === 'year') {
    return `${start.getFullYear()}г.`;
  }
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
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [allTasks, setAllTasks] = useState<ProjectTask[]>([]);
  const [allEvents, setAllEvents] = useState<ProjectEvent[]>([]);

  // Period Filters
  const [dateFilterType, setDateFilterType] = useState<'createdAt' | 'deadline'>('createdAt');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('year');
  const [filterManagerId, setFilterManagerId] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const isInitialized = useRef(false);

  // Persist filters to localStorage
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
      } catch (e) {
        console.error("Failed to load dashboard filters", e);
      }
    }
    isInitialized.current = true;
  }, [appUser?.uid]);

  useEffect(() => {
    if (!appUser?.uid || !isInitialized.current) return;
    const filters = {
      dateFilterType,
      selectedPeriod,
      filterManagerId,
      filterStatuses
    };
    localStorage.setItem(`dashboardFilters_${appUser.uid}`, JSON.stringify(filters));
  }, [dateFilterType, selectedPeriod, filterManagerId, filterStatuses, appUser?.uid]);

  const activeRange = useMemo(() => getPeriodRange(selectedPeriod), [selectedPeriod]);
  const previousRange = useMemo(() => getPreviousPeriodRange(selectedPeriod), [selectedPeriod]);

  const isOwner = appUser?.email === '444hanimai@gmail.com';

  const accessibleProjects = useMemo(() => {
    return projects.filter(p => 
      isOwner ||
      appUser?.fullProjectAccess === true || 
      !!appUser?.projectsAccess?.[p.id] ||
      p.leadManagerId === auth.currentUser?.uid
    );
  }, [projects, appUser, isOwner]);

  const filteredProjects = useMemo(() => {
    return accessibleProjects.filter(p => {
      // Manager check
      if (filterManagerId && p.leadManagerId !== filterManagerId) return false;

      // Status check
      if (filterStatuses.length > 0) {
        const normalized = getNormalizedStatus(p.status as string);
        if (!filterStatuses.includes(normalized)) return false;
      }

      // Date check
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
  }, [accessibleProjects, filterManagerId, filterStatuses, activeRange, dateFilterType]);

  const previousProjects = useMemo(() => {
    if (!previousRange.start || !previousRange.end) return [];
    return accessibleProjects.filter(p => {
      // Manager check (previous period should respect the same manager filter)
      if (filterManagerId && p.leadManagerId !== filterManagerId) return false;

      // Status check
      if (filterStatuses.length > 0) {
        const normalized = getNormalizedStatus(p.status as string);
        if (!filterStatuses.includes(normalized)) return false;
      }

      if (dateFilterType === 'createdAt') {
        if (!p.createdAt) return false;
        const d = p.createdAt.toDate();
        return d >= previousRange.start! && d <= new Date(previousRange.end!.getTime() + 86400000);
      } else {
        if (!p.deadline) return false;
        const d = p.deadline.toDate ? p.deadline.toDate() : new Date(p.deadline);
        return d >= previousRange.start! && d <= previousRange.end!;
      }
    });
  }, [accessibleProjects, previousRange, filterManagerId, filterStatuses, dateFilterType]);

  const totals = useMemo(() => {
    return filteredProjects.reduce((acc, p) => {
      const f = p.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
      const expenses = (f.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
      const profit = f.contractSum - expenses;
      const bonus = profit * (f.managerPercentage || 0) / 100;
      const netProfit = profit - bonus;

      acc.contractSum += f.contractSum;
      acc.expenses += expenses;
      acc.netProfit += netProfit;
      acc.bonuses += bonus;
      return acc;
    }, { contractSum: 0, expenses: 0, netProfit: 0, bonuses: 0 });
  }, [filteredProjects]);

  const previousTotals = useMemo(() => {
    return previousProjects.reduce((acc, p) => {
      const f = p.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
      const expenses = (f.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
      const profit = f.contractSum - expenses;
      const bonus = profit * (f.managerPercentage || 0) / 100;
      const netProfit = profit - bonus;

      acc.contractSum += f.contractSum;
      acc.expenses += expenses;
      acc.netProfit += netProfit;
      acc.bonuses += bonus;
      return acc;
    }, { contractSum: 0, expenses: 0, netProfit: 0, bonuses: 0 });
  }, [previousProjects]);

  const previousAvgMargin = useMemo(() => {
    return previousTotals.contractSum > 0 ? (previousTotals.netProfit / previousTotals.contractSum) * 100 : 0;
  }, [previousTotals.contractSum, previousTotals.netProfit]);

  const calculateTrend = (curr: number, prev: number) => {
    if (prev === 0) return { val: curr > 0 ? '100' : '0', isPositive: true };
    const diff = ((curr - prev) / prev) * 100;
    return { val: Math.abs(diff).toFixed(1), isPositive: diff >= 0 };
  };

  const avgMargin = useMemo(() => {
    return totals.contractSum > 0 ? (totals.netProfit / totals.contractSum) * 100 : 0;
  }, [totals.contractSum, totals.netProfit]);

  const trends = useMemo(() => ({
    contract: calculateTrend(totals.contractSum, previousTotals.contractSum),
    profit: calculateTrend(totals.netProfit, previousTotals.netProfit),
    expenses: calculateTrend(totals.expenses, previousTotals.expenses),
    bonuses: calculateTrend(totals.bonuses, previousTotals.bonuses),
    margin: {
      diff: avgMargin - previousAvgMargin,
      val: Math.abs(avgMargin - previousAvgMargin).toFixed(0),
      isPositive: (avgMargin - previousAvgMargin) >= 0
    }
  }), [totals, previousTotals, avgMargin, previousAvgMargin]);

  const upcomingItems = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    // Range: today to today + 6 days (total 7 days inclusive)
    const limit = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const items: any[] = [];
    // Only use filtered projects as the source for upcoming items
    const projectMap = new Map<string, Project>(filteredProjects.map(p => [p.id, p]));
    
    console.log(`Analyzing ${allTasks.length} tasks and ${allEvents.length} events for upcoming`);

    allTasks.forEach(t => {
      if (t.completed) return; // Only non-completed
      
      const projectId = t.projectId;
      const project = projectMap.get(projectId);
      if (!project) return; // This filters out tasks from projects not in filteredProjects
      
      let d: Date | null = null;
      if (t.dueDate?.toDate) d = t.dueDate.toDate();
      else if (t.date?.toDate) d = t.date.toDate();
      else if (t.date) d = new Date(t.date);

      if (d && d >= now && d < limit) {
        items.push({
          id: t.id,
          projectId: projectId,
          projectName: project.name,
          managerId: project.leadManagerId || '',
          managerName: project.leadManagerName || '',
          title: t.title,
          type: 'task',
          date: d,
          time: t.time
        });
      }
    });

    allEvents.forEach(e => {
      // Only non-completed (usually 'planned')
      if (e.type === 'completed' || e.type === 'cancelled') return;
      
      const projectId = e.projectId;
      const project = projectMap.get(projectId);
      if (!project) return;
      
      let d: Date | null = null;
      if (e.date?.toDate) d = e.date.toDate();
      else if (typeof e.date === 'string') d = new Date(e.date);

      if (d && d >= now && d < limit) {
        items.push({
          id: e.id,
          projectId: projectId,
          projectName: project.name,
          managerId: project.leadManagerId || '',
          managerName: project.leadManagerName || '',
          title: e.title,
          type: 'event',
          date: d,
          time: e.time
        });
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
      const getDeadlineTime = (p: any) => {
        if (!p.deadline) return 9999999999999;
        return (p.deadline.toDate ? p.deadline.toDate() : new Date(p.deadline)).getTime();
      };
      return getDeadlineTime(a) - getDeadlineTime(b);
    });
    
    const shipping = baseList.filter(p => getNormalizedStatus(p.status as string) === 'shipping').sort((a, b) => {
      const sumA = a.finance?.contractSum || 0;
      const sumB = b.finance?.contractSum || 0;
      return sumB - sumA;
    });
    
    const selected = [...inProgress, ...shipping];
    
    return {
      totalCount: baseList.length,
      displayProjects: selected
    };
  }, [filteredProjects]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser)));
    }, (error) => {
      console.error("Dashboard users snapshot error:", error);
    });
    return () => {
      unsubUsers();
    };
  }, []);

  useEffect(() => {
    if (!appUser) return;
    
    const unsubTasks = onSnapshot(collectionGroup(db, 'tasks'), (snap) => {
      setAllTasks(snap.docs.map(doc => {
        const data = doc.data();
        const parts = doc.ref.path.split('/');
        const projectId = data.projectId || (parts.length >= 2 ? parts[1] : null);
        
        return { 
          id: doc.id, 
          projectId, 
          ...data 
        } as ProjectTask;
      }));
    }, (error) => {
      console.error("Dashboard tasks group snapshot error:", error);
    });
    
    const unsubEvents = onSnapshot(collectionGroup(db, 'events'), (snap) => {
      setAllEvents(snap.docs.map(doc => {
        const data = doc.data();
        const parts = doc.ref.path.split('/');
        const projectId = data.projectId || (parts.length >= 2 ? parts[1] : null);

        return { 
          id: doc.id, 
          projectId, 
          ...data 
        } as ProjectEvent;
      }));
    }, (error) => {
      console.error("Dashboard events group snapshot error:", error);
    });
    
    return () => {
      unsubTasks();
      unsubEvents();
    };
  }, [appUser]);

  useEffect(() => {
    if (!appUser) return;
    
    setLoading(true);
    const isOwner = appUser?.email === '444hanimai@gmail.com';
    const projectsAccess = appUser.projectsAccess || {};
    const projectIds = Object.keys(projectsAccess);
    
    const unsubs: (() => void)[] = [];
    const projectsMap = new Map<string, Project>();

    const updateProjectsState = () => {
      const allProjects = Array.from(projectsMap.values());
      allProjects.sort((a, b) => {
        const dateA = a.updatedAt?.toDate?.() || new Date(0);
        const dateB = b.updatedAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      setProjects(allProjects);
      // Wait for at least one snapshot before setting loading to false if Map has data
      if (projectsMap.size > 0) setLoading(false);
    };
    
    if (isOwner || appUser.fullProjectAccess) {
      // Admins/Full access users see all projects
      const q = query(collection(db, 'projects'), orderBy('updatedAt', 'desc'));
      unsubs.push(onSnapshot(q, (snapshot) => {
        snapshot.docs.forEach(doc => projectsMap.set(doc.id, { id: doc.id, ...doc.data() } as Project));
        updateProjectsState();
        setLoading(false);
      }, (error) => {
        console.error("Dashboard projects admin snapshot error:", error);
      }));
    } else {
      // Regular user: Manager of projects OR Shared explicitly
      
      // 1. Where lead manager
      const qManager = query(collection(db, 'projects'), where('leadManagerId', '==', auth.currentUser?.uid));
      unsubs.push(onSnapshot(qManager, (snapshot) => {
        snapshot.docs.forEach(doc => projectsMap.set(doc.id, { id: doc.id, ...doc.data() } as Project));
        updateProjectsState();
        setLoading(false);
      }, (error) => {
        console.error("Dashboard projects manager snapshot error:", error);
      }));

      // 2. Shared projects
      if (projectIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < projectIds.length; i += 30) {
          chunks.push(projectIds.slice(i, i + 30));
        }

        chunks.forEach(chunk => {
          const q = query(collection(db, 'projects'), where(documentId(), 'in', chunk));
          unsubs.push(onSnapshot(q, (snapshot) => {
            snapshot.docs.forEach(doc => projectsMap.set(doc.id, { id: doc.id, ...doc.data() } as Project));
            updateProjectsState();
            setLoading(false);
          }, (error) => {
            console.error("Dashboard projects shared chunk snapshot error:", error);
          }));
        });
      }
    }

    // Initial timeout to stop loading if no projects found
    const timeout = setTimeout(() => {
      if (projectsMap.size === 0) setLoading(false);
    }, 2000);

    return () => {
      clearTimeout(timeout);
      unsubs.forEach(u => u());
    };
  }, [appUser?.uid, appUser?.fullProjectAccess]); // Use specific fields to avoid re-runs on every update

  const conversion = useMemo(() => {
    // s1: in_progress or shipping
    const s1 = filteredProjects.filter(p => {
      const norm = getNormalizedStatus(p.status as string);
      return norm === 'in_progress' || norm === 'shipping';
    }).length;
    // s2: shipping
    const s2 = filteredProjects.filter(p => getNormalizedStatus(p.status as string) === 'shipping').length;
    
    if (s1 === 0) return 0;
    return Math.round((s2 * 100) / s1);
  }, [filteredProjects]);

  const avgDuration = useMemo(() => {
    const relevantProjects = filteredProjects.filter(p => p.createdAt && p.completedAt);
    if (relevantProjects.length === 0) return 0;

    const totalWeeks = relevantProjects.reduce((sum, p) => {
      const start = p.createdAt.toDate().getTime();
      const end = p.completedAt.toDate ? p.completedAt.toDate().getTime() : new Date(p.completedAt).getTime();
      const diffWeeks = (end - start) / (1000 * 60 * 60 * 24 * 7);
      return sum + diffWeeks;
    }, 0);

    const avg = totalWeeks / relevantProjects.length;
    return Math.ceil(avg);
  }, [filteredProjects]);

  const overdueCount = useMemo(() => {
    const now = new Date().getTime();
    return filteredProjects.filter(p => {
      if (!p.deadline) return false;
      const deadlineDate = p.deadline.toDate ? p.deadline.toDate().getTime() : new Date(p.deadline).getTime();
      if (p.status === 'completed' && p.completedAt) {
        const completedDate = p.completedAt.toDate ? p.completedAt.toDate().getTime() : new Date(p.completedAt).getTime();
        return completedDate > deadlineDate;
      }
      if (p.status === 'active') {
        return now > deadlineDate;
      }
      return false;
    }).length;
  }, [filteredProjects]);

  if (loading) return (
    <div className="h-96 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-[#c4a483] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (appUser?.requireFinanceCode && !isUnlocked) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <CodeProtection 
          correctCode={appUser.financeCode || ''} 
          onSuccess={() => setIsUnlocked(true)} 
          title="Защита модуля Дашборд"
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Filters Area */}
      <div 
        className="px-[18px] py-3 bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] flex items-center justify-between gap-4 overflow-visible mb-4" 
        style={{ overflow: 'visible' }}
      >
        <div className="flex items-center gap-4 overflow-visible">
          <PeriodSelector 
            label="ПЕРИОД"
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            start={activeRange.start}
            end={activeRange.end}
          />

          <div className="h-6 w-px bg-line mx-1" />

          <DateTypeSelector 
            value={dateFilterType}
            onChange={setDateFilterType}
          />
          <StatusSelector 
            values={filterStatuses}
            onChange={setFilterStatuses}
          />
          <ManagerSelector 
            value={filterManagerId}
            onChange={setFilterManagerId}
            users={users}
          />
        </div>

        <Button 
          variant="soft"
          size="sm"
          className="h-9 px-4 text-[13px] font-semibold shrink-0"
          icon={<Download size={14} />}
          onClick={() => { /* TODO: реализовать экспорт */ }}
        >
          Экспорт
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] gap-4">
        <SummaryCard 
          title="СУММА КОНТРАКТОВ" 
          value={totals.contractSum} 
          isDark 
          trendVal={trends.contract.val} 
          isPositive={trends.contract.isPositive} 
          customPath="M0,25 L15,22 L32,25 L45,18 L58,20 L70,12 L82,15 L92,5 L100,5" 
        />
        <SummaryCard 
          title="ЧИСТАЯ ПРИБЫЛЬ" 
          value={totals.netProfit} 
          trendVal={trends.profit.val} 
          isPositive={trends.profit.isPositive} 
          color="#2f5e3f" 
          customPath="M0,24 L10,22 L20,26 L35,22 L50,18 L65,20 L80,12 L90,14 L100,8" 
        />
        <SummaryCard 
          title="РАСХОДЫ" 
          value={totals.expenses} 
          trendVal={trends.expenses.val} 
          isPositive={trends.expenses.isPositive} 
          color="#8a3f47" 
          customPath="M0,18 L12,22 L25,16 L38,20 L50,14 L62,18 L75,12 L88,16 L100,10" 
        />
        <SummaryCard 
          title="БОНУСЫ МЕНЕДЖЕРОВ" 
          value={totals.bonuses} 
          trendVal={trends.bonuses.val} 
          isPositive={trends.bonuses.isPositive} 
          color="#b07a2c" 
          customPath="M0,26 L15,24 L30,22 L45,20 L60,18 L75,15 L90,12 L100,10" 
        />
        <SummaryCard 
          title="СРЕДНЯЯ МАРЖА" 
          value={avgMargin} 
          isPercentage 
          trendVal={trends.margin.val} 
          isPositive={trends.margin.isPositive} 
          color="#1f1c14" 
          customPath="M0,22 L15,18 L35,24 L55,20 L75,22 L90,12 L100,8" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* АКТИВНЫЕ ПРОЕКТЫ — без Card, всё inline */}
        <div className="lg:col-span-8">
          <div className="h-full bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col">
            <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
              <h3 className="font-display text-[17px] font-medium text-ink leading-tight flex items-baseline gap-2">
                <span>Активные проекты</span>
                <span className="text-[12px] text-ink-3 font-normal">· {activeProjectsInfo.totalCount}</span>
              </h3>
              <button
                onClick={onViewAllProjects}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-ink-2 hover:bg-surface-2 transition-colors"
              >
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
                    isFirst={idx === 0}
                    onClick={() => onSelectProject(project.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* БЛИЖАЙШИЕ ЗАДАЧИ — без Card, всё inline */}
        <div className="lg:col-span-4">
          <div className="h-full bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col">
            <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
              <h3 className="font-display text-[17px] font-medium text-ink leading-tight flex items-baseline gap-2">
                <span>Ближайшие задачи</span>
                {upcomingItems.length > 0 && (
                  <span className="text-[12px] text-ink-3 font-normal">· {upcomingItems.length}</span>
                )}
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
                    <button
                      key={item.id}
                      onClick={() => (item.type === 'task' && onSelectTask) ? onSelectTask(item.projectId, item.id) : onSelectProject(item.projectId)}
                      className={cn(
                        "w-full px-5 py-3 flex items-center gap-4 hover:bg-surface-2 text-left group transition-colors",
                        idx > 0 && "border-t border-line"
                      )}
                    >
                      {/* Дата: число + месяц + день недели */}
                      <div className="w-9 flex flex-col items-center shrink-0">
                        <span className="font-display text-[20px] font-normal text-ink leading-none tabular-nums">{day}</span>
                        <span className="text-[9.5px] font-semibold tracking-[0.14em] text-ochre uppercase mt-1 leading-none">{month}</span>
                        <span className="text-[9px] font-semibold tracking-[0.14em] text-ink-4 uppercase mt-[3px] leading-none">{weekday}</span>
                      </div>

                      {/* Заголовок + метаданные */}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13px] font-semibold text-ink leading-snug truncate">{item.title}</h4>
                        <p className="text-[11.5px] text-ink-3 truncate mt-1">
                          {item.time && <span className="tabular-nums">{item.time}</span>}
                          {item.time && item.projectName && <span className="text-ink-4"> · </span>}
                          {item.projectName}
                        </p>
                      </div>

                      {/* Аватар менеджера */}
                      <UserAvatar uid={item.managerId} name={item.managerName} size="sm" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-4">
        {/* ВОРОНКА — без компонента Card, всё inline */}
        <div className="lg:col-span-6">
          <div className="h-full bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] px-5 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Воронка проектов</h3>
              <span className="text-[11.5px] text-ink-3">по сумме контрактов</span>
            </div>
            <ProjectFunnel projects={filteredProjects} />
          </div>
        </div>

        {/* АНАЛИТИКА — без компонента Card, всё inline */}
        <div className="lg:col-span-6">
          <div className="h-full bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Аналитика</h3>
              <span className="text-[11.5px] text-ink-3">за выбранный период</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {/* Конверсия */}
              <div className="rounded-[10px] bg-surface-2 px-4 py-3.5 flex flex-col gap-2 min-h-[100px]">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 leading-snug">
                  Конверсия «В&nbsp;работе» → «Отгрузки»
                </p>
                <p className="font-display text-[30px] font-normal text-ink tabular-nums leading-none mt-auto">
                  {conversion}<span className="text-[18px] opacity-60">%</span>
                </p>
              </div>

              {/* Средний цикл */}
              <div className="rounded-[10px] bg-surface-2 px-4 py-3.5 flex flex-col gap-2 min-h-[100px]">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 leading-snug">
                  Средний цикл
                </p>
                <div className="flex items-baseline gap-1.5 mt-auto">
                  <p className="font-display text-[30px] font-normal text-ink tabular-nums leading-none">{avgDuration}</p>
                  <span className="font-display text-[14px] italic text-ink-3">нед.</span>
                </div>
              </div>

              {/* Просрочено */}
              <div className="rounded-[10px] bg-surface-2 px-4 py-3.5 flex flex-col gap-2 min-h-[100px]">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 leading-snug">
                  Просрочено
                </p>
                <p className="font-display text-[30px] font-normal tabular-nums leading-none mt-auto" style={{ color: 'var(--terracotta)' }}>
                  {overdueCount}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ProjectFunnel({ projects }: { projects: Project[] }) {
  const funnelData = useMemo(() => {
    const cats = [
      { key: 'in_progress', label: 'В работе',  color: '#3b4a55' },
      { key: 'shipping',    label: 'Отгрузки',  color: '#5a6b3c' },
      { key: 'done',        label: 'Завершён',  color: '#2f5e3f' },
      { key: 'canceled',    label: 'Отменён',   color: '#a04930' },
    ];
    const stats = projects.reduce((acc, p) => {
      const norm = getNormalizedStatus(p.status as string);
      acc[norm].count += 1;
      acc[norm].sum += p.finance?.contractSum || 0;
      return acc;
    }, { in_progress: { count: 0, sum: 0 }, shipping: { count: 0, sum: 0 }, done: { count: 0, sum: 0 }, canceled: { count: 0, sum: 0 } });
    const maxSum = Math.max(...Object.values(stats).map((s: any) => s.sum), 1);
    return cats.map(c => ({
      ...c, ...stats[c.key as keyof typeof stats],
      percentage: (stats[c.key as keyof typeof stats].sum / maxSum) * 100
    }));
  }, [projects]);

  const fSum = (v: number) =>
    v >= 1000000 ? `${(v / 1000000).toFixed(1).replace('.0', '')} млн ₽`
    : v >= 1000   ? `${(v / 1000).toFixed(0)} тыс ₽`
    : `${v} ₽`;

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
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${barPct}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="absolute inset-y-0 left-0 h-6 max-h-6 rounded-[5px] flex items-center overflow-hidden px-2.5"
                  style={{ backgroundColor: it.color, opacity: it.sum > 0 ? 1 : 0.35 }}
                >
                  {showInside && (
                    <span className="text-[11px] leading-none font-semibold text-white whitespace-nowrap tabular-nums">
                      {fSum(it.sum)}
                    </span>
                  )}
                </motion.div>
              </div>
              {!showInside && it.sum > 0 && (
                <span
                  className="absolute top-1/2 -translate-y-1/2 text-[11px] leading-none font-semibold text-ink-2 whitespace-nowrap tabular-nums pointer-events-none"
                  style={{ left: `calc(${barPct}% + 8px)` }}
                >
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

function SummaryCard({ title, value, isDark, isPercentage, trendVal, isPositive, color, customPath }: any) {
  const formatVal = (v: number) => {
    if (isPercentage) return { num: `${v.toFixed(0)}%`, unit: '' };
    if (v >= 1000000) return { num: (v / 1000000).toFixed(1).replace('.0', ''), unit: 'млн\u00a0₽' };
    if (v >= 1000)    return { num: (v / 1000).toFixed(0), unit: 'тыс\u00a0₽' };
    return { num: `${v.toFixed(0)}`, unit: '₽' };
  };
  const { num, unit } = formatVal(value);

  const defaultPath = customPath || "M0,25 L15,22 L30,26 L45,18 L60,20 L75,12 L90,15 L100,5";
  const areaPath = `${defaultPath} L100,30 L0,30 Z`;
  const gradId = React.useMemo(
    () => `grad-${Math.random().toString(36).slice(2, 10)}`,
    []
  );

  /* ───── DARK PRIMARY CARD ───── */
  if (isDark) {
    return (
      <div 
        className="rounded-2xl flex flex-col gap-3 h-full p-[20px_22px] relative overflow-hidden"
        style={{ 
          background: 'linear-gradient(135deg, var(--ink) 0%, #2a2618 100%)',
          color: 'var(--bg)',
          border: '1px solid #2a2618'
        }}
      >
        <p 
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" 
          style={{ color: 'rgba(245,233,204,0.6)' }}
        >
          {title}
        </p>

        <div className="flex items-baseline gap-2">
          <span className="font-display text-[38px] leading-[1.05] tabular-nums">{num}</span>
          {unit && <span className="font-display text-[15px] opacity-70">{unit}</span>}
        </div>

        <div className="flex items-end justify-between mt-auto gap-3">
          <div className="inline-flex items-baseline gap-1.5 text-[12px] font-semibold flex-wrap" style={{ color: '#e9d6ad' }}>
            {isPositive 
              ? <ArrowUpRight size={13} className="self-center" /> 
              : <TrendingDown size={13} className="self-center" />}
            <span>{isPositive ? '+' : '-'}{trendVal}%</span>
            <span className="opacity-70 font-normal text-[11.5px]">к прошлому периоду</span>
          </div>
          <div className="w-[110px] h-8 shrink-0">
            <svg className="w-full h-full" viewBox="0 0 100 30" preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#d39a4d" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#d39a4d" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill={`url(#${gradId})`} />
              <path d={defaultPath} fill="none" stroke="#d39a4d" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
    );
  }

  /* ───── REGULAR LIGHT CARD ───── */
  const trendColor = isPositive ? '#2f5e3f' : 'var(--terracotta)';

  return (
    <div className="bg-surface border border-line rounded-2xl flex flex-col gap-2.5 h-full p-[18px_20px] shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">{title}</p>

      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span 
            className="font-display text-[34px] leading-[1.05] tabular-nums truncate" 
            style={{ color }}
          >
            {num}
          </span>
          {unit && (
            <span className="font-display text-[14px] opacity-70 shrink-0" style={{ color }}>
              {unit}
            </span>
          )}
        </div>
        <div 
          className="inline-flex items-center gap-1 text-[12px] font-semibold shrink-0" 
          style={{ color: trendColor }}
        >
          {isPositive ? <ArrowUpRight size={13} /> : <TrendingDown size={13} />}
          <span>{isPositive ? '+' : '-'}{trendVal}%</span>
        </div>
      </div>

      <div className="h-8 w-full">
        <svg className="w-full h-full" viewBox="0 0 100 30" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={defaultPath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>

      <p className="text-[11.5px] text-ink-3 mt-0.5">к прошлому периоду</p>
    </div>
  );
}

function ProjectFinancialBlock({ project, onClick, isFirst }: { key?: any; project: any; onClick: () => void; isFirst?: boolean }) {
  const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
  const totalExpenses = (f.expenses || []).reduce((acc: number, e: any) => acc + (e.amount || 0), 0);
  const profit = f.contractSum - totalExpenses;
  const netProfit = profit - (profit * (f.managerPercentage || 0) / 100);
  const profitability = f.contractSum > 0 ? (netProfit / f.contractSum) * 100 : 0;

  const shippingProgress = getShippingProgress(project);

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
    if (val >= 1000000) {
      const num = val / 1000000;
      return { main: num % 1 === 0 ? num.toFixed(0) : num.toFixed(1), unit: 'млн ₽' };
    }
    if (val >= 1000) return { main: `${(val / 1000).toFixed(0)}`, unit: 'тыс ₽' };
    return { main: `${val}`, unit: '₽' };
  };
  const contract = formatSum(f.contractSum);
  const marginColor = profitability >= 25 ? '#2f5e3f' : profitability >= 10 ? 'var(--ochre)' : 'var(--terracotta)';

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full grid items-center gap-4 px-5 py-3 hover:bg-surface-2 text-left group transition-colors",
        !isFirst && "border-t border-line"
      )}
      style={{ gridTemplateColumns: '1fr 105px minmax(150px, 1fr) 80px 30px 16px' }}
    >
      {/* Статус + название + клиент */}
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
        <h4 className="font-display text-[17px] font-normal text-ink leading-[1.15] tracking-[-0.005em] truncate group-hover:text-ochre transition-colors">
          {project.name}
        </h4>
        <p className="text-[11.5px] text-ink-3 truncate mt-0.5">{project.client}</p>
      </div>

      {/* Контракт */}
      <div>
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Контракт</p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="font-display text-[16px] tabular-nums text-ink leading-none">{contract.main}</span>
          <span className="text-[10.5px] text-ink-3">{contract.unit}</span>
        </div>
      </div>

      {/* Прогресс */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-[5px]">
          <span className="text-[10.5px] text-ink-3 shrink-0">Отгружено</span>
          <span className="text-[10px] font-semibold text-ink tabular-nums text-right leading-tight">
            {formatShippingProgressLabel(shippingProgress)}
          </span>
        </div>
        <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              !shippingProgress.isComplete && "bg-ochre"
            )}
            style={{
              width: `${shippingProgress.barPercent}%`,
              ...(shippingProgress.isComplete ? { backgroundColor: SHIPPING_PROGRESS_COMPLETE_COLOR } : {}),
            }}
          />
        </div>
      </div>

      {/* Маржа */}
      <div className="text-right">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">Маржа</p>
        <p className="font-display text-[20px] leading-none mt-0.5 tabular-nums" style={{ color: marginColor }}>
          {profitability.toFixed(0)}%
        </p>
      </div>

      {/* Аватар */}
      <UserAvatar uid={project.leadManagerId || ''} name={project.leadManagerName || '—'} size="sm" />

      {/* Шеврон */}
      <ChevronRight size={14} className="text-ink-3 justify-self-end" />
    </button>
  );
}




