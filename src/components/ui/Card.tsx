import React from 'react';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  isOverdue?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, hoverable, isOverdue, header, footer, action, children, ...props }, ref) => {
    const CardContent = (
      <div
        className={cn(
          'bg-surface border border-line rounded-2xl overflow-hidden transition-all duration-base shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]',
          hoverable && 'hover:-translate-y-0.5 hover:shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_8px_24px_-8px_rgba(48,42,28,0.18)] cursor-pointer',
          isOverdue && 'border-l-[3px] border-l-terracotta',
          className
        )}
        {...props}
      >
        {header && (
          <div className="px-5 py-[14px] border-b border-line flex items-center justify-between gap-3">
            <div className="font-display text-[17px] font-medium text-ink leading-tight">{header}</div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
        <div className="p-5 flex-1 flex flex-col">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-line bg-surface-2/50">
            {footer}
          </div>
        )}
      </div>
    );

    if (hoverable) {
      return (
        <motion.div
          ref={ref}
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
        >
          {CardContent}
        </motion.div>
      );
    }

    return <div ref={ref}>{CardContent}</div>;
  }
);

Card.displayName = 'Card';

export { Card };
