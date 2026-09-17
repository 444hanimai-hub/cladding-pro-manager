import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  variant?: 'compact' | 'default';
}

export function DatePicker({ value, onChange, className, placeholder = 'дд.мм.гггг', variant = 'default' }: DatePickerProps) {
  const [inputValue, setInputValue] = useState('');
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Format YYYY-MM-DD to DD.MM.YYYY
  const formatToDisplay = (val: string) => {
    if (!val) return '';
    const [year, month, day] = val.split('-');
    if (!year || !month || !day) return '';
    return `${day}.${month}.${year}`;
  };

  // Parse various inputs to YYYY-MM-DD
  const parseInput = (val: string): string | null => {
    // Remove all non-digits
    const digits = val.replace(/\D/g, '');
    const currentYear = new Date().getFullYear();

    if (digits.length === 4) {
      // DDMM -> YYYY-MM-DD
      const day = digits.slice(0, 2);
      const month = digits.slice(2, 4);
      return `${currentYear}-${month}-${day}`;
    } else if (digits.length === 8) {
      // DDMMYYYY -> YYYY-MM-DD
      const day = digits.slice(0, 2);
      const month = digits.slice(2, 4);
      const year = digits.slice(4, 8);
      return `${year}-${month}-${day}`;
    }
    
    // Check if it's already in DD.MM.YYYY or similar
    const parts = val.split(/[\.\-\/]/);
    if (parts.length === 3) {
      let [d, m, y] = parts;
      if (d.length === 1) d = '0' + d;
      if (m.length === 1) m = '0' + m;
      if (y.length === 2) y = '20' + y;
      if (y.length === 4 && d.length === 2 && m.length === 2) {
        return `${y}-${m}-${d}`;
      }
    }

    return null;
  };

  useEffect(() => {
    setInputValue(formatToDisplay(value));
  }, [value]);

  const handleBlur = () => {
    const parsed = parseInput(inputValue);
    if (parsed) {
      onChange(parsed);
      setInputValue(formatToDisplay(parsed));
    } else if (!inputValue) {
      onChange('');
    } else {
      // Revert to current value if invalid
      setInputValue(formatToDisplay(value));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!inputValue) {
        const today = new Date().toISOString().split('T')[0];
        onChange(today);
        setInputValue(formatToDisplay(today));
      } else {
        handleBlur();
      }
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      dateInputRef.current?.showPicker();
    } catch (err) {
      dateInputRef.current?.click();
    }
  };

  return (
    <div className={cn("relative group", className)}>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          variant === 'compact'
            ? "w-full bg-surface border border-line rounded-md px-3 py-2 text-[14px] text-ink focus:border-ochre focus:outline-none focus:ring-0 transition-colors pr-9 placeholder:text-ink-4 font-normal"
            : "w-full border-none rounded-2xl px-6 py-4 focus:ring-2 transition-all font-medium text-sm pr-12 bg-white/50 text-[#141414] focus:ring-[#5A5A40]/30 placeholder:text-[#141414]/20"
        )}
      />
      
      <div className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-md transition-colors flex items-center justify-center pointer-events-none",
        variant === 'compact' ? "right-3" : "right-6"
      )}>
        <CalendarIcon 
          size={variant === 'compact' ? 14 : 16} 
          className={cn(
            "transition-colors",
            variant === 'compact'
              ? "text-ink-3"
              : "text-[#141414]/40 group-hover:text-[#141414]"
          )}
        />
      </div>

      {/* Styled as a right-aligned invisible overlay to ensure native popover drops down to the left */}
      <input
        type="date"
        ref={dateInputRef}
        dir="rtl"
        value={value || ''}
        onChange={(e) => {
          onChange(e.target.value);
          setInputValue(formatToDisplay(e.target.value));
        }}
        className="absolute right-0 top-0 h-full w-[100px] opacity-0 cursor-pointer z-10 pointer-events-auto"
        style={{ colorScheme: 'light' }}
      />
    </div>
  );
}
