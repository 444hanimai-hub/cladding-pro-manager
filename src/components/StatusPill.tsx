import React from 'react';
import { ProjectStatus, STATUS_LABEL, STATUS_COLOR, STATUS_BG } from '../lib/statuses';

interface StatusPillProps {
  status: ProjectStatus;
  className?: string;
}

export default function StatusPill({ status, className = '' }: StatusPillProps) {
  // Normalize status if it comes as 'lead', 'active', 'completed', 'cancelled'
  const rawStatus = status as string;
  const normalized: ProjectStatus =
    rawStatus === 'lead' || rawStatus === 'active' || rawStatus === 'in_progress' ? 'in_progress' :
    rawStatus === 'completed' || rawStatus === 'done' ? 'done' :
    rawStatus === 'cancelled' || rawStatus === 'canceled' ? 'canceled' :
    rawStatus === 'shipping' ? 'shipping' : 'in_progress';

  const label = STATUS_LABEL[normalized] || 'Неизвестно';
  const color = STATUS_COLOR[normalized];
  const bg = STATUS_BG[normalized];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.04em] shrink-0 ${className}`}
      style={{ backgroundColor: bg, color: color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
