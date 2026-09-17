import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

interface ProgressProps {
  value: number;
  max?: number;
  className?: string;
  variant?: 'ochre' | 'profit' | 'expense' | 'info';
  size?: 'sm' | 'md';
}

const Progress = ({ value, max = 100, className, variant = 'ochre', size = 'sm' }: ProgressProps) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const colors = {
    ochre: 'bg-ochre',
    profit: 'bg-profit',
    expense: 'bg-expense',
    info: 'bg-info',
  };

  const heights = {
    sm: 'h-1',
    md: 'h-1.5',
  };

  return (
    <div className={cn('w-full rounded-full bg-surface-2 overflow-hidden', heights[size], className)}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${percentage}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className={cn('h-full rounded-full transition-all duration-slow', colors[variant])}
      />
    </div>
  );
};

export { Progress };
