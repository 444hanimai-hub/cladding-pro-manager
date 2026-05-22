import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, doc, updateDoc, documentId, deleteDoc, doc as fireDoc, collectionGroup } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  MapPin, 
  User as UserIcon, 
  LayoutGrid, 
  List as ListIcon,
  X,
  Briefcase,
  Trash2,
  Users,
  ChevronRight,
  ChevronDown,
  Clock,
  Calendar,
  ListFilter,
  Search,
  CheckCircle2,
  Circle,
  TrendingDown
} from 'lucide-react';
import { formatCurrency, cn, formatDateToDisplay } from '../lib/utils';
import CompanySelect from './CompanySelect';
import { DatePicker } from './ui/DatePicker';
import UserAvatar from './UserAvatar';
import StatusPill from './StatusPill';
import { Card } from './ui/Card';
import { Pill } from './ui/Pill';
import { Progress } from './ui/Progress';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { 
  PeriodSelector, 
  DateTypeSelector, 
  StatusSelector, 
  ManagerSelector,
  PeriodType 
} from './shared/DashboardFilters';

import { OperationType, handleFirestoreError } from '../lib/firestore-errors';
import { Project, AppUser, ProjectTask, ProjectEvent } from '../types';

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
  if (period === 'year') {
    return `${start.getFullYear()}г.`;
  }
  const f = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}

interface ProjectListProps {
  onSelectProject: (id: string) => void;
  appUser: AppUser | null;
}

export default function ProjectList({ onSelectProject, appUser }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<ProjectTask[]>([]);
  const [allEvents, setAllEvents] = useState<ProjectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [users, setUsers] = useState<AppUser[]>([]);

  // Period Filters
  const [dateFilterType, setDateFilterType] = useState<'createdAt' | 'deadline'>('createdAt');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('year');
  const [filterManagerId, setFilterManagerId] = useState('');
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const isInitialized = React.useRef(false);

  const activeRange = useMemo(() => getPeriodRange(selectedPeriod), [selectedPeriod]);

  // Persist filters to localStorage
  useEffect(() => {
    if (!appUser?.uid || isInitialized.current) return;
    const saved = localStorage.getItem(`projectListFilters_${appUser.uid}`);
    if (saved) {
      try {
        const filters = JSON.parse(saved);
        if (filters.dateFilterType) setDateFilterType(filters.dateFilterType);
        if (filters.selectedPeriod) setSelectedPeriod(filters.selectedPeriod);
        if (filters.filterManagerId !== undefined) setFilterManagerId(filters.filterManagerId);
        if (filters.filterStatuses) setFilterStatuses(filters.filterStatuses);
        if (filters.searchQuery !== undefined) setSearchQuery(filters.searchQuery);
      } catch (e) {
        console.error("Error loading saved filters:", e);
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
      filterStatuses,
      searchQuery
    };
    localStorage.setItem(`projectListFilters_${appUser.uid}`, JSON.stringify(filters));
  }, [dateFilterType, selectedPeriod, filterManagerId, filterStatuses, searchQuery, appUser?.uid]);

  useEffect(() => {
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
    }, (error) => {
      console.error("ProjectList tasks group snapshot error:", error);
    });

    const unsubEvents = onSnapshot(collectionGroup(db, 'events'), (snap) => {
      setAllEvents(snap.docs.map(doc => {
        const data = doc.data();
        const parts = doc.ref.path.split('/');
        const projectId = data.projectId || (parts.length >= 2 ? parts[1] : null);
        return { id: doc.id, projectId, ...data } as ProjectEvent;
      }));
    }, (error) => {
      console.error("ProjectList events group snapshot error:", error);
    });
    
    return () => {
      unsubTasks();
      unsubEvents();
    };
  }, [appUser?.uid]);

  useEffect(() => {
    if (!appUser) return;
    
    setLoading(true);
    const projectsAccess = appUser.projectsAccess || {};
    const projectIds = Object.keys(projectsAccess);
    
    const isOwner = appUser?.email === '444hanimai@gmail.com';
    
    // Admin/Global access check (Owner or fullProjectAccess)
    if (isOwner || appUser.fullProjectAccess) {
      const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        let fetchedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
        
        // Sorting
        fetchedProjects.sort((a, b) => {
          const dateA = a.createdAt?.toDate?.() || new Date(0);
          const dateB = b.createdAt?.toDate?.() || new Date(0);
          return dateB.getTime() - dateA.getTime();
        });
        
        setProjects(fetchedProjects);
        setLoading(false);
      }, (error) => {
        console.error("Projects list admin error:", error);
        setLoading(false);
      });
      return () => unsubscribe();
    }

    // For non-admins, we need to handle projects where the user is lead manager
    // OR projects specifically shared with them via projectsAccess.
    // Since we can't do OR across documentId and fields, we use multiple listeners.
    
    const unsubs: (() => void)[] = [];
    const projectsMap = new Map<string, Project>();

    const updateProjectsState = () => {
      const fetchedProjects = Array.from(projectsMap.values());
      fetchedProjects.sort((a, b) => {
        const dateA = a.createdAt?.toDate?.() || new Date(0);
        const dateB = b.createdAt?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      setProjects(fetchedProjects);
      setLoading(false);
    };

    // 1. Projects where user is lead manager
    const q1 = query(collection(db, 'projects'), where('leadManagerId', '==', auth.currentUser?.uid));
    unsubs.push(onSnapshot(q1, (snapshot) => {
      snapshot.docs.forEach(doc => projectsMap.set(doc.id, { id: doc.id, ...doc.data() } as Project));
      updateProjectsState();
    }, (error) => {
      console.error("ProjectList manager projects snapshot error:", error);
      setLoading(false);
    }));

    // 2. Projects in projectsAccess (handling the 30-item limit per query)
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
        }, (error) => {
          console.error("ProjectList shared chunk projects snapshot error:", error);
          setLoading(false);
        }));
      });
    }

    // Initial timeout to stop loading if no projects found
    const timeout = setTimeout(() => {
      if (projectsMap.size === 0) setLoading(false);
    }, 2000);

    return () => {
      clearTimeout(timeout);
      unsubs.forEach(u => u());
    };
  }, [appUser?.uid, appUser?.fullProjectAccess, JSON.stringify(appUser?.projectsAccess)]);

  const isOwner = appUser?.email === '444hanimai@gmail.com';

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOwner) {
      alert('Только владелец может удалять проекты');
      return;
    }
    if (window.confirm('Вы уверены, что хотите удалить проект? Это действие нельзя отменить.')) {
      try {
        await deleteDoc(fireDoc(db, 'projects', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'projects/' + id);
      }
    }
  };

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
      // Search check
      if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !p.client.toLowerCase().includes(searchQuery.toLowerCase())) return false;

      // Manager check
      if (filterManagerId && p.leadManagerId !== filterManagerId) return false;

      // Status check
      if (filterStatuses.length > 0) {
        const raw = p.status as string;
        const normalized = 
          raw === 'lead' || raw === 'active' || raw === 'in_progress' ? 'in_progress' :
          raw === 'completed' || raw === 'done' ? 'done' :
          raw === 'cancelled' || raw === 'canceled' ? 'canceled' :
          raw === 'shipping' ? 'shipping' : 'in_progress';
        if (!filterStatuses.includes(normalized)) return false;
      }

      // Range check
      if (activeRange.start && activeRange.end) {
        if (dateFilterType === 'createdAt') {
          if (!p.createdAt) return false;
          const d = p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
          if (d < activeRange.start || d > new Date(activeRange.end.getTime() + 86400000)) return false;
        } else {
          if (!p.deadline) return false;
          const d = p.deadline.toDate ? p.deadline.toDate() : new Date(p.deadline);
          if (d < activeRange.start || d > activeRange.end) return false;
        }
      }

      return true;
    });
  }, [accessibleProjects, filterManagerId, filterStatuses, activeRange, dateFilterType, searchQuery]);

  const canEditProject = (project: Project) => {
    if (isOwner) return true;
    if (appUser?.fullProjectAccess) return true;
    if (appUser?.projectsAccess?.[project.id] === 'edit') return true;
    if (project.leadManagerId === auth.currentUser?.uid) return true;
    return false;
  };

  const hasFinanceAccess = isOwner || appUser?.accessDashboard === true;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      <div className="space-y-4">
        {/* Filters Area */}
        <div 
          className="px-[18px] py-3 bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] flex items-center justify-between gap-4 overflow-visible" 
          style={{ overflow: 'visible' }}
        >
          <div className="flex items-center gap-4 overflow-visible">
            <div className="flex items-center gap-4">
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
          </div>

          <div className="flex items-center gap-4">
            <Button 
              onClick={() => setShowAddForm(true)}
              variant="ochre"
              size="sm"
              className="h-9 px-4 text-[13px] font-semibold shrink-0"
              icon={<Plus size={14} />}
            >
              Новый проект
            </Button>

            <div className="flex items-center bg-surface-2 rounded-lg p-0.5">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-md transition-all",
                  viewMode === 'grid' 
                    ? "bg-surface text-ink shadow-sm" 
                    : "text-ink-4 hover:text-ink-2 hover:bg-white/40"
                )}
              >
                <LayoutGrid size={15} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-md transition-all",
                  viewMode === 'list' 
                    ? "bg-surface text-ink shadow-sm" 
                    : "text-ink-4 hover:text-ink-2 hover:bg-white/40"
                )}
              >
                <ListIcon size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="aspect-[4/3] animate-pulse rounded-lg bg-surface border border-line" />)}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 rounded-lg border border-dashed border-line bg-surface">
          <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-6 text-ink-4">
            <Briefcase size={32} />
          </div>
          <h3 className="text-xl font-display font-medium text-ink mb-2">Проектов не найдено</h3>
          <p className="text-sm text-ink-3 mb-8">Попробуйте изменить параметры фильтрации или поиска</p>
          <Button variant="ochre" onClick={() => { setSearchQuery(''); setFilterStatuses([]); setFilterManagerId(''); setSelectedPeriod('all'); }}>
            Сбросить фильтры
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-[14px]">
          {filteredProjects.map((project) => (
            <ProjectCard 
              key={project.id} 
              project={project} 
              allTasks={allTasks}
              allEvents={allEvents}
              hasFinanceAccess={hasFinanceAccess}
              onClick={() => onSelectProject(project.id)} 
              canDelete={isOwner}
              onDelete={(e) => deleteProject(project.id, e)}
            />
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="px-7 py-4 text-eyebrow text-ink-3">Проект</th>
                  <th className="px-7 py-4 text-eyebrow text-ink-3">Заказчик</th>
                  <th className="px-7 py-4 text-eyebrow text-ink-3">Статус</th>
                  <th className="px-7 py-4 text-eyebrow text-ink-3">Контракт</th>
                  <th className="px-7 py-4 text-eyebrow text-ink-3 text-right">Маржа</th>
                  <th className="px-7 py-4 text-eyebrow text-ink-3">Куратор</th>
                  <th className="px-7 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredProjects.map((project) => {
                  const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
                  const totalExpenses = (f.expenses || []).reduce((acc, exp) => acc + (exp.amount || 0), 0);
                  const profitability = f.contractSum > 0 ? ((f.contractSum - totalExpenses) / f.contractSum) * 100 : 0;

                  return (
                    <tr 
                      key={project.id} 
                      onClick={() => onSelectProject(project.id)}
                      className="cursor-pointer transition-colors group hover:bg-surface-2"
                    >
                      <td className="px-7 py-5">
                        <h4 className="font-semibold text-base text-ink group-hover:text-ochre transition-colors truncate mb-1">{project.name}</h4>
                        <p className="text-xs text-ink-3 truncate max-w-xs">{project.address}</p>
                      </td>
                      <td className="px-7 py-5 text-sm text-ink-2 font-medium">{project.client}</td>
                      <td className="px-7 py-5">
                        <StatusPill status={project.status as any} />
                      </td>
                      <td className="px-7 py-5 text-sm font-display font-medium text-ink">
                        {formatCurrency(f.contractSum).split(',')[0]} <span className="text-[10px] opacity-40 italic">₽</span>
                      </td>
                      <td className={cn(
                        "px-7 py-5 text-lg font-display text-right",
                        profitability > 25 ? "text-profit" : profitability > 15 ? "text-ochre" : "text-expense"
                      )}>
                        {profitability.toFixed(0)}%
                      </td>
                      <td className="px-7 py-5">
                        <div className="flex items-center gap-2">
                          <UserAvatar 
                            uid={project.leadManagerId || ''} 
                            name={project.leadManagerName || '—'} 
                            size="sm" 
                          />
                          <span className="text-xs font-semibold text-ink-3">{project.leadManagerName}</span>
                        </div>
                      </td>
                      <td className="px-7 py-5 text-right">
                        <ChevronRight size={16} className="text-ink-4 group-hover:text-ink transition-colors" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AnimatePresence>
        {showAddForm && (
          <ProjectForm 
            onClose={() => setShowAddForm(false)} 
            onCreated={(id) => {
              setShowAddForm(false);
              onSelectProject(id);
            }} 
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ProjectCard({ 
  project, 
  allTasks, 
  allEvents,
  hasFinanceAccess,
  onClick, 
  canDelete, 
  onDelete
}: { 
  key?: any;
  project: Project; 
  allTasks: ProjectTask[]; 
  allEvents: ProjectEvent[];
  hasFinanceAccess: boolean;
  onClick: () => void;
  canDelete: boolean;
  onDelete: (e: React.MouseEvent) => void | Promise<void>;
}) {
  const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
  const projectTasks = allTasks.filter(t => t.projectId === project.id);
  const readiness = projectTasks.length > 0 
    ? Math.round((projectTasks.filter(t => t.completed).length / projectTasks.length) * 100)
    : (project.status === 'completed' ? 100 : 0);

  const nextItem = useMemo(() => {
    const now = new Date();
    const items = [
      ...allTasks.filter(t => t.projectId === project.id && !t.completed && (t.dueDate || t.date)),
      ...allEvents.filter(e => e.projectId === project.id && e.type === 'planned')
    ].map(item => {
      let d: Date;
      if ('dueDate' in item) d = item.dueDate?.toDate ? item.dueDate.toDate() : new Date(item.dueDate || item.date || '');
      else d = item.date?.toDate ? item.date.toDate() : new Date(item.date || '');
      return { ...item, parsedDate: d };
    });

    return items
      .filter(i => i.parsedDate >= now)
      .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime())[0];
  }, [project.id, allTasks, allEvents]);

  const daysInfo = useMemo(() => {
    if (project.status === 'completed' && project.completedAt) {
      const date = project.completedAt.toDate ? project.completedAt.toDate() : new Date(project.completedAt);
      return { text: `сдан ${date.toLocaleDateString('ru-RU')}`, isOverdue: false };
    }
    if (project.status === 'cancelled') return { text: 'отменён', isOverdue: false };
    if (!project.deadline) return null;
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const deadline = project.deadline.toDate ? project.deadline.toDate() : new Date(project.deadline);
    deadline.setHours(0, 0, 0, 0);
    const diff = deadline.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    if (days < 0) return { text: `${Math.abs(days)} дн. просрочка`, isOverdue: true };
    return { text: `${days} дн. до сдачи`, isOverdue: false };
  }, [project.status, project.completedAt, project.deadline]);

  const formatSumValue = (val: number) => {
    if (val >= 1000000) {
      const num = val / 1000000;
      return `${num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)} млн ₽`;
    }
    if (val >= 1000) {
      const num = val / 1000;
      return `${num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)} тыс ₽`;
    }
    return `${val} ₽`;
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col gap-[14px] cursor-pointer group rounded-2xl bg-surface h-full transition-all shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] hover:-translate-y-0.5 hover:shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_8px_24px_-8px_rgba(48,42,28,0.18)]",
        daysInfo?.isOverdue
          ? "border border-line border-l-[3px] border-l-terracotta pl-[18px] pr-5 py-[18px]"
          : "border border-line px-5 py-[18px]"
      )}
    >
      {/* 4.1. Статус и срок */}
      <div className="flex items-center justify-between gap-3">
        <StatusPill status={project.status as any} />
        {daysInfo && (
          <div className={cn(
            "text-[11px] font-medium flex items-center gap-1",
            daysInfo.isOverdue ? "text-terracotta font-semibold" : "text-ink-3"
          )}>
            {daysInfo.isOverdue && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L1 21h22L12 2zm0 3.45L20.21 19H3.79L12 5.45zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
              </svg>
            )}
            {daysInfo.text}
          </div>
        )}
      </div>

      {/* 4.2. Название и адрес */}
      <div>
        <h3 className="text-[22px] font-display font-normal text-ink leading-[1.1] tracking-[-0.01em] group-hover:text-ochre transition-colors truncate">
          {project.name}
        </h3>
        <div className="flex items-center gap-1.5 mt-1 text-ink-3">
          <MapPin size={12} className="text-ink-3 shrink-0" />
          <span className="text-[12.5px] truncate">{project.address}</span>
        </div>
      </div>

      {/* 4.3. Заказчик и Контракт */}
      <div className="flex justify-between items-end gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[9.5px] font-semibold text-ink-3 uppercase tracking-[0.14em]">ЗАКАЗЧИК</span>
          <span className="text-[13px] font-semibold text-ink leading-tight mt-0.5 truncate">{project.client}</span>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="text-[9.5px] font-semibold text-ink-3 uppercase tracking-[0.14em]">КОНТРАКТ</span>
          <span className="text-[17px] font-display font-normal text-ink leading-[1.1] mt-0.5 tabular-nums">
            {formatSumValue(f.contractSum)}
          </span>
        </div>
      </div>

      {/* 4.4. Прогресс */}
      <div>
        <div className="flex justify-between items-end mb-1.5">
          <span className="text-[11px] text-ink-3">Отгружено</span>
          <span className="text-[11.5px] font-semibold text-ink tabular-nums">{readiness}%</span>
        </div>
        <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
          <div 
            className="h-full bg-ochre rounded-full transition-all duration-700" 
            style={{ width: `${readiness}%` }}
          />
        </div>
      </div>

      {/* 4.5. Ближайшая задача (или заглушка) */}
      {nextItem ? (
        <div className="py-[10px] px-3 bg-surface-2 rounded-lg border-l-2 border-ochre">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 size={11} className="text-ochre" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ochre">БЛИЖАЙШАЯ ЗАДАЧА</span>
          </div>
          <p className="text-[12.5px] font-medium text-ink leading-[1.35] truncate">{nextItem.title}</p>
          <div className="text-[11px] text-ink-3 mt-0.5">
            {nextItem.date || nextItem.parsedDate.toLocaleDateString('ru-RU')}
          </div>
        </div>
      ) : (
        <div className="h-[74px] flex items-center justify-center border border-dashed border-line rounded-lg bg-surface-2/30">
          <p className="text-[10px] font-medium text-ink-4 uppercase tracking-widest opacity-40">Задач нет</p>
        </div>
      )}

      {/* 4.6. Менеджер */}
      <div className="pt-3 mt-auto border-t border-line flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <UserAvatar 
            uid={project.leadManagerId || ''} 
            name={project.leadManagerName || ''} 
            size="xs" 
          />
          <span className={cn(
            "text-[12.5px] truncate",
            project.leadManagerName
              ? "font-medium text-ink"
              : "italic text-ink-3 font-normal"
          )}>
            {project.leadManagerName || 'Не назначен'}
          </span>
        </div>
        <ChevronRight size={14} className="text-ink-3 group-hover:translate-x-0.5 transition-transform shrink-0" />
      </div>
    </div>
  );
}

function ProjectForm({ onClose, onCreated }: { onClose: () => void, onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [address, setAddress] = useState('');
  const [deadline, setDeadline] = useState('');
  const [creationDate, setCreationDate] = useState(new Date().toISOString().split('T')[0]);
  const [contractSum, setContractSum] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<Record<string, 'view' | 'edit'>>({});
  const [leadManagerId, setLeadManagerId] = useState<string>('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const allUsers = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser));
      setUsers(allUsers);
      if (!leadManagerId && auth.currentUser) {
        setLeadManagerId(auth.currentUser.uid);
      }
    });
    return () => unsub();
  }, [leadManagerId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!auth.currentUser || !name || !client) return;
    
    setSubmitting(true);
    try {
      let finalClientId = clientId;
      if (!finalClientId && client) {
        const companyRef = await addDoc(collection(db, 'companies'), {
          name: client,
          managerId: auth.currentUser.uid,
          createdAt: serverTimestamp()
        });
        finalClientId = companyRef.id;
      }

      const leadManager = users.find(u => u.uid === leadManagerId);

      const projectRef = await addDoc(collection(db, 'projects'), {
        name,
        client,
        address,
        deadline: (deadline && deadline.trim() !== "") ? new Date(deadline) : null,
        status: 'lead',
        managerId: auth.currentUser.uid,
        leadManagerId: leadManagerId,
        leadManagerName: leadManager?.displayName || '',
        stakeholders: {
          client: {
            companyId: finalClientId || '',
            companyName: client,
            contactIds: []
          }
        },
        finance: {
          contractSum: Number(contractSum) || 0,
          managerPercentage: 0,
          expenses: []
        },
        createdAt: (creationDate && creationDate.trim() !== "") ? new Date(creationDate) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const accessUpdates: Record<string, 'view' | 'edit'> = { ...assignedUsers };
      if (leadManagerId) accessUpdates[leadManagerId] = 'edit';
      accessUpdates[auth.currentUser.uid] = 'edit';

      const batchPromises = Object.entries(accessUpdates).map(async ([uid, access]) => {
        const userDocRef = fireDoc(db, 'users', uid);
        await updateDoc(userDocRef, {
          [`projectsAccess.${projectRef.id}`]: access
        });
      });

      await Promise.all(batchPromises);
      
      const defaultTasks = ["Встреча с архитектором", "Подбор материалов", "Запрос образцов", "Изготовление новых образцов", "Согласование образцов", "КП", "Мокап", "Демонстрация", "Договор", "Счет", "Закупка", "Логистика"];

      const taskPromises = defaultTasks.map((taskTitle, index) => 
        addDoc(collection(db, 'projects', projectRef.id, 'tasks'), {
          title: taskTitle,
          description: '',
          date: '', 
          completed: false,
          type: 'task',
          order: index, 
          createdAt: serverTimestamp()
        })
      );

      await Promise.all(taskPromises);
      onCreated(projectRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'projects');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserAccess = (uid: string) => {
    setAssignedUsers(prev => {
      const next = { ...prev };
      if (next[uid]) delete next[uid];
      else next[uid] = 'edit';
      return next;
    });
  };

  return (
    <Modal 
      isOpen={true} 
      onClose={onClose} 
      title="Новый проект"
      description="Заполните основные данные объекта"
      footer={
        <div className="flex gap-4">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Отмена</Button>
          <Button variant="ochre" onClick={handleSubmit} disabled={submitting || !name || !client}>
            {submitting ? 'Создание...' : 'Создать проект'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-1.5">
            <label className="text-eyebrow text-ink-3 ml-2">Название проекта</label>
            <input 
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-surface-2 border-line rounded-lg px-4 py-3 text-sm focus:ring-ochre/20 transition-all font-medium" 
              placeholder="Введите название..."
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-eyebrow text-ink-3 ml-2">Адрес объекта</label>
            <input 
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full bg-surface-2 border-line rounded-lg px-4 py-3 text-sm focus:ring-ochre/20 transition-all font-medium" 
              placeholder="Город, улица..."
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-eyebrow text-ink-3 ml-2">Дата создания</label>
            <DatePicker value={creationDate} onChange={setCreationDate} />
          </div>

          <div className="space-y-1.5">
            <label className="text-eyebrow text-ink-3 ml-2">Срок (Дедлайн)</label>
            <DatePicker value={deadline} onChange={setDeadline} />
          </div>

          <div className="space-y-1.5">
            <label className="text-eyebrow text-ink-3 ml-2">Ведущий менеджер</label>
            <select 
              value={leadManagerId}
              onChange={e => setLeadManagerId(e.target.value)}
              className="w-full bg-surface-2 border-line rounded-lg px-4 py-3 text-sm focus:ring-ochre/20 appearance-none transition-all font-medium cursor-pointer"
            >
              <option value="">Выбрать...</option>
              {users.map(user => (
                <option key={user.uid} value={user.uid}>{user.displayName}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-eyebrow text-ink-3 ml-2">Сумма контракта, Р</label>
            <input 
              type="number"
              value={contractSum}
              onChange={e => setContractSum(Number(e.target.value))}
              className="w-full bg-surface-2 border-line rounded-lg px-4 py-3 text-sm focus:ring-ochre/20 transition-all font-medium" 
              placeholder="0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-eyebrow text-ink-3 ml-2">Заказчик</label>
          <CompanySelect 
            value={client}
            onChange={(val, id) => { setClient(val); setClientId(id); }}
            placeholder="Выбрать компанию из справочника..."
          />
        </div>

        <div className="space-y-4 pt-4 border-t border-line">
          <label className="text-eyebrow text-ink-3 ml-2 block italic uppercase tracking-widest">Доступ пользователей</label>
          <div className="grid grid-cols-2 gap-4">
            {users.filter(u => u.uid !== leadManagerId).map(user => (
              <div key={user.uid} className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-line">
                <div className="flex items-center gap-3">
                  <UserAvatar uid={user.uid} name={user.displayName || '—'} size="sm" />
                  <div>
                    <p className="text-xs font-bold text-ink">{user.displayName}</p>
                    <p className={cn("text-[9px] font-bold tracking-widest uppercase mt-0.5", 
                      assignedUsers[user.uid] ? "text-profit" : "text-ink-4")}>
                      {assignedUsers[user.uid] ? 'Доступ есть' : 'Нет доступа'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleUserAccess(user.uid)}
                  className={cn(
                    "w-8 h-4 rounded-full relative transition-colors",
                    assignedUsers[user.uid] ? "bg-ochre" : "bg-ink-4/20"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                    assignedUsers[user.uid] ? "left-4.5" : "left-0.5"
                  )} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
