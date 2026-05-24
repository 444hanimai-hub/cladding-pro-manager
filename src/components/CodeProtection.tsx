import React, { useState } from 'react';
import { Lock, Key, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/Button';

interface CodeProtectionProps {
  correctCode: string;
  onSuccess: () => void;
  title?: string;
  subtitle?: string;
  className?: string;
}

export default function CodeProtection({
  correctCode,
  onSuccess,
  title = 'Доступ к финансовым данным',
  subtitle = 'Введите код доступа для просмотра финансовых показателей',
  className,
}: CodeProtectionProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code === correctCode) {
      onSuccess();
    } else {
      setError(true);
      setCode('');
    }
  };

  return (
    <div
      className={cn(
        'w-full max-w-md rounded-2xl border border-line bg-surface p-8',
        'shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]',
        className
      )}
    >
      <div className="flex flex-col items-center text-center mb-8">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface-2 text-ochre">
          <Lock size={26} strokeWidth={1.75} />
        </div>
        <h3 className="font-display text-[22px] font-medium text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink-3">{subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block px-1 text-eyebrow text-ink-3">Код доступа</label>
          <div className="relative">
            <Key size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-4" />
            <input
              type="password"
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(false);
              }}
              placeholder="Введите код"
              className={cn(
                'w-full rounded-xl border bg-surface-2 py-3 pl-11 pr-4 text-sm font-mono text-ink transition-all',
                'placeholder:text-ink-4 focus:border-ochre/40 focus:outline-none focus:ring-2 focus:ring-ochre/15',
                error ? 'border-terracotta/50 ring-2 ring-terracotta/15' : 'border-line'
              )}
            />
          </div>
        </div>
        {error && (
          <p className="text-center text-sm font-medium text-terracotta">
            Код неверный. Попробуйте ещё раз.
          </p>
        )}
        <Button
          type="submit"
          variant="ochre"
          className="w-full h-11 text-[13px]"
          icon={<ArrowRight size={16} />}
        >
          Подтвердить
        </Button>
      </form>
    </div>
  );
}

/** Обёртка для экранов Дашборд / Проекты */
export function FinanceCodeGate({
  correctCode,
  onSuccess,
  moduleName,
}: {
  correctCode: string;
  onSuccess: () => void;
  moduleName: string;
}) {
  return (
    <div className="flex min-h-[min(480px,65vh)] items-center justify-center px-4 py-12">
      <CodeProtection
        correctCode={correctCode}
        onSuccess={onSuccess}
        subtitle={`Для просмотра раздела «${moduleName}» введите код доступа`}
      />
    </div>
  );
}
