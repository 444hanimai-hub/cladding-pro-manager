import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  LayoutGrid,
  Briefcase,
  BookMarked,
  Settings as SettingsIcon,
  LogOut
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { cn } from '../../lib/utils';
import { AppUser } from '../../types';
import UserAvatar from '../UserAvatar';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  isOpen: boolean;
  onLogout: () => void;
  appUser: AppUser;
  isMobile: boolean;
}

function BrandLogo({ size = 36 }: { size?: number }) {
  return (
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="38" height="38" rx="9" fill="var(--ink)" />
        <path d="M8 30 L20 11 L32 30" stroke="var(--ochre)" strokeWidth="2" strokeLinejoin="miter" />
        <path d="M14 22 L26 22" stroke="var(--ochre)" strokeWidth="2" />
        <path d="M11 30 L29 30" stroke="var(--bg)" strokeWidth="1" opacity="0.4" />
        <circle cx="20" cy="11" r="1.4" fill="var(--ochre)" />
      </svg>
  );
}

const Sidebar = ({ activeTab, onTabChange, isOpen, onLogout, appUser, isMobile }: SidebarProps) => {
  const [projectsCount, setProjectsCount] = useState<number | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'projects'), (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const isOwner = appUser?.email === '444hanimai@gmail.com';
      const accessible = all.filter(p =>
          isOwner ||
          appUser?.fullProjectAccess === true ||
          !!appUser?.projectsAccess?.[p.id] ||
          p.leadManagerId === auth.currentUser?.uid
      );
      setProjectsCount(accessible.length);
    });
    return () => unsub();
  }, [appUser?.uid, appUser?.fullProjectAccess]);

  const navItems = [
    { id: 'dashboard',   label: 'Дашборд',     icon: LayoutGrid,   access: appUser.accessDashboard,  count: null as number | null },
    { id: 'projects',    label: 'Проекты',     icon: Briefcase,    access: true,                      count: projectsCount },
    { id: 'directories', label: 'Справочники', icon: BookMarked,   access: appUser.accessDirectories, count: null },
    { id: 'settings',    label: 'Настройки',   icon: SettingsIcon, access: appUser.accessSettings,    count: null },
  ];

  return (
      <motion.nav
          initial={false}
          animate={{ width: isOpen ? (isMobile ? '100%' : '240px') : '0px' }}
          transition={{ duration: 0.2 }}
          className={cn(
              "fixed lg:relative z-50 h-full border-r border-line flex flex-col bg-bg-elev overflow-hidden",
              !isOpen && "border-none"
          )}
      >
        <div className="w-[240px] flex flex-col h-full">

          {/* Logo */}
          <div className="px-6 pt-7 pb-6 flex items-center gap-3">
            <BrandLogo size={36} />
            <div className="flex flex-col leading-none">
              <span className="font-display text-[19px] font-medium tracking-[0.04em] text-ink leading-none">АРХИХАБ</span>
              <span className="text-[9px] font-semibold tracking-[0.18em] mt-1.5 uppercase text-ink-3">Cladding CRM</span>
            </div>
          </div>

          {/* Section eyebrow */}
          <div className="px-6 pt-3 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">Рабочее пространство</span>
          </div>

          {/* Navigation */}
          <div className="px-3 flex flex-col gap-1">
            {navItems.filter(item => item.access).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                  <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      className={cn(
                          "w-full flex items-center gap-3 px-[10px] py-[9px] rounded-[10px] transition-colors group text-left",
                          isActive
                              ? "bg-ink text-bg"
                              : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                      )}
                  >
                    <Icon
                        size={18}
                        className={cn(
                            "shrink-0 transition-colors",
                            isActive ? "text-ochre" : "text-ink-3 group-hover:text-ink-2"
                        )}
                    />
                    <span className="text-[13px] font-medium flex-1">{item.label}</span>
                    {item.count != null && (
                        <span className={cn(
                            "text-[11px] font-bold rounded-full min-w-[20px] px-[6px] py-[1px] leading-tight text-center",
                            isActive
                                ? "bg-ochre text-white"
                                : "bg-surface-2 text-ink-3"
                        )}>
                    {item.count}
                  </span>
                    )}
                  </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-auto px-6 pb-5">
            <div className="border-t border-dashed border-line pt-3 pb-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Подсказка</div>
              <div className="text-[11.5px] text-ink-3 leading-snug">
                Нажмите{' '}
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-line bg-surface text-[10px] font-semibold text-ink-2 mx-0.5">
                ⌘K
              </span>
                {' '}чтобы быстро найти проект, контакт или мероприятие.
              </div>
            </div>

            <div className="flex items-center gap-2.5 py-2">
              <UserAvatar
                  name={appUser.displayName}
                  uid={appUser.uid}
                  photoURL={appUser.photoURL}
                  size="sm"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-semibold text-ink truncate leading-tight">{appUser.displayName}</p>
                <p className="text-[10.5px] text-ink-3 truncate mt-0.5">{appUser.email}</p>
              </div>
            </div>

            <button
                onClick={onLogout}
                className="flex items-center gap-2 px-1 py-1.5 text-[12px] font-medium text-terracotta/80 hover:text-terracotta w-full transition-colors"
            >
              <LogOut size={13} />
              <span>Выйти</span>
            </button>
          </div>

        </div>
      </motion.nav>
  );
};

export default Sidebar;
