import React from 'react';
import { cn } from '../../lib/utils';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  className?: string;
}

const Label = ({ className, ...props }: LabelProps) => (
  <label
    className={cn(
      'text-eyebrow text-ink-3 uppercase tracking-wider font-semibold mb-1.5 block',
      className
    )}
    {...props}
  />
);

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={cn(
            'w-full bg-surface border border-line rounded-md px-3 py-2 text-body transition-all duration-base',
            'placeholder:text-ink-4 focus:border-ochre focus:bg-bg focus:outline-none',
            error && 'border-status-canceled',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-status-canceled mt-1 font-medium">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <div className="w-full">
        <select
          ref={ref}
          className={cn(
            'w-full bg-surface border border-line rounded-md px-3 py-2 text-body transition-all duration-base',
            'focus:border-ochre focus:bg-bg focus:outline-none appearance-none',
            error && 'border-status-canceled',
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-status-canceled mt-1 font-medium">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export { Input, Label, Select };
