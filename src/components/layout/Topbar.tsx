import React from 'react';
import { Menu } from 'lucide-react';

interface TopbarProps {
  title: string;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  /** Контекстные действия справа — например, переключатель вида (сетка/список)
   * на странице «Проекты». Раньше здесь были поиск/тема/колокольчик — убраны
   * полностью, этот слот теперь единственное, что может быть справа. */
  extraActions?: React.ReactNode;
}

const Topbar = ({ title, onToggleSidebar, extraActions }: TopbarProps) => {
  return (
      <header className="sticky top-0 z-40 h-[60px] bg-bg-elev/85 backdrop-blur-md px-5 border-b border-line flex items-center justify-between gap-5">
        <div className="flex items-center gap-4 min-w-0">
          <button
              onClick={onToggleSidebar}
              aria-label="Toggle sidebar"
              className="w-9 h-9 flex items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors shrink-0"
          >
            <Menu size={18} />
          </button>

          <h1 className="font-display text-[22px] font-normal text-ink tracking-[-0.01em] leading-none truncate">
            {title}
          </h1>
        </div>

        {extraActions && (
            <div className="flex items-center gap-2 shrink-0">
              {extraActions}
            </div>
        )}
      </header>
  );
};

export default Topbar;
