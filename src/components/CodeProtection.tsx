import React, { useState } from 'react';
import { Lock, Key, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface CodeProtectionProps {
  correctCode: string;
  onSuccess: () => void;
  title?: string;
}

export default function CodeProtection({ correctCode, onSuccess, title = "Доступ ограничен" }: CodeProtectionProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code === correctCode) {
      onSuccess();
    } else {
      setError(true);
      setTimeout(() => setError(false), 500);
      setCode('');
    }
  };

  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-12 rounded-2xl shadow-sm border transition-colors",
      "bg-white border-[#141414]/5"
    )}>
      <div className={cn(
        "w-16 h-16 rounded-3xl flex items-center justify-center mb-8",
        "bg-[#F5F5F0] text-[#5A5A40]"
      )}>
        <Lock size={32} />
      </div>
      
      <h3 className={cn("text-2xl font-serif font-medium mb-2", "text-[#141414]")}>{title}</h3>
      <p className={cn("text-sm mb-8", "text-[#141414]/40")}>Введите код доступа для работы с разделом</p>

      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <div className="relative">
          <input 
            type="password"
            autoFocus
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Введите код..."
            className={cn(
              "w-full border-none rounded-2xl px-6 py-4 text-center font-mono text-xl tracking-[0.5em] transition-all",
              "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/10",
              error ? "ring-2 ring-rose-500 bg-rose-50" : ""
            )}
          />
        </div>
        <button 
          type="submit"
          className={cn(
            "w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2",
            "bg-[#141414] text-white hover:bg-[#141414]/90"
          )}
        >
          Подтвердить <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
}
