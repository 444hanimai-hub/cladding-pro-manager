import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

const Tabs = ({ tabs, activeTab, onChange, className }: TabsProps) => {
  return (
    <div className={cn('flex gap-1 border-b border-line', className)}>
      {tabs.map((tab) => {
        const isSelected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            aria-selected={isSelected}
            className={cn(
              'relative px-4 py-2.5 text-base font-semibold uppercase tracking-wider transition-all duration-base',
              'text-ink-3 border-b-2 border-transparent hover:text-ink-2',
              'aria-selected:text-ink inline-flex items-center gap-2'
            )}
          >
            {tab.icon && <span className="flex-shrink-0 [&>svg]:w-[14px] [&>svg]:h-[14px]">{tab.icon}</span>}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'px-1.5 py-0.5 text-[10px] rounded-full transition-colors',
                  isSelected ? 'bg-ochre-bg text-ochre' : 'bg-surface-2 text-ink-3'
                )}
              >
                {tab.count}
              </span>
            )}
            {isSelected && (
              <motion.div
                layoutId="tab-underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-ochre"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

export { Tabs };
