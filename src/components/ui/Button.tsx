import React from 'react';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

type ButtonVariant = 'primary' | 'ochre' | 'soft' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', icon, isLoading, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-ink text-bg hover:bg-ink/90',
      ochre: 'bg-ochre text-bg-elev hover:brightness-95',
      soft: 'bg-surface text-ink border border-line hover:bg-surface-2',
      ghost: 'bg-transparent text-ink-2 border border-line hover:bg-surface hover:text-ink',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-base gap-1.5',
      md: 'px-4 py-2.5 text-base gap-2',
      lg: 'px-5 py-3 text-body gap-2',
    };

    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.98 }}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center font-semibold rounded-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
        ) : (
          icon && <span className="flex-shrink-0 [&>svg]:w-[14px] [&>svg]:h-[14px]">{icon}</span>
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
