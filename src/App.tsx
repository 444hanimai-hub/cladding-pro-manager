import React, { useState, useEffect } from 'react';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { connectGoogleCalendar } from './services/googleCalendarAuth';
import { verifyCalendarAccess } from './services/googleCalendarService';
import { doc, getDoc, setDoc, collection, onSnapshot, query, where, orderBy, getDocFromServer, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import {
  Plus,
  LayoutDashboard,
  Briefcase,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Search,
  Bell,
  Calendar,
  ChevronRight,
  TrendingUp,
  DollarSign,
  Package,
  Clock,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { formatCurrency, cn } from './lib/utils';
import { useTheme } from './lib/ThemeContext';
import { Sun, Moon } from 'lucide-react';

import { Project, AppUser } from './types';

import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';

import ProjectList from './components/ProjectList';
import ProjectDetail from './components/ProjectDetail';
import Dashboard from './components/Dashboard';
import DirectoryManager from './components/DirectoryManager';
import Settings from './components/Settings';

const ACCESS_TOKEN_KEY = 'google_calendar_access_token';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem(ACCESS_TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'projects' | 'directories' | 'settings'>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const handleSelectTask = (projectId: string, taskId: string) => {
    setSelectedTaskId(taskId);
    setSelectedProjectId(projectId);
  };
  const [accessDenied, setAccessDenied] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { theme, toggleTheme } = useTheme();

  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 1024 : false;

  const handleNavClick = (tab: any) => {
    setActiveTab(tab);
    setSelectedProjectId(null);
    setSelectedTaskId(null);
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  useEffect(() => {
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(true);
    }
  }, []);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    let userDocUnsubscribe: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setAccessDenied(false);
      setUser(user);

      if (!user) {
        setAccessToken(null);
        localStorage.removeItem(ACCESS_TOKEN_KEY);
      }

      if (userDocUnsubscribe) {
        userDocUnsubscribe();
        userDocUnsubscribe = null;
      }

      if (user) {
        setLoading(true);
        const isOwner = user.email === '444hanimai@gmail.com';

        const normalizedEmail = user.email?.toLowerCase().trim();
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', normalizedEmail));
        const querySnap = await getDocs(q);

        // ── Защита от дублей: если несколько документов с одним email ──────
        // Оставляем только один (приоритет — документ с id == user.uid, иначе первый)
        if (querySnap.docs.length > 1) {
          const correctDoc = querySnap.docs.find(d => d.id === user.uid) || querySnap.docs[0];
          const duplicates = querySnap.docs.filter(d => d.id !== correctDoc.id);
          // Удаляем все дубли тихо
          await Promise.all(duplicates.map(d => deleteDoc(doc(db, 'users', d.id))));

          // Если нужного документа с uid нет — мигрируем из correctDoc
          if (correctDoc.id !== user.uid) {
            const dataToMove = correctDoc.data();
            await setDoc(doc(db, 'users', user.uid), {
              ...dataToMove,
              uid: user.uid,
              photoURL: user.photoURL || dataToMove.photoURL || ''
            });
            await deleteDoc(doc(db, 'users', correctDoc.id));
          }
        } else if (querySnap.docs.length === 1) {
          const docSnap = querySnap.docs[0];
          if (docSnap.id !== user.uid) {
            // Pre-registered user logging in for the first time
            const dataToMove = docSnap.data();
            await setDoc(doc(db, 'users', user.uid), {
              ...dataToMove,
              uid: user.uid,
              accessDashboard: dataToMove.accessDashboard ?? false,
              fullProjectAccess: dataToMove.fullProjectAccess ?? false,
              accessDirectories: dataToMove.accessDirectories ?? true,
              accessSettings: dataToMove.accessSettings ?? false,
              photoURL: user.photoURL || dataToMove.photoURL || ''
            });
            await deleteDoc(doc(db, 'users', docSnap.id));
          }
        } else {
          // Новый пользователь — создаём документ
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Пользователь',
            photoURL: user.photoURL || '',
            accessDashboard: isOwner,
            fullProjectAccess: isOwner,
            accessDirectories: isOwner,
            accessSettings: isOwner,
            createdAt: new Date()
          });
        }

        userDocUnsubscribe = onSnapshot(doc(db, 'users', user.uid), (snap) => {
          if (snap.exists()) {
            const data = snap.data() as AppUser;
            setAppUser({ uid: snap.id, ...data });

            if (user.email === '444hanimai@gmail.com' && !data.accessSettings) {
              updateDoc(doc(db, 'users', user.uid), {
                accessSettings: true
              });
            }
          }
          setLoading(false);
        });
      } else {
        setAppUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (userDocUnsubscribe) userDocUnsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!appUser) return;

    const canDashboard = appUser.accessDashboard;
    const canDirectories = appUser.accessDirectories;
    const canSettings = appUser.accessSettings;

    if (activeTab === 'dashboard' && !canDashboard) {
      setActiveTab('projects');
    } else if (activeTab === 'directories' && !canDirectories) {
      if (canDashboard) setActiveTab('dashboard');
      else setActiveTab('projects');
    } else if (activeTab === 'settings' && !canSettings) {
      if (canDashboard) setActiveTab('dashboard');
      else setActiveTab('projects');
    }
  }, [appUser, activeTab]);

  const onClearCalendarToken = () => {
    setAccessToken(null);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  };

  const loginWithCalendar = async (): Promise<boolean> => {
    try {
      const token = await connectGoogleCalendar();
      if (!token) {
        alert('Не удалось получить доступ к Google Календарю. Выберите аккаунт и разрешите доступ к календарю.');
        return false;
      }

      const { valid, unauthorized } = await verifyCalendarAccess(token);
      if (!valid) {
        if (unauthorized) {
          alert('Google не выдал доступ к календарю. Попробуйте снова и отметьте все запрошенные разрешения.');
        } else {
          alert('Не удалось проверить подключение к календарю. Проверьте интернет и попробуйте ещё раз.');
        }
        return false;
      }

      setAccessToken(token);
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
      return true;
    } catch (error: unknown) {
      const code =
          error && typeof error === 'object' && 'code' in error
              ? String((error as { code: string }).code)
              : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return false;
      }
      console.error('Calendar connect failed', error);
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      alert('Ошибка подключения календаря: ' + message);
      return false;
    }
  };

  const logout = () => signOut(auth);

  if (loading) {
    return (
        <div className={cn("flex items-center justify-center min-h-screen", theme === 'dark' ? "bg-[#12120e]" : "bg-[#F5F5F0]")}>
          <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className={cn("w-8 h-8 border-2 border-t-transparent rounded-full", theme === 'dark' ? "border-[#c4a484]" : "border-[#5A5A40]")}
          />
        </div>
    );
  }

  if (accessDenied) {
    return (
        <div className={cn("flex flex-col items-center justify-center min-h-screen p-4 text-[#e5e5e0]", theme === 'dark' ? "bg-[#12120e]" : "bg-[#F5F5F0]")}>
          <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("max-w-md w-full p-12 rounded-2xl shadow-sm border text-center", theme === 'dark' ? "bg-[#1c1c16] border-[#e5e5e0]/5 text-[#e5e5e0]" : "bg-white border-[#141414]/5 text-[#141414]")}
          >
            <div className="w-16 h-16 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-8">
              <XCircle size={32} />
            </div>
            <h1 className="text-3xl font-serif font-medium mb-4">Доступ ограничен</h1>
            <p className={cn("mb-10 text-balance", theme === 'dark' ? "text-[#e5e5e0]/60" : "text-[#141414]/60")}>
              Ваш аккаунт не найден в списке разрешенных. Обратитесь к администратору.
            </p>
            <button
                onClick={() => { setAccessDenied(false); signOut(auth); }}
                className={cn("w-full flex items-center justify-center gap-3 py-4 px-6 rounded-full font-medium transition-all", theme === 'dark' ? "bg-[#e5e5e0] text-[#12120e] hover:bg-[#e5e5e0]/90" : "bg-[#141414] text-white hover:bg-[#141414]/90")}
            >
              Вернуться ко входу
            </button>
          </motion.div>
        </div>
    );
  }

  if (!appUser) {
    return (
        <div className={cn("flex flex-col items-center justify-center min-h-screen p-4", theme === 'dark' ? "bg-[#12120e] text-[#e5e5e0]" : "bg-[#F5F5F0] text-[#141414]")}>
          <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("max-w-md w-full p-12 rounded-2xl shadow-sm border text-center", theme === 'dark' ? "bg-[#1c1c16] border-white/5" : "bg-white border-[#141414]/5")}
          >
            <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-lg", theme === 'dark' ? "bg-[#c4a484]" : "bg-[#5A5A40]")}>
              <Briefcase className={cn("w-8 h-8", theme === 'dark' ? "text-[#12120e]" : "text-white")} />
            </div>
            <h1 className="text-3xl font-serif font-medium mb-4">Cladding Pro Manager</h1>
            <p className={cn("mb-10 text-balance", theme === 'dark' ? "text-[#e5e5e0]/60" : "text-[#141414]/60")}>
              Войдите в систему для управления проектами по подбору и поставке облицовочного материала
            </p>
            <button
                onClick={loginWithCalendar}
                className={cn("w-full flex items-center justify-center gap-3 py-4 px-6 rounded-full font-medium transition-all active:scale-95", theme === 'dark' ? "bg-[#e5e5e0] text-[#12120e] hover:bg-[#e5e5e0]/90" : "bg-[#141414] text-white hover:bg-[#141414]/90")}
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 bg-white rounded-full" alt="Google" />
              Войти через Google
            </button>
          </motion.div>
        </div>
    );
  }

  const isSmallScreen = typeof window !== 'undefined' && window.screen.width <= 1440;
  const appScale = isSmallScreen ? 0.82 : 1;

  return (
      <div
          className="flex bg-bg transition-colors duration-base overflow-hidden"
          style={{
            zoom: appScale,
            height: `${100 / appScale}vh`,
            width: `${100 / appScale}%`,
          }}
      >
        <AnimatePresence>
          {isSidebarOpen && isMobile && (
              <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => setIsSidebarOpen(false)}
                  className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm lg:hidden"
              />
          )}
        </AnimatePresence>

        <Sidebar
            activeTab={activeTab}
            onTabChange={handleNavClick}
            isOpen={isSidebarOpen}
            onLogout={logout}
            appUser={appUser}
            isMobile={isMobile}
        />

        <div className="flex-1 flex flex-col min-w-0 transition-all duration-base">
          <Topbar
              title={
                selectedProjectId
                    ? ''
                    : activeTab === 'dashboard' ? 'Дашборд'
                        : activeTab === 'projects' ? 'Проекты'
                            : activeTab === 'directories' ? 'Справочники'
                                : 'Настройки'
              }
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              isSidebarOpen={isSidebarOpen}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
          />

          <main className="flex-1 overflow-y-auto p-4 scroll-smooth">
            <AnimatePresence mode="wait">
              <motion.div
                  key={selectedProjectId || activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: [0.3, 0.7, 0.4, 1] }}
              >
                {selectedProjectId ? (
                    <ProjectDetail
                        projectId={selectedProjectId}
                        initialTaskId={selectedTaskId}
                        onBack={() => { setSelectedProjectId(null); setSelectedTaskId(null); }}
                        appUser={appUser}
                        accessToken={accessToken}
                        onConnectCalendar={loginWithCalendar}
                        onClearCalendarToken={onClearCalendarToken}
                    />
                ) : activeTab === 'dashboard' ? (
                    <Dashboard
                        onSelectProject={id => { setSelectedProjectId(id); setActiveTab('projects'); }}
                        onSelectTask={handleSelectTask}
                        onViewAllProjects={() => setActiveTab('projects')}
                        appUser={appUser}
                    />
                ) : activeTab === 'projects' ? (
                    <ProjectList onSelectProject={setSelectedProjectId} appUser={appUser} />
                ) : activeTab === 'directories' ? (
                    <DirectoryManager appUser={appUser} />
                ) : (
                    <Settings appUser={appUser} />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
  );
}
