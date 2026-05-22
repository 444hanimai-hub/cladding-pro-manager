import React from 'react';
import { Search, Bell, Menu, Sun, Moon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTheme } from '../../lib/ThemeContext';

interface TopbarProps {
  title: string;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

const Topbar = ({ title, onToggleSidebar, searchQuery, onSearchChange }: TopbarProps) => {
  const { theme, toggleTheme } = useTheme();

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

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative hidden md:block">
          <Search 
            size={14} 
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" 
          />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по проектам, контактам..." 
            className="w-[260px] bg-surface border border-line rounded-full pl-9 pr-12 py-[7px] text-[12.5px] focus:border-ochre focus:bg-bg focus:outline-none transition-colors placeholder:text-ink-4 text-ink"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-line bg-surface-2 text-[10px] font-semibold text-ink-3 pointer-events-none leading-none">
            ⌘K
          </span>
        </div>

        <button 
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          className="w-9 h-9 flex items-center justify-center rounded-full border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button 
          aria-label="Notifications"
          className="w-9 h-9 flex items-center justify-center rounded-full border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors relative"
        >
          <Bell size={15} />
          <span className="absolute top-[9px] right-[10px] w-[6px] h-[6px] rounded-full bg-terracotta border-[1.5px] border-surface" />
        </button>
      </div>
    </header>
  );
};

export default Topbar;
