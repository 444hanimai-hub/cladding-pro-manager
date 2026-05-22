import React from 'react';
import { cn } from '../../lib/utils';

type StatusVariant = 'in-progress' | 'shipping' | 'done' | 'canceled' | 'overdue' | 'lead';

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: StatusVariant;
  isOverdue?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const Pill = ({ className, variant = 'in-progress', isOverdue, children, ...props }: PillProps) => {
  const variants = {
    'lead': 'bg-status-blue-bg text-status-blue',
    'in-progress': 'bg-status-blue-bg text-status-blue',
    'shipping': 'bg-status-green-bg text-status-green',
    'done': 'bg-status-emerald-bg text-status-emerald',
    'canceled': 'bg-status-red-bg text-status-red',
    'overdue': 'bg-status-red-bg text-status-red',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] transition-all whitespace-nowrap',
        variants[variant],
        isOverdue && 'animate-pulse ring-1 ring-status-red/30',
        className
      )}
      {...props}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
};

export { Pill };
