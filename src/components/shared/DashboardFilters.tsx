import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users as UsersIcon,
  Calendar,
  ChevronDown,
  Check,
  Circle,
  Plus,
  Flag
} from 'lucide-react';
import { cn } from '../../lib/utils';
import UserAvatar from '../UserAvatar';
import { AppUser } from '../../types';
import { STATUS_LIST, STATUS_LABEL, STATUS_COLOR } from '../../lib/statuses';

export type PeriodType = 'quarter' | 'year' | 'all';

/* ───────── shared atoms ───────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">
      {children}
    </span>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function DDTrigger({ icon, label, value, open, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-[7px] rounded-[10px] bg-surface text-[12.5px] transition-colors whitespace-nowrap border",
        open ? "border-ochre" : "border-line hover:bg-surface-2"
      )}
    >
      <span className="text-ink-3 flex items-center shrink-0">{icon}</span>
      <span className="text-ink-3 text-[11.5px]">{label}:</span>
      <span className="text-ink font-medium">{value}</span>
      <ChevronDown
        size={12}
        className={cn("text-ink-3 ml-0.5 transition-transform shrink-0", open && "rotate-180")}
      />
    </button>
  );
}

function MenuShell({ children, width = 220 }: { children: React.ReactNode; width?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute top-full left-0 mt-1.5 bg-surface border border-line rounded-[10px] p-1.5 z-50"
      style={{
        minWidth: width,
        boxShadow: '0 1px 0 rgba(255,255,255,.5) inset, 0 24px 48px -12px rgba(48,42,28,.28)'
      }}
    >
      {children}
    </motion.div>
  );
}

function MenuItem({ selected, onClick, children }: {
  key?: any;
  selected?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left text-[13px] transition-colors",
        selected
          ? "bg-[var(--ochre-bg)] text-ochre font-semibold"
          : "text-ink hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}

/* ───────── PeriodSelector — single segmented control ───────── */

interface PeriodSelectorProps {
  label: string;
  selectedPeriod: PeriodType;
  onPeriodChange: (p: PeriodType) => void;
  start: Date | null;
  end: Date | null;
}

export function PeriodSelector({ label, selectedPeriod, onPeriodChange }: PeriodSelectorProps) {
  const opts: { id: PeriodType; label: string }[] = [
    { id: 'quarter', label: 'Квартал' },
    { id: 'year',    label: 'Год' },
    { id: 'all',     label: 'Всё время' },
  ];
  return (
    <div className="flex items-center gap-2.5">
      <Eyebrow>{label}</Eyebrow>
      <div className="inline-flex items-center gap-0.5 p-[2px] rounded-lg bg-surface-2">
        {opts.map(p => {
          const active = selectedPeriod === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPeriodChange(p.id)}
              className={cn(
                "px-3 py-[5px] rounded-md text-[12px] font-semibold transition-all whitespace-nowrap",
                active
                  ? "bg-bg text-ink shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
                  : "text-ink-3 hover:text-ink-2 bg-transparent"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────── DateTypeSelector ───────── */

interface DateTypeSelectorProps {
  value: 'createdAt' | 'deadline';
  onChange: (val: 'createdAt' | 'deadline') => void;
}

export function DateTypeSelector({ value, onChange }: DateTypeSelectorProps) {
  const { open, setOpen, ref } = usePopover();
  const options = [
    { id: 'createdAt' as const, label: 'Дата создания', icon: <Plus size={13} /> },
    { id: 'deadline'  as const, label: 'Срок проекта',  icon: <Flag size={13} /> },
  ];
  const selected = options.find(o => o.id === value) || options[0];

  return (
    <div className="relative" ref={ref}>
      <DDTrigger
        icon={<Calendar size={13} />}
        label="Дата"
        value={selected.label}
        open={open}
        onClick={() => setOpen(!open)}
      />
      <AnimatePresence>
        {open && (
          <MenuShell width={210}>
            {options.map(opt => (
              <MenuItem
                key={opt.id}
                selected={value === opt.id}
                onClick={() => { onChange(opt.id); setOpen(false); }}
              >
                <span className="text-ink-3 flex items-center w-4 shrink-0">{opt.icon}</span>
                <span className="flex-1">{opt.label}</span>
                {value === opt.id && <Check size={13} className="text-ochre" strokeWidth={2.5}/>}
              </MenuItem>
            ))}
          </MenuShell>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────── StatusSelector (multi) ───────── */

interface StatusSelectorProps {
  values: string[];
  onChange: (vals: string[]) => void;
}

export function StatusSelector({ values, onChange }: StatusSelectorProps) {
  const { open, setOpen, ref } = usePopover();
  const options = STATUS_LIST.map(s => ({
    id: s,
    label: STATUS_LABEL[s],
    color: STATUS_COLOR[s]
  }));

  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter(v => v !== id) : [...values, id]);
  };

  const label =
    values.length === 0 ? 'Все статусы' :
    values.length === 1 ? (options.find(o => o.id === values[0])?.label || 'Выбрано') :
    `${values.length} выбрано`;

  return (
    <div className="relative" ref={ref}>
      <DDTrigger
        icon={<Circle size={13} />}
        label="Статус"
        value={label}
        open={open}
        onClick={() => setOpen(!open)}
      />
      <AnimatePresence>
        {open && (
          <MenuShell width={210}>
            {options.map(opt => {
              const sel = values.includes(opt.id);
              return (
                <MenuItem key={opt.id} selected={sel} onClick={() => toggle(opt.id)}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                  <span className="flex-1">{opt.label}</span>
                  {sel && <Check size={13} className="text-ochre" strokeWidth={2.5}/>}
                </MenuItem>
              );
            })}
            {values.length > 0 && (
              <>
                <div className="h-px bg-line my-1" />
                <button
                  onClick={() => { onChange([]); setOpen(false); }}
                  className="w-full px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-terracotta hover:bg-surface-2 rounded-md transition-colors text-left"
                >
                  Сбросить
                </button>
              </>
            )}
          </MenuShell>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────── ManagerSelector ───────── */

interface ManagerSelectorProps {
  value: string;
  onChange: (val: string) => void;
  users: AppUser[];
}

export function ManagerSelector({ value, onChange, users }: ManagerSelectorProps) {
  const { open, setOpen, ref } = usePopover();
  const selected = users.find(u => u.uid === value);
  const label = selected ? (selected.displayName || '') : 'Все менеджеры';

  return (
    <div className="relative" ref={ref}>
      <DDTrigger
        icon={<UsersIcon size={13} />}
        label="Менеджер"
        value={label}
        open={open}
        onClick={() => setOpen(!open)}
      />
      <AnimatePresence>
        {open && (
          <MenuShell width={240}>
            <MenuItem
              selected={value === ''}
              onClick={() => { onChange(''); setOpen(false); }}
            >
              <span className="w-6 shrink-0" />
              <span className="flex-1">Все менеджеры</span>
              {value === '' && <Check size={13} className="text-ochre" strokeWidth={2.5}/>}
            </MenuItem>
            <div className="h-px bg-line my-1" />
            {users.map(user => {
              const sel = value === user.uid;
              return (
                <MenuItem key={user.uid} selected={sel} onClick={() => { onChange(user.uid); setOpen(false); }}>
                  <UserAvatar uid={user.uid} name={user.displayName || ''} size="xs" />
                  <span className="flex-1 truncate">{user.displayName}</span>
                  {sel && <Check size={13} className="text-ochre" strokeWidth={2.5}/>}
                </MenuItem>
              );
            })}
          </MenuShell>
        )}
      </AnimatePresence>
    </div>
  );
}
