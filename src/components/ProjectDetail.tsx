import React, { useState, useEffect } from 'react';
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
  Shield,
  Download,
  FileText,
  Truck,
  Award,
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
import { formatCurrency, cn, formatDate, formatDateForInput, formatDateToDisplay } from '../lib/utils';
import ExpenseCategorySelect from './ExpenseCategorySelect';
import { DatePicker } from './ui/DatePicker';
import { TimeInput } from './ui/TimeInput';
import { PortalDropdown } from './ui/PortalDropdown';
import { Button } from './ui/Button';
import { todayLocalISO } from '../lib/dates';

import { OperationType, handleFirestoreError } from '../lib/firestore-errors';
import CodeProtection from './CodeProtection';
import { onSnapshot as onSnapUser } from 'firebase/firestore';
import { AppUser } from '../types';
import UserAvatar from './UserAvatar';
import ProjectDocuments from './ProjectDocuments';
import StatusPill from './StatusPill';
import { createCalendarEvent } from '../services/googleCalendarService';

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
  onConnectCalendar?: () => void;
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

  const isOwner = appUser?.email === '444hanimai@gmail.com';
  const canEdit = isOwner ||
                  appUser?.fullProjectAccess === true || 
                  appUser?.projectsAccess?.[projectId] === 'edit' ||
                  project?.leadManagerId === auth.currentUser?.uid;

  const hasFinanceAccess = isOwner || appUser?.accessDashboard === true;

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

  // Shipping progress
  const totalPlannedQuantity = project.materials?.reduce((acc, m) => acc + (m.quantity || 0), 0) || 0;
  const totalShippedQuantity = project.shipments?.reduce((acc, s) => acc + (s.quantity || 0), 0) || 0;
  const shippingPercent = totalPlannedQuantity > 0 ? Math.min(Math.round((totalShippedQuantity / totalPlannedQuantity) * 100), 100) : 0;

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
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_1fr] gap-6 items-center">
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

          {/* Контракт */}
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Контракт</p>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[24px] font-normal text-ink leading-none tabular-nums">{formatMln(project.finance?.contractSum || 0)}</span>
              <span className="font-display text-[13px] text-ink-3">млн ₽</span>
            </div>
          </div>

          {/* Маржа */}
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Маржа</p>
            <p className="font-display text-[24px] font-normal leading-none tabular-nums" style={{ color: '#2f5e3f' }}>67%</p>
          </div>

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
            <span className="text-[12px] font-semibold text-ink tabular-nums">{shippingPercent}%</span>
          </div>
          <div className="h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${shippingPercent}%` }}
              className="h-full bg-ochre transition-all duration-700"
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-line flex gap-6 overflow-x-auto no-scrollbar mb-6">
        <TabButton active={activeSegment === 'info'} onClick={() => setActiveSegment('info')} label="Информация" />
        <TabButton active={activeSegment === 'materials'} onClick={() => setActiveSegment('materials')} label="Материалы и отгрузки" count={project.shipments?.length} />
        <TabButton active={activeSegment === 'activity'} onClick={() => setActiveSegment('activity')} label="Задачи" count={tasks.length} />
        {hasFinanceAccess && <TabButton active={activeSegment === 'finance'} onClick={() => setActiveSegment('finance')} label="Финансы и бонусы" />}
        <TabButton active={activeSegment === 'trust'} onClick={() => setActiveSegment('trust')} label="Доверенности" count={trustDeeds.length} />
      </div>

      {/* Content Area */}
      <div className="grid grid-cols-1 gap-8">
        <AnimatePresence mode="wait">
          {activeSegment === 'info' && <motion.div key="info"><PersonalInfoTab project={project} canEdit={canEdit} users={users} /></motion.div>}
          {activeSegment === 'materials' && <motion.div key="materials"><MaterialsTab project={project} canEdit={canEdit} directories={directories} trustDeeds={trustDeeds} /></motion.div>}
          {activeSegment === 'activity' && <motion.div key="activity"><ActivityTab tasks={tasks} projectId={projectId} canEdit={canEdit} project={project} accessToken={accessToken} onConnectCalendar={onConnectCalendar} onClearCalendarToken={onClearCalendarToken} /></motion.div>}
          {activeSegment === 'finance' && <motion.div key="finance"><FinanceTab project={project} canEdit={canEdit} users={users} /></motion.div>}
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
  const totalExpenses = (f.expenses || []).reduce((acc, exp) => acc + (exp.amount || 0), 0);
  const profit = f.contractSum - totalExpenses;
  const managerBonus = profit * (f.managerPercentage || 0) / 100;
  const netProfit = profit - managerBonus;
  const profitability = f.contractSum > 0 ? (netProfit / f.contractSum) * 100 : 0;

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
                  <span className={"text-[#141414]/60 text-sm"}>Прибыль</span>
                  <span className={cn("font-mono font-bold", "text-[#4fb47c]")}>{formatCurrency(profit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={"text-[#141414]/60 text-sm"}>Бонус менеджера ({f.managerPercentage || 0}%)</span>
                  <span className={cn("font-mono font-bold", "text-[#5A5A40]")}>{formatCurrency(managerBonus)}</span>
                </div>
                <div className={cn("flex justify-between items-center pt-2 border-t transition-colors", "border-[#141414]/5")}>
                  <span className={cn("text-[10px] font-bold uppercase tracking-widest font-sans transition-colors", "text-[#141414]/60")}>Рентабельность</span>
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
        <ProjectDocuments projectId={project.id} />
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
    "w-full bg-surface border border-line rounded-md px-3 h-11 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
  );

  const isContactFormOpen = supplierId && (availableContacts.length === 0 || showAddSupplierContact);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.96, y: 12 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="relative w-full max-w-[560px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto overflow-visible"
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
        <div className="px-6 py-5 flex-1 overflow-visible flex flex-col gap-5">
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
        <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-between items-center shrink-0">
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
    </div>
  );
}

function ShipmentModal({ project, editingId, onClose, directories, trustDeeds = [] }: { project: Project, editingId: string | null, onClose: () => void, directories: any, trustDeeds?: TrustDeed[] }) {
  const editingShipment = project.shipments?.find(s => s.id === editingId);
  const [form, setForm] = useState<Partial<Shipment>>(() => {
    const isSent = editingShipment 
      ? (editingShipment.scanSentToAccounting === true || editingShipment.scanSentToAccounting === 'yes') 
      : false; // default is false ("no") as requested

    const base = editingShipment 
      ? { ...editingShipment, autoNumber: editingShipment.autoNumber || String((project.shipments || []).indexOf(editingShipment) + 1) }
      : {
          docType: 'upd',
          incomingUPD: '',
          outgoingUPD: '',
          poaNumber: '',
          poaDate: '',
          autoNumber: String((project.shipments || []).length + 1),
          carrierName: '',
          loadingDate: '',
          unloadingDate: '',
          driverName: '',
          materialName: '',
          quantity: 0,
          carryingCost: 0,
          totalCarryingCost: 0,
          carrierInvoice: '',
          carrierUPD: ''
        };

    return {
      ...base,
      scanSentToAccounting: isSent
    };
  });

  const handleSave = async () => {
    try {
      const shipments = project.shipments || [];
      const newShipment = {
        ...form,
        id: editingId || crypto.randomUUID(),
        createdAt: editingShipment?.createdAt || new Date().toISOString()
      } as Shipment;

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
    "w-full bg-surface border border-line rounded-md px-3 h-11 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
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
          <p className="text-[11.5px] text-[#8A8574] leading-normal font-sans tracking-wide">
            Поля помечены желтым — обязательные. Часть полей подтягивается автоматически из проекта.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex-1 overflow-y-auto flex flex-col gap-6 custom-scrollbar">
          {/* Document Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C]">ДОКУМЕНТЫ</h3>
              <button
                type="button"
                onClick={() => setForm({ ...form, docType: form.docType === 'act' ? 'upd' : 'act' })}
                className="flex items-center gap-2.5 group focus:outline-none"
              >
                <div className={cn(
                  "w-8 h-4.5 rounded-full p-0.5 transition-all duration-300 ease-in-out relative flex items-center cursor-pointer",
                  form.docType === 'act' 
                    ? "bg-[#A67C3C]" 
                    : "bg-[#F5F2E9] border border-line"
                )}>
                  <motion.div 
                    layout
                    className="w-3.5 h-3.5 rounded-full bg-white shadow-sm"
                    animate={{ x: form.docType === 'act' ? 14 : 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </div>
                <span className={cn(
                  "text-[10px] uppercase tracking-widest select-none transition-colors",
                  form.docType === 'act' 
                    ? "text-[#A67C3C]" 
                    : "text-[#8A8574]"
                )}>
                  Входящий акт/ МХ-3
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Входящий {form.docType === 'upd' ? 'УПД' : 'Акт'}</label>
                <input 
                  value={form.incomingUPD || ''}
                  onChange={e => setForm({...form, incomingUPD: e.target.value})}
                  className={inputClass}
                  placeholder="Номер"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Исходящий {form.docType === 'upd' ? 'УПД' : 'MX-3'}</label>
                <input 
                  value={form.outgoingUPD || ''}
                  onChange={e => setForm({...form, outgoingUPD: e.target.value})}
                  className={inputClass}
                  placeholder="Номер"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, scanSentToAccounting: !form.scanSentToAccounting })}
                className="flex items-center gap-2.5 group focus:outline-none cursor-pointer"
              >
                <div className={cn(
                  "w-5 h-5 rounded border transition-all duration-200 flex items-center justify-center",
                  form.scanSentToAccounting 
                    ? "bg-[#7cb244] border-[#7cb244] text-white" 
                    : "bg-[#FDFBF7] border-[#A67C3C]/30 text-transparent"
                )}>
                  <Check size={13} className="stroke-[3px]" />
                </div>
                <span className={cn(
                  "text-[10px] uppercase tracking-widest select-none transition-colors",
                  form.scanSentToAccounting 
                    ? "text-[#7cb244]" 
                    : "text-[#8A8574]"
                )}>
                  ОТПРАВЛЕН СКАН В БУХГАЛТЕРИЮ
                </span>
              </button>
            </div>
          </div>

          {/* POA Section */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Доверенность</h3>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Номер доверенности</label>
              <select 
                value={form.poaNumber || ''}
                onChange={e => setForm({...form, poaNumber: e.target.value})}
                className={cn(inputClass, "appearance-none bg-surface pr-8 cursor-pointer")}
              >
                <option value="">Выберите доверенность...</option>
                {trustDeeds.map(deed => (
                  <option key={deed.id} value={deed.number}>
                    № {deed.number} от {deed.issueDate} ({deed.driverName})
                  </option>
                ))}
              </select>
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
                <input 
                  value={form.autoNumber || ''}
                  readOnly
                  disabled
                  className={cn(inputClass, "opacity-75 bg-surface-2 cursor-not-allowed")}
                  placeholder="Номер а/м"
                />
              </div>
              <div className="md:col-span-6">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Материал</label>
                <DirectorySelect 
                  value={form.materialName || ''}
                  options={project.materials?.map(m => ({ id: m.id, name: m.materialName })) || []}
                  onChange={v => setForm({...form, materialName: v})}
                  onAdd={async () => {}} 
                  placeholder="Выбрать материал..."
                  className={inputClass}
                  iconType="material"
                />
              </div>
              <div className="md:col-span-4">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Количество</label>
                <input 
                  type="number"
                  value={form.quantity !== undefined && form.quantity !== 0 ? form.quantity : ''}
                  onChange={e => setForm({...form, quantity: e.target.value ? Number(e.target.value) : undefined})}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Costs Section */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Стоимость и документы перевозчика</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Стоимость перевозки, ₽</label>
                <input 
                  type="number"
                  value={form.carryingCost !== undefined && form.carryingCost !== 0 ? form.carryingCost : ''}
                  onChange={e => setForm({...form, carryingCost: e.target.value ? Number(e.target.value) : undefined})}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Стоимость перевозки (общая), ₽</label>
                <input 
                  type="number"
                  value={form.totalCarryingCost !== undefined && form.totalCarryingCost !== 0 ? form.totalCarryingCost : ''}
                  onChange={e => setForm({...form, totalCarryingCost: e.target.value ? Number(e.target.value) : undefined})}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Счёт от перевозчика</label>
                <input 
                  value={form.carrierInvoice || ''}
                  onChange={e => setForm({...form, carrierInvoice: e.target.value})}
                  className={inputClass}
                  placeholder="Номер"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">УПД перевозчика</label>
                <input 
                  value={form.carrierUPD || ''}
                  onChange={e => setForm({...form, carrierUPD: e.target.value})}
                  className={inputClass}
                  placeholder="Номер"
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
    </div>
  );
}

function MaterialsTab({ project, canEdit, directories, trustDeeds = [] }: { project: Project, canEdit: boolean, directories: any, trustDeeds?: TrustDeed[] }) {
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);

  const materials = project.materials || [];
  const shipments = project.shipments || [];

  const handleExportToExcel = () => {
    console.log("Exporting to excel...");
    // Future implementation
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
          {materials.length > 0 && (
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
                        <button 
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
                        </button>
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
              >
                Добавить материал
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Shipments Section */}
      <div className={cn(
        "rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
      )}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
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
            {shipments.length > 0 && (
              <Button 
                variant="primary" 
                size="sm" 
                className="h-8 px-2.5 text-[11.5px] font-semibold"
                icon={<Plus size={12} />}
                onClick={() => {
                  setEditingShipmentId(null);
                  setIsAddingShipment(true);
                }}
              >
                Новая отгрузка
              </Button>
            )}
          </div>
        </div>

        <div className="p-4">
          {shipments.length > 0 ? (
          <div className="overflow-x-auto no-scrollbar -mx-10 px-10">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead>
                <tr className={cn("text-[10px] font-bold uppercase tracking-widest transition-colors opacity-30", "text-[#141414]")}>
                  <th className="px-6 py-4">Тип / Номер</th>
                  <th className="px-6 py-4">Скан</th>
                  <th className="px-6 py-4">Материал / Кол-во</th>
                  <th className="px-6 py-4">Даты</th>
                  <th className="px-6 py-4">Перевозчик / Стоимость</th>
                  <th className="px-6 py-4 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((s) => (
                  <tr key={s.id} className={cn("group transition-colors", "hover:bg-[#F5F5F0]")}>
                    <td className="px-6 py-6 rounded-l-2xl">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase", "bg-black/5 text-[#141414]/60")}>
                            {s.docType === 'upd' ? 'УПД' : 'АКТ'}
                          </span>
                          <span className={cn("text-xs font-bold", "text-[#141414]")}>{s.incomingUPD} / {s.outgoingUPD}</span>
                        </div>
                        <p className="text-[10px] opacity-40 font-mono">Дов: {s.poaNumber} от {s.poaDate}</p>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[8px] font-bold uppercase",
                        (s.scanSentToAccounting === true || s.scanSentToAccounting === 'yes') ? "bg-[#7cb244]/10 text-[#7cb244]" : 
                        (s.scanSentToAccounting === false || s.scanSentToAccounting === 'no') ? "bg-rose-500/10 text-rose-500" :
                        "bg-[#141414]/5 text-[#141414]/30"
                      )}>
                        {(s.scanSentToAccounting === true || s.scanSentToAccounting === 'yes') ? 'ОТПРАВЛЕН' : 'НЕТ'}
                      </span>
                    </td>
                    <td className="px-6 py-6">
                      <div className="space-y-1">
                        <p className={cn("text-xs font-bold", "text-[#141414]")}>{s.materialName}</p>
                        <p className="text-sm font-mono font-bold opacity-60">{s.quantity}</p>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <div className="space-y-1 text-xs">
                        <p className={cn("text-xs transition-colors", "text-[#141414]")}>{formatDate(s.loadingDate)}</p>
                        <p className="opacity-40">{formatDate(s.unloadingDate)}</p>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <div className="space-y-1">
                        <p className={cn("text-xs font-bold", "text-[#141414]")}>{s.carrierName}</p>
                        <p className="text-sm font-mono font-bold text-[#7cb244]">{formatCurrency(s.totalCarryingCost)}</p>
                      </div>
                    </td>
                    <td className="px-6 py-6 text-right rounded-r-2xl">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingShipmentId(s.id);
                            setIsAddingShipment(true);
                          }}
                          className={cn("p-2 rounded-lg transition-colors", "hover:bg-black/5 text-[#5A5A40]")}
                        >
                          <Edit3 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={cn("py-7 px-5 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5", "border-line bg-transparent")}>
            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", "bg-white border border-line text-ink-3 shadow-sm")}>
              <Truck size={16} />
            </div>
            <div className="text-center space-y-0.5">
              <p className={cn("text-[13px] font-serif font-medium", "text-ink")}>Отгрузок пока нет</p>
              <p className={cn("text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60", "text-ink-4")}>Машины и доверенности появятся здесь</p>
            </div>
            <Button 
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
            </Button>
          </div>
        )}
        </div>
      </div>

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
  iconType
}: { 
  value: string, 
  options: any[], 
  onChange: (v: string) => void, 
  onAdd?: (name: string) => Promise<void>,
  placeholder: string,
  className?: string,
  iconType?: 'carrier' | 'driver' | 'unit' | 'material'
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
            "w-full bg-surface border border-line rounded-md text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 h-11 pr-9",
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

  const handleSave = async () => {
    try {
      let finalCompanyId = companyId;
      if (!finalCompanyId && companyName) {
        const companyRef = await addDoc(collection(db, 'companies'), {
          name: companyName,
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
      />

      {/* Dialog */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative w-full max-w-[560px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col max-h-[90vh] overflow-visible"
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
        <div className="px-6 py-5 flex-1 overflow-visible flex flex-col gap-5">
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
        <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-end gap-2">
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
    </div>
  );
}

function FinanceTab({ project, canEdit, users }: { project: Project, canEdit: boolean, users: AppUser[] }) {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newExpenseForm, setNewExpenseForm] = useState({ 
    date: new Date().toISOString().split('T')[0], 
    category: '', 
    amount: 0 
  });

  useEffect(() => {
    if (!auth.currentUser) return;
    const unsub = onSnapUser(doc(db, 'users', auth.currentUser.uid), (snap) => {
      setAppUser({ uid: snap.id, ...snap.data() } as AppUser);
    });
    return () => unsub();
  }, []);

  if (appUser && !appUser.hasFinanceAccess) {
    return (
      <div className={cn("p-6 rounded-2xl text-center space-y-6 transition-colors", "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]")}>
        <div className="w-20 h-20 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mx-auto">
          <Shield size={40} />
        </div>
        <h3 className={cn("text-2xl font-serif font-medium", "text-[#141414]")}>Доступ к финансам ограничен</h3>
        <p className={cn("max-w-sm mx-auto", "text-[#141414]/40")}>У вас недостаточно прав для просмотра финансовых показателей этого проекта. Обратитесь к администратору.</p>
      </div>
    );
  }

  if (appUser?.requireFinanceCode && !isUnlocked) {
    return (
      <CodeProtection 
        correctCode={appUser.financeCode || ''} 
        onSuccess={() => setIsUnlocked(true)} 
        title="Защита модуля Финансы"
      />
    );
  }

  const f = project.finance || { contractSum: 0, managerPercentage: 0, expenses: [] };
  const expenses = f.expenses || [];
  const totalExpenses = expenses.reduce((acc, exp) => acc + (exp.amount || 0), 0);
  const profitBeforeBonus = f.contractSum - totalExpenses;
  const managerBonus = profitBeforeBonus * (f.managerPercentage || 0) / 100;
  const netProfit = profitBeforeBonus - managerBonus;
  const profitability = f.contractSum > 0 ? (netProfit / f.contractSum) * 100 : 0;

  const leadManager = users.find(u => u.uid === project.leadManagerId);
  
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
      
      setNewExpenseForm({
        date: new Date().toISOString().split('T')[0],
        category: '',
        amount: 0
      });
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

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* 1. Summary Dashboard Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <FinanceCard 
          label="СУММА КОНТРАКТА" 
          subtext="основа расчёта"
          value={f.contractSum} 
          highlight 
        />
        <FinanceCard 
          label="ЧИСТАЯ ПРИБЫЛЬ" 
          subtext="после всех расходов"
          value={netProfit} 
          type="profit" 
        />
        <FinanceCard 
          label="РАСХОДЫ" 
          subtext={`${expenses.length} операций`}
          value={totalExpenses} 
          type="expense" 
        />
        <FinanceCard 
          label="МАРЖА" 
          subtext="от контракта"
          value={profitability} 
          isPercentage
          type="margin" 
        />
      </div>

      {/* 2. Manager Bonus Section */}
      <div className={cn(
        "p-6 rounded-2xl border space-y-8 transition-colors",
        "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
      )}>
        <div className="flex items-center justify-between">
          <h3 className={cn("text-2xl font-serif font-medium", "text-[#141414]")}>Бонус менеджера</h3>
          <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest", "bg-[#F5F5F0] text-[#141414]/40")}>
            Настройка расчета
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Manager Profile */}
          <div className="lg:col-span-4 flex items-center gap-5">
            <div className="relative">
              <div className={cn("w-20 h-20 rounded-[28px] overflow-hidden flex items-center justify-center text-2xl font-serif font-medium", "bg-[#F5F5F0] text-[#5A5A40]")}>
                {leadManager?.photoURL ? (
                  <img src={leadManager.photoURL} alt="" className="w-full h-full object-cover" />
                ) : (
                  leadManager?.displayName?.split(' ').map(n => n[0]).join('') || 'М'
                )}
              </div>
              <div className={cn("absolute -bottom-1 -right-1 w-8 h-8 rounded-2xl border-4 flex items-center justify-center", "bg-white border-[#F5F5F0] text-[#5A5A40]")}>
                <Award size={14} />
              </div>
            </div>
            <div className="space-y-1">
              <h4 className={cn("text-lg font-serif font-medium", "text-[#141414]")}>
                {leadManager?.displayName || project.leadManagerName || 'Не назначен'}
              </h4>
              <p className={cn("text-[10px] font-bold uppercase tracking-widest opacity-40", "text-[#141414]")}>
                Ведущий менеджер проекта
              </p>
            </div>
          </div>

          {/* Calculator Inputs */}
          <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <FinanceInput 
              label="ПРИБЫЛЬ ОБЩАЯ"
              value={profitBeforeBonus}
              disabled
            />
            <FinanceInput 
              label="БОНУС МЕНЕДЖЕРА %"
              value={f.managerPercentage}
              onChange={v => updateFinance({ managerPercentage: v })}
              disabled={!canEdit}
              isPercentage
            />
            <div className="space-y-2">
              <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4 transition-colors", "text-[#141414]/20")}>СУММА К ВЫПЛАТЕ</label>
              <div className={cn(
                "p-4 rounded-[24px] font-mono font-black text-xl flex items-center gap-3 transition-colors",
                "bg-[#f4a261] text-white"
              )}>
                <span className="opacity-40">₽</span>
                {formatCurrency(managerBonus).replace('₽', '').trim()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Expenses Section */}
      <div className={cn(
        "p-6 rounded-2xl border space-y-8 transition-colors",
        "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
      )}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className={cn("text-2xl font-serif font-medium", "text-[#141414]")}>Расходы по проекту</h3>
            <p className={cn("text-[10px] font-bold uppercase tracking-widest opacity-40", "text-[#141414]")}>Учет фактических затрат</p>
          </div>
          {canEdit && (
            <button 
              onClick={() => setIsAdding(!isAdding)}
              className={cn(
                "px-8 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg",
                isAdding 
                  ? ("bg-rose-400/10 text-rose-400") 
                  : ("bg-[#141414] text-white hover:bg-black")
              )}
            >
              <Plus size={14} strokeWidth={3} />
              Добавить расход
            </button>
          )}
        </div>

        <AnimatePresence>
          {isAdding && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className={cn(
                "p-5 rounded-2xl grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 transition-colors",
                "bg-surface-2"
              )}>
                <div className="space-y-2">
                   <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4 transition-colors opacity-30", "text-[#141414]")}>Дата</label>
                   <DatePicker 
                     value={newExpenseForm.date || ''}
                     onChange={v => setNewExpenseForm({...newExpenseForm, date: v})}
                   />
                </div>
                <div className="md:col-span-2 space-y-2">
                   <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4 transition-colors opacity-30", "text-[#141414]")}>Вид расхода</label>
                   <ExpenseCategorySelect 
                     value={newExpenseForm.category}
                     onChange={(val) => setNewExpenseForm({...newExpenseForm, category: val})}
                     placeholder="Напр. Логистика, Закупка..."
                   />
                </div>
                <div className="space-y-2">
                   <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4 transition-colors opacity-30", "text-[#141414]")}>Сумма</label>
                   <div className="relative">
                     <span className={cn("absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold transition-colors", "text-[#141414]/20")}>₽</span>
                     <input 
                       type="number"
                       value={newExpenseForm.amount || ''}
                       onChange={e => setNewExpenseForm({...newExpenseForm, amount: Number(e.target.value)})}
                       className={cn(
                         "w-full border-none rounded-2xl pl-10 pr-12 py-4 font-mono font-bold text-lg focus:ring-2 transition-all",
                         "bg-white text-[#141414] focus:ring-[#5A5A40]/30 shadow-sm"
                       )}
                       placeholder="0"
                     />
                     <button 
                        onClick={handleAddExpense}
                        disabled={!newExpenseForm.category || newExpenseForm.amount <= 0}
                        className={cn("absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all", "bg-[#141414] text-white hover:bg-black")}
                     >
                       <Check size={20} strokeWidth={3} />
                     </button>
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* List */}
          <div className="lg:col-span-8">
            <div className={cn(
              "rounded-2xl border overflow-hidden transition-colors",
              "border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
            )}>
              <table className="w-full text-left">
                <thead className={cn(
                  "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors",
                  "bg-[#F5F5F0] text-[#141414]/40"
                )}>
                  <tr>
                    <th className="px-8 py-5">Категория</th>
                    <th className="px-8 py-5">Дата</th>
                    <th className="px-8 py-5 text-right">Сумма</th>
                    {canEdit && <th className="w-10"></th>}
                  </tr>
                </thead>
                <tbody className={cn("divide-y transition-colors", "divide-[#141414]/5")}>
                  {expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((expense) => (
                    <tr key={expense.id} className={cn("group transition-colors", "hover:bg-[#F5F5F0]")}>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-1.5 h-1.5 rounded-full", "bg-[#5A5A40]")} />
                          <span className={cn("text-xs font-bold", "text-[#141414]")}>{expense.category}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn("text-[10px] font-mono uppercase tracking-tight opacity-40", "text-[#141414]")}>
                          {new Date(expense.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className={cn("text-xs font-mono font-black", "text-[#141414]")}>{formatCurrency(expense.amount)}</span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-5 text-right overflow-hidden">
                          <button 
                            onClick={() => removeExpense(expense.id)}
                            className="p-2 opacity-0 group-hover:opacity-100 transition-all rounded-lg text-rose-500 hover:bg-rose-500/10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td colSpan={canEdit ? 4 : 3} className={cn("px-8 py-20 text-center space-y-4", "text-[#141414]/10")}>
                        <div className="flex justify-center"><PieChartIcon size={40} className="opacity-20" /></div>
                        <p className="text-[10px] uppercase font-bold tracking-widest italic">Статей расходов пока нет</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chart */}
          <div className="lg:col-span-4 flex flex-col justify-center items-center">
            <div className="w-full aspect-square relative">
              <ExpenseCategoryChart expenses={expenses} />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <p className={cn("text-[8px] font-bold uppercase tracking-widest opacity-30 mt-4", "text-[#141414]")}>ИТОГО РАСХОДЫ</p>
                <p className={cn("text-xl font-mono font-black", "text-[#141414]")}>{formatCurrency(totalExpenses).replace('₽', '').trim()} ₽</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ExpenseCategoryChart({ expenses }: { expenses: any[] }) {
  if (expenses.length === 0) return null;

  const dataMap = expenses.reduce((acc, exp) => {
    acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
    return acc;
  }, {} as Record<string, number>);

  const data = Object.entries(dataMap).map(([name, value]) => ({ name, value }));
  
  const COLORS = ['#5A5A40', '#141414', '#c4a484', '#4fb47c', '#4b7095', '#f4a261'];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={80}
          outerRadius={100}
          paddingAngle={5}
          dataKey="value"
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#fff', 
            borderRadius: '16px', 
            border: 'none', 
            boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}
          itemStyle={{ color: '#141414' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

function FinanceCard({ label, subtext, value, type = 'default', highlight = false, isSmall = false, isPercentage = false }: { label: string, subtext?: string, value: number, type?: 'default' | 'expense' | 'profit' | 'margin', highlight?: boolean, isSmall?: boolean, isPercentage?: boolean }) {
  return (
    <div className={cn(
      "p-6 rounded-2xl transition-all relative overflow-hidden group",
      highlight 
        ? ("bg-[#141414] text-white shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]") 
        : (type === 'margin' ? ("bg-surface-2 border border-[#f4a261]/20") : ("border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]")),
      isSmall && "p-6"
    )}>
      {highlight && (
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:bg-white/20 transition-colors" />
      )}
      
      <p className={cn(
        "text-[10px] font-bold uppercase tracking-[0.15em] mb-1 transition-colors",
        highlight 
          ? ("text-white/40") 
          : (type === 'margin' ? ("text-[#f4a261]") : ("text-[#141414]/20"))
      )}>{label}</p>
      
      {subtext && (
        <p className={cn(
          "text-[8px] font-bold uppercase tracking-widest mb-6 opacity-30",
          highlight 
            ? ("text-white") 
            : ("text-[#141414]")
        )}>{subtext}</p>
      )}

      <div className="flex items-baseline gap-2">
        <p className={cn(
          "font-mono font-black",
          isSmall ? "text-2xl" : "text-4xl",
          type === 'expense' && ("text-rose-400"),
          type === 'profit' && ("text-[#141414]"),
          type === 'margin' && ("text-[#141414]"),
          (!type || type === 'default') && (highlight ? ("text-white") : ("text-[#141414]"))
        )}>
          {isPercentage ? value.toFixed(1) : formatCurrency(value).replace('₽', '').trim()}
        </p>
        <span className={cn(
          "text-xl font-mono font-black",
          highlight 
            ? ("text-white/20") 
            : ("text-[#141414]/10")
        )}>
          {isPercentage ? '%' : '₽'}
        </span>
      </div>
    </div>
  );
}

function FinanceInput({ label, value, onChange, disabled, isPercentage }: { label: string, value?: number, onChange?: (v: number) => void, disabled?: boolean, isPercentage?: boolean }) {
  return (
    <div className="space-y-2">
      <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4 transition-colors", "text-[#141414]/20")}>{label}</label>
      <div className={cn("relative group", disabled && "cursor-not-allowed")}>
        <span className={cn("absolute left-6 top-1/2 -translate-y-1/2 transition-colors font-mono font-black text-xl", "text-[#141414]/10 group-focus-within:text-[#5A5A40]")}>
          {isPercentage ? '%' : '₽'}
        </span>
        <input 
          type="number"
          value={value === 0 ? '' : (value || '')}
          disabled={disabled}
          onChange={e => onChange?.(Number(e.target.value))}
          className={cn(
            "w-full border-none rounded-[24px] pl-14 pr-6 py-4 transition-all font-mono font-bold text-lg",
            "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30 hover:bg-[#141414]/5",
            disabled ? "opacity-60" : ""
          )}
          placeholder=""
        />
      </div>
    </div>
  );
}


function ActivityTab({ tasks, projectId, canEdit, project, accessToken, onConnectCalendar, onClearCalendarToken }: { tasks: ProjectTask[], projectId: string, canEdit: boolean, project: Project | null, accessToken?: string | null, onConnectCalendar?: () => void, onClearCalendarToken?: () => void }) {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskTime, setNewTaskTime] = useState('');

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskData, setEditingTaskData] = useState<Partial<ProjectTask>>({});
  const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);

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
        } catch (calError: any) {
          const isAuthError = calError.message?.includes('401') || calError.message?.includes('403') || calError.message?.includes('expired') || calError.message?.includes('unauthorized') || calError.message?.includes('forbidden');
          if (isAuthError) {
            onClearCalendarToken?.();
          }
          console.error("Calendar sync error:", calError);
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
      const taskData = {
        projectId,
        title: newTaskTitle,
        description: '',
        date: newTaskDate || null,
        time: newTaskTime || null,
        completed: false,
        type: 'task',
        createdAt: serverTimestamp(),
        order: tasks.length
      };

      await addDoc(collection(db, 'projects', projectId, 'tasks'), taskData);

      if (accessToken && project && newTaskDate) {
        try {
          await createCalendarEvent(accessToken, project, taskData);
        } catch (calError: any) {
          console.error("Calendar sync failed", calError);
        }
      }

      setNewTaskTitle('');
      setNewTaskDate('');
      setNewTaskTime('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks`);
    }
  };

  const tasksWithDate = tasks.filter(t => t.date && !t.completed).sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
  const tasksWithoutDate = tasks.filter(t => !t.date && !t.completed).sort((a, b) => (a.order || 0) - (b.order || 0));
  const completedTasks = tasks.filter(t => t.completed);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      {/* Left Column: Add Task Form */}
      <div className={cn(
        "p-6 rounded-2xl border transition-colors",
        "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
      )}>
        <div className="flex items-center justify-between mb-8">
          <h3 className={cn("text-lg font-serif transition-colors", "text-[#141414]")}>Добавить задачу</h3>
        </div>

        <form onSubmit={addTask} className="space-y-6">
          <div className="space-y-2">
            <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-1 transition-colors opacity-40", "text-[#141414]")}>
              ЧТО НУЖНО СДЕЛАТЬ?
            </label>
            <textarea
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              placeholder="Напр. Отправить КП заказчику"
              rows={2}
              className={cn(
                "w-full border rounded-2xl px-6 py-4 text-sm font-medium focus:ring-2 transition-all resize-none",
                "bg-[#F5F5F0] border-[#141414]/10 text-[#141414] focus:ring-[#5A5A40]/30"
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-1 transition-colors opacity-40", "text-[#141414]")}>
                ДАТА (НЕОБЯЗАТЕЛЬНО)
              </label>
              <DatePicker
                value={newTaskDate}
                onChange={setNewTaskDate}
                placeholder="дд.мм.гггг"
              />
            </div>
            <div className="space-y-2">
              <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-1 transition-colors opacity-40", "text-[#141414]")}>
                ВРЕМЯ
              </label>
              <TimeInput
                value={newTaskTime}
                onChange={setNewTaskTime}
                placeholder="--:--"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!newTaskTitle || !canEdit}
            className={cn(
              "w-full py-5 rounded-2xl font-bold text-sm transition-all active:scale-95 shadow-xl flex items-center justify-center gap-2",
              "bg-[#B48444] text-white hover:opacity-90"
            )}
          >
            <Plus size={18} strokeWidth={3} />
            <span>Добавить задачу</span>
          </button>

          <p className={cn("text-[10px] leading-relaxed opacity-40", "text-[#141414]")}>
            Часть задач подгружается автоматически при создании проекта — даты можно проставить позже.
          </p>
        </form>
      </div>

      {/* Right Column: Task Lists */}
      <div className="space-y-8">
        {/* Section: With Date */}
        <div className={cn(
          "rounded-2xl border transition-colors overflow-hidden",
          "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
        )}>
          <div className={cn(
            "px-8 py-5 flex items-center gap-2 border-b transition-colors",
            "border-[#141414]/5 bg-[#fcfcfc]/50"
          )}>
            <span className={cn("text-sm font-serif", "text-[#141414]")}>С датой</span>
            <span className={cn("text-xs opacity-30 mt-0.5 font-mono")}>· {tasksWithDate.length}</span>
          </div>

          <div className={cn("divide-y transition-colors", "divide-[#141414]/5")}>
            {tasksWithDate.map(task => (
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
            {tasksWithDate.length === 0 && (
              <div className="p-8 text-center text-[10px] uppercase font-bold tracking-widest opacity-20 transition-colors">Нет задач с датой</div>
            )}
          </div>
        </div>

        {/* Section: Without Date */}
        <div className={cn(
          "rounded-2xl border transition-colors overflow-hidden",
          "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
        )}>
          <div className={cn(
            "px-8 py-5 flex items-center justify-between border-b transition-colors",
            "border-[#141414]/5 bg-[#fcfcfc]/50"
          )}>
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-serif", "text-[#141414]")}>Без даты</span>
              <span className={cn("text-xs opacity-30 mt-0.5 font-mono")}>· {tasksWithoutDate.length}</span>
            </div>
            <span className={cn("text-[10px] font-bold uppercase tracking-tighter opacity-30", "text-[#141414]")}>
              назначьте дату когда поймёте срок
            </span>
          </div>

          <div className={cn("divide-y transition-colors", "divide-[#141414]/5")}>
            {tasksWithoutDate.map(task => (
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
            {tasksWithoutDate.length === 0 && (
              <div className="p-8 text-center text-[10px] uppercase font-bold tracking-widest opacity-20 transition-colors">Нет задач без даты</div>
            )}
          </div>
        </div>

        {/* Section: Completed */}
        {completedTasks.length > 0 && (
          <div className={cn(
            "rounded-2xl border transition-colors overflow-hidden opacity-60 grayscale-[0.3]",
            "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
          )}>
            <div className={cn(
              "px-8 py-5 border-b transition-colors",
              "border-[#141414]/5"
            )}>
              <span className={cn("text-sm font-serif", "text-[#141414]")}>Завершенные</span>
              <span className={cn("text-xs opacity-30 ml-2 font-mono")}>· {completedTasks.length}</span>
            </div>
            <div className={cn("divide-y transition-colors", "divide-[#141414]/5")}>
              {completedTasks.map(task => (
                <TaskItem
                  key={task.id}
                  task={task}
                  canEdit={canEdit}
                  onToggle={toggleTask}
                  onDelete={deleteTask}
                />
              ))}
            </div>
          </div>
        )}
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
  const dateVal = task.date;
  let d: Date | null = null;
  if (dateVal) {
    if (typeof dateVal === 'object' && dateVal !== null && 'toDate' in (dateVal as object) && typeof (dateVal as any).toDate === 'function') {
      d = (dateVal as any).toDate();
    } else {
      d = new Date(dateVal as any);
    }
  }
  const isInvalid = d && isNaN(d.getTime());
  const day = d && !isInvalid ? d.toLocaleDateString('ru-RU', { day: '2-digit' }) : '';
  const month = d && !isInvalid ? d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '').toLowerCase() : '';

  if (isEditing && onEditDataChange && onSaveEdit && onCancelEdit) {
    return (
      <div className="p-6 space-y-4">
        <textarea
          value={editingData?.title || ''}
          onChange={e => onEditDataChange({ ...editingData, title: e.target.value })}
          className={cn(
            "w-full border-none rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 transition-all resize-none",
            "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker
            value={editingData?.date || ''}
            onChange={v => onEditDataChange({ ...editingData, date: v })}
          />
          <TimeInput
            value={editingData?.time || ''}
            onChange={v => onEditDataChange({ ...editingData, time: v })}
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onSaveEdit} className={cn("flex-1 py-3 rounded-xl text-[10px] font-bold transition-all", "bg-[#5A5A40] text-white")}>Сохранить</button>
          <button onClick={onCancelEdit} className={cn("px-4 py-3 rounded-xl text-[10px] font-bold", "bg-[#F5F5F0] text-[#141414]/40")}>Отмена</button>
        </div>
      </div>
    );
  }

  return (
    <div 
      id={`task-${task.id}`}
      className={cn(
        "px-8 py-6 flex items-center gap-6 group transition-colors rounded-xl",
        task.completed ? "hover:bg-opacity-50" : ("hover:bg-gray-50/50")
      )}
    >
      {/* Circle Checkbox */}
      <button 
        onClick={() => onToggle(task)}
        className={cn(
          "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
          task.completed 
            ? ("bg-[#4fb47c] border-[#4fb47c]")
            : ("border-[#141414]/10 hover:border-[#5A5A40]/50")
        )}
      >
        {task.completed && <CheckCircle2 size={14} className="text-white" />}
        {!task.completed && <div className="w-2 h-2 rounded-full opacity-0 hover:opacity-100 transition-opacity bg-current" />}
      </button>

      {/* Date Display */}
      <div className="w-10 flex flex-col items-center shrink-0">
        {task.date ? (
          <>
            <span className={cn("text-lg font-serif leading-none", "text-[#141414]")}>{day}</span>
            <span className={cn("text-[8px] font-bold uppercase tracking-widest opacity-40", "text-[#141414]")}>{month}</span>
            <span className={cn("text-[9px] font-bold opacity-30 mt-0.5")}>{task.time || '—'}</span>
          </>
        ) : (
          <div className="flex flex-col items-center">
             <Clock size={16} className="opacity-20" />
          </div>
        )}
      </div>

      {/* Task Content */}
      <div className="flex-1 min-w-0">
        <h4 className={cn(
          "font-bold text-sm leading-tight transition-all",
          task.completed ? "line-through opacity-30" : ("text-[#141414]")
        )}>
          {task.title}
        </h4>
        {!task.date && (
          <p className="text-[9px] font-bold uppercase tracking-widest opacity-30 mt-1">без даты</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
        {canEdit && !task.completed && onBeginEdit && (
          <button 
            onClick={() => onBeginEdit(task)}
            className={cn("p-2 rounded-xl transition-all", "hover:bg-black/5 text-[#5A5A40]")}
          >
            <Edit3 size={14} />
          </button>
        )}
        {canEdit && (
          <button 
            onClick={(e) => onDelete(e, task.id)}
            className="p-2 rounded-xl text-rose-500 hover:bg-rose-500/10 transition-all opacity-40 hover:opacity-100"
          >
            <Trash2 size={14} />
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

  const handleAdd = async () => {
    if (!canEdit) return;
    try {
      const nextNumber = trustDeeds.length > 0 
        ? (Math.max(...trustDeeds.map(d => parseInt(d.number) || 0)) + 1).toString()
        : "1";
      
      const newDeed = {
        number: nextNumber,
        issueDate: new Date().toISOString().split('T')[0],
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        customerName: project.stakeholders?.client?.companyName || project.client || '',
        supplierId: '',
        supplierName: '',
        carrierId: '',
        carrierName: '',
        accountNumber: '',
        rate: 0,
        driverId: '',
        driverName: '',
        driverPassportSeries: '',
        driverPassportNumber: '',
        materialId: '',
        materialName: '',
        quantity: 0,
      };
      setFormData(newDeed);
      setIsAdding(true);
      setIsEditing(false);
    } catch (error) {
      console.error(error);
    }
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
      if (isEditing && formData.id) {
        await updateDoc(doc(db, 'projects', project.id, 'trust_deeds', formData.id), {
          ...formData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'projects', project.id, 'trust_deeds'), {
          ...formData,
          createdAt: serverTimestamp()
        });
      }
      setIsAdding(false);
      setFormData({});
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canEdit || !window.confirm('Вы уверены, что хотите удалить эту доверенность?')) return;
    const path = `projects/${project.id}/trust_deeds/${id}`;
    try {
      await deleteDoc(doc(db, 'projects', project.id, 'trust_deeds', id));
      if (selectedDeedId === id) setSelectedDeedId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="space-y-8">
      {/* Registry Top Bar */}
      <div className={cn(
        "p-6 rounded-2xl border transition-colors relative overflow-hidden",
        "bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
      )}>
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-1">
            <h3 className={cn("text-2xl font-serif font-medium", "text-[#141414]")}>
              Реестр доверенностей <span className="opacity-20 ml-2">· {trustDeeds.length}</span>
            </h3>
          </div>
          {canEdit && (
            <button 
              onClick={handleAdd}
              className={cn(
                "px-8 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 shadow-lg",
                "bg-[#141414] text-white hover:bg-black"
              )}
            >
              <Plus size={14} strokeWidth={3} />
              Новая доверенность
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Table container */}
          <div className={cn(
            "transition-all duration-500",
            selectedDeedId ? "lg:col-span-7" : "lg:col-span-12"
          )}>
            <div className={cn(
              "rounded-2xl border overflow-hidden transition-colors",
              "border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
            )}>
              <table className="w-full text-left">
                <thead className={cn(
                  "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors",
                  "bg-[#F5F5F0] text-[#141414]/40"
                )}>
                  <tr>
                    <th className="px-8 py-5">№</th>
                    <th className="px-8 py-5">ВЫДАНА</th>
                    <th className="px-8 py-5">ДЕЙСТВУЕТ ДО</th>
                    <th className="px-8 py-5">ВОДИТЕЛЬ</th>
                    <th className="px-8 py-5">ПЕРЕВОЗЧИК</th>
                    <th className="px-8 py-5 text-right">КОЛ-ВО</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className={cn("divide-y transition-colors", "divide-[#141414]/5")}>
                  {trustDeeds.map((deed) => (
                    <tr 
                      key={deed.id} 
                      onClick={() => setSelectedDeedId(deed.id === selectedDeedId ? null : deed.id)}
                      className={cn(
                        "group cursor-pointer transition-all",
                        selectedDeedId === deed.id 
                          ? ("bg-[#F5F5F0]")
                          : ("hover:bg-[#F5F5F0]/50")
                      )}
                    >
                      <td className="px-8 py-5">
                        <span className={cn("text-xs font-mono font-black", "text-[#141414]/40")}>№</span>
                        <span className={cn("text-sm font-serif font-medium ml-1", "text-[#141414]")}>{deed.number}</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn("text-xs font-mono", "text-[#141414]/60")}>
                          {deed.issueDate ? formatDateToDisplay(deed.issueDate) : '—'}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn("text-xs font-mono", "text-[#141414]/60")}>
                          {deed.expiryDate ? formatDateToDisplay(deed.expiryDate) : '—'}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn("text-xs font-medium", "text-[#141414]")}>{deed.driverName?.split(' ')[0] || '—'}</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn("text-xs opacity-60", "text-[#141414]")}>{deed.carrierName || '—'}</span>
                      </td>
                      <td className="px-8 py-5 text-right flex items-center justify-end gap-2">
                        <span className={cn("text-sm font-mono font-black", "text-[#141414]")}>{deed.quantity?.toLocaleString()}</span>
                        <ChevronRight size={14} className={cn("transition-transform", selectedDeedId === deed.id ? "rotate-90" : "opacity-20")} />
                      </td>
                      <td className="w-2"></td>
                    </tr>
                  ))}
                  {trustDeeds.length === 0 && (
                    <tr onClick={handleAdd} className="cursor-pointer group">
                      <td colSpan={7} className="px-8 py-20 text-center space-y-6">
                        <div className={cn(
                          "w-16 h-16 rounded-[24px] flex items-center justify-center mx-auto transition-transform group-hover:scale-110",
                          "bg-[#F5F5F0] text-[#141414]/10"
                        )}>
                          <FileText size={32} />
                        </div>
                        <div className="space-y-1">
                          <p className={cn("text-lg font-serif font-medium", "text-[#141414]/40")}>Доверенностей пока нет</p>
                          <p className={cn("text-[10px] font-bold uppercase tracking-widest opacity-20", "text-[#141414]")}>Создавайте и формируйте документ прямо отсюда</p>
                        </div>
                        <button className={cn(
                          "px-6 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest",
                          "bg-[#B48444] text-white"
                        )}>
                          <Plus size={14} className="inline mr-2" />
                          Новая доверенность
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Side Detail Panel */}
          <AnimatePresence>
            {selectedDeedId && selectedDeed && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="lg:col-span-5 h-full"
              >
                <div className={cn(
                  "rounded-2xl border overflow-hidden flex flex-col h-full transition-colors",
                  "border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
                )}>
                  {/* Panel Header */}
                  <div className="p-8 pb-4 flex items-center justify-between">
                    <div>
                      <p className={cn("text-[10px] font-bold uppercase tracking-widest opacity-30", "text-[#141414]")}>Доверенность</p>
                      <h4 className={cn("text-2xl font-serif font-medium", "text-[#141414]")}>
                        <span className="opacity-40">№</span> {selectedDeed.number}
                      </h4>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleEdit(selectedDeed)}
                        className={cn("p-2.5 rounded-xl transition-all", "bg-white border border-[#141414]/5 text-[#141414]/40 hover:text-[#141414]")}
                      >
                        <Edit3 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(selectedDeed.id)}
                        className={cn("p-2.5 rounded-xl transition-all", "bg-white border border-[#141414]/5 text-rose-500/40 hover:text-rose-500")}
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => setSelectedDeedId(null)}
                        className={cn("p-2.5 rounded-xl transition-all", "bg-white border border-[#141414]/5 text-[#141414]/40 hover:text-[#141414]")}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Panel Scroll Content */}
                  <div className="flex-1 overflow-y-auto p-8 pt-4 space-y-10 custom-scrollbar">
                    {/* Section: Terms */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <span className={cn("text-[8px] font-bold uppercase tracking-[0.2em]", "text-[#B48444]")}>СРОКИ</span>
                        <div className={cn("h-px flex-1", "bg-[#141414]/5")} />
                      </div>
                      <div className="grid grid-cols-2 gap-8">
                        <TrustInfoField label="ДАТА ВЫДАЧИ" value={formatDateToDisplay(selectedDeed.issueDate)} />
                        <TrustInfoField label="СРОК ДЕЙСТВИЯ ДО" value={formatDateToDisplay(selectedDeed.expiryDate)} />
                      </div>
                    </div>

                    {/* Section: Parties */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <span className={cn("text-[8px] font-bold uppercase tracking-[0.2em]", "text-[#B48444]")}>СТОРОНЫ</span>
                        <div className={cn("h-px flex-1", "bg-[#141414]/5")} />
                      </div>
                      <div className="space-y-6">
                        <TrustInfoField label="КОМПАНИЯ-ПОСТАВЩИК" value={selectedDeed.supplierName} />
                        <TrustInfoField label="ЗАКАЗЧИК" value={selectedDeed.customerName} />
                        <TrustInfoField label="ЛОГИСТИЧЕСКАЯ КОМПАНИЯ" value={selectedDeed.carrierName} />
                        <TrustInfoField label="НОМЕР СЧЁТА" value={selectedDeed.accountNumber} />
                        <TrustInfoField label="СТАВКА (СТОИМОСТЬ ПЕРЕВОЗКИ)" value={formatCurrency(selectedDeed.rate)} />
                      </div>
                    </div>

                    {/* Section: Driver */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <span className={cn("text-[8px] font-bold uppercase tracking-[0.2em]", "text-[#B48444]")}>ВОДИТЕЛЬ</span>
                        <div className={cn("h-px flex-1", "bg-[#141414]/5")} />
                      </div>
                      <div className="space-y-6">
                        <TrustInfoField label="ФИО ВОДИТЕЛЯ" value={selectedDeed.driverName} />
                        <div className="grid grid-cols-2 gap-8">
                          <TrustInfoField label="ПАСПОРТ — СЕРИЯ" value={selectedDeed.driverPassportSeries} />
                          <TrustInfoField label="ПАСПОРТ — НОМЕР" value={selectedDeed.driverPassportNumber} />
                        </div>
                      </div>
                    </div>

                    {/* Section: Cargo */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-3">
                        <span className={cn("text-[8px] font-bold uppercase tracking-[0.2em]", "text-[#B48444]")}>ГРУЗ</span>
                        <div className={cn("h-px flex-1", "bg-[#141414]/5")} />
                      </div>
                      <div className="space-y-6">
                        <TrustInfoField label="МАТЕРИАЛ" value={selectedDeed.materialName} />
                        <TrustInfoField label="КОЛИЧЕСТВО" value={`${selectedDeed.quantity?.toLocaleString()} шт`} />
                      </div>
                    </div>
                  </div>

                  {/* Panel Footer */}
                  <div className="p-8 pt-4">
                    <button className={cn(
                      "w-full py-5 rounded-2xl font-bold text-[11px] uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg transition-all active:scale-95",
                      "bg-[#B48444] text-white hover:opacity-90"
                    )}>
                      <Download size={14} strokeWidth={3} />
                      Сформировать документ доверенности
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* New/Edit Modal */}
      <AnimatePresence>
        {isAdding && (
          <TrustDeedModal
            formData={formData}
            setFormData={setFormData}
            onClose={() => setIsAdding(false)}
            onSave={handleSave}
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
    <div className="space-y-1.5">
      <p className={cn("text-[8px] font-bold uppercase tracking-[0.15em] opacity-30", "text-[#141414]")}>{label}</p>
      <p className={cn("text-xs font-medium", "text-[#141414]")}>{value || '—'}</p>
    </div>
  );
}

function TrustDeedModal({ formData, setFormData, onClose, onSave, directories, project, isEditing }: { formData: Partial<TrustDeed>, setFormData: any, onClose: () => void, onSave: () => void, directories: any, project: Project, isEditing: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 sm:p-12 lg:p-24 bg-black/60 backdrop-blur-sm overflow-y-auto no-scrollbar">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={cn(
          "w-full max-w-2xl rounded-[48px] shadow-2xl relative flex flex-col max-h-[90vh]",
          "bg-[#FBFBFA] text-[#141414]"
        )}
      >
        {/* Modal Header */}
        <div className="p-12 pb-6 flex items-start justify-between">
          <div className="space-y-2">
             <h3 className="text-3xl font-serif font-medium">{isEditing ? 'Редактировать доверенность' : 'Новая доверенность'}</h3>
             <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">
               Номер присваивается автоматически — сквозной по всем проектам
             </p>
          </div>
          <button onClick={onClose} className="p-3 rounded-full hover:bg-white/5 transition-colors opacity-40 hover:opacity-100">
            <X size={20} />
          </button>
        </div>

        {/* Modal Form Scroll Area */}
        <div className="flex-1 overflow-y-auto p-12 pt-4 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">НОМЕР</label>
               <input 
                 type="text" 
                 value={formData.number || ''}
                 onChange={e => setFormData({...formData, number: e.target.value})}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-mono font-bold transition-all", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               />
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ДАТА ВЫДАЧИ</label>
               <DatePicker value={formData.issueDate || ''} onChange={v => setFormData({...formData, issueDate: v})} />
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ДЕЙСТВУЕТ ДО</label>
               <DatePicker value={formData.expiryDate || ''} onChange={v => setFormData({...formData, expiryDate: v})} />
            </div>
          </div>

          <div className="space-y-2">
             <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">КОМПАНИЯ-ПОСТАВЩИК</label>
             <select 
               value={formData.supplierId || ''}
               onChange={e => {
                 const id = e.target.value;
                 const comp = directories.companies.find((c: any) => c.id === id);
                 setFormData({...formData, supplierId: id, supplierName: comp?.name || ''});
               }}
               className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium transition-all text-sm appearance-none", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
             >
               <option value="">Выберите поставщика...</option>
               {directories.companies.map((c: any) => (
                 <option key={c.id} value={c.id}>{c.name}</option>
               ))}
             </select>
          </div>

          <div className="space-y-2">
             <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ЗАКАЗЧИК</label>
             <div className="relative">
               <input 
                 readOnly
                 value={formData.customerName || ''}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm opacity-60", "bg-white shadow-sm")}
               />
               <span className="absolute right-6 top-1/2 -translate-y-1/2 text-[8px] font-bold uppercase tracking-widest opacity-20">из данных проекта</span>
             </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ЛОГИСТИЧЕСКАЯ КОМПАНИЯ</label>
               <select 
                 value={formData.carrierId || ''}
                 onChange={e => {
                   const id = e.target.value;
                   const carrier = directories.carriers.find((c: any) => c.id === id);
                   setFormData({...formData, carrierId: id, carrierName: carrier?.name || ''});
                 }}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm transition-all appearance-none", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               >
                 <option value="">Выбрать...</option>
                 {directories.carriers.map((c: any) => (
                   <option key={c.id} value={c.id}>{c.name}</option>
                 ))}
               </select>
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">НОМЕР СЧЁТА</label>
               <input 
                 type="text" 
                 value={formData.accountNumber || ''}
                 onChange={e => setFormData({...formData, accountNumber: e.target.value})}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm transition-all", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               />
            </div>
          </div>

          <div className="space-y-2">
             <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">СТАВКА (СТОИМОСТЬ ПЕРЕВОЗКИ), ₽</label>
             <input 
               type="number" 
               value={formData.rate || ''}
               onChange={e => setFormData({...formData, rate: Number(e.target.value)})}
               className={cn("w-full px-6 py-4 rounded-2xl border-none font-mono font-bold text-lg transition-all", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               placeholder="0"
             />
          </div>

          <div className="space-y-2">
             <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ФИО ВОДИТЕЛЯ</label>
             <select 
               value={formData.driverId || ''}
               onChange={e => {
                 const id = e.target.value;
                 const driver = directories.drivers.find((d: any) => d.id === id);
                 setFormData({...formData, driverId: id, driverName: driver?.name || ''});
               }}
               className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm transition-all appearance-none", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
             >
               <option value="">Выбрать из справочника водителей...</option>
               {directories.drivers.map((d: any) => (
                 <option key={d.id} value={d.id}>{d.name}</option>
               ))}
             </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ПАСПОРТ — СЕРИЯ</label>
               <input 
                 type="text" 
                 value={formData.driverPassportSeries || ''}
                 onChange={e => setFormData({...formData, driverPassportSeries: e.target.value})}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm transition-all", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               />
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">ПАСПОРТ — НОМЕР</label>
               <input 
                 type="text" 
                 value={formData.driverPassportNumber || ''}
                 onChange={e => setFormData({...formData, driverPassportNumber: e.target.value})}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm transition-all", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="sm:col-span-2 space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">МАТЕРИАЛ</label>
               <select 
                 value={formData.materialId || ''}
                 onChange={e => {
                   const id = e.target.value;
                   const mat = project.materials?.find(m => m.id === id);
                   setFormData({...formData, materialId: id, materialName: mat?.materialName || ''});
                 }}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-medium text-sm transition-all appearance-none", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
               >
                 <option value="">Выбрать материал проекта...</option>
                 {project.materials?.map(m => (
                   <option key={m.id} value={m.id}>{m.materialName}</option>
                 ))}
               </select>
            </div>
            <div className="space-y-2">
               <label className="text-[10px] font-bold uppercase tracking-widest ml-4 opacity-40">КОЛИЧЕСТВО</label>
               <input 
                 type="number" 
                 value={formData.quantity || ''}
                 onChange={e => setFormData({...formData, quantity: Number(e.target.value)})}
                 className={cn("w-full px-6 py-4 rounded-2xl border-none font-mono font-bold text-lg transition-all", "bg-white focus:ring-[#5A5A40]/30 shadow-sm")}
                 placeholder="0"
               />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-12 pt-6 flex flex-col sm:flex-row items-center justify-end gap-4 border-t border-white/5">
           <button 
             onClick={onSave}
             className={cn(
               "w-full sm:w-auto px-10 py-5 rounded-2xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-3 border transition-all",
               "border-[#141414]/10 text-[#141414]/60 hover:bg-[#141414]/5"
             )}
           >
             <Download size={16} />
             Сохранить и сформировать документ
           </button>
           <button 
             onClick={onSave}
             className={cn(
               "w-full sm:w-auto px-10 py-5 rounded-2xl font-bold text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all",
               "bg-[#141414] text-white hover:bg-black shadow-black/20"
             )}
           >
             {isEditing ? 'Сохранить изменения' : 'Создать доверенность'}
           </button>
        </div>
      </motion.div>
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
