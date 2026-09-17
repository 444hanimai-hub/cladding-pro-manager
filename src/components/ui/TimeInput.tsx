import React, { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { Clock } from 'lucide-react';

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  variant?: 'compact' | 'default';
}

export function TimeInput({ value, onChange, className, placeholder = "00:00", variant = 'default' }: TimeInputProps) {
  const [displayValue, setDisplayValue] = useState(value || '');

  useEffect(() => {
    setDisplayValue(value || '');
  }, [value]);

  const parseTime = (input: string) => {
    // Remove non-digit characters
    const digits = input.replace(/\D/g, '');
    
    if (digits.length === 4) {
      const hours = digits.slice(0, 2);
      const mins = digits.slice(2, 4);
      
      const h = parseInt(hours);
      const m = parseInt(mins);
      
      if (h >= 0 && h < 24 && m >= 0 && m < 60) {
        return `${hours}:${mins}`;
      }
    }
    
    // If it's already HH:MM
    if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(input)) {
      return input;
    }
    
    return null;
  };

  const handleBlur = () => {
    const parsed = parseTime(displayValue);
    if (parsed) {
      onChange(parsed);
      setDisplayValue(parsed);
    } else if (displayValue === '') {
      onChange('');
    } else {
      // Revert to last valid value or clear if invalid and doesn't match HH:MM
      setDisplayValue(value || '');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className={cn("relative group", className)}>
      <input
        type="text"
        value={displayValue}
        onChange={(e) => setDisplayValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          variant === 'compact'
            ? "w-full bg-surface border border-line rounded-md px-3 h-11 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors pr-9 placeholder:text-ink-4 font-normal"
            : "w-full border-none rounded-xl px-4 py-2 transition-all font-medium pr-10 bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30 text-xs"
        )}
      />
      <div className={cn(
        "absolute top-1/2 -translate-y-1/2 flex items-center gap-1",
        variant === 'compact' ? "right-3" : "right-3"
      )}>
        <div className="relative">
          <Clock size={variant === 'compact' ? 14 : 14} className={cn(
            "transition-colors cursor-pointer",
            variant === 'compact' ? "text-ink-3" : "text-[#141414]/20 group-hover:text-[#5A5A40]"
          )} />
          <input 
            type="time"
            value={value || ''}
            onChange={(e) => {
              onChange(e.target.value);
              setDisplayValue(e.target.value);
            }}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </div>
      </div>
    </div>
  );
}
