import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, updateDoc, doc, getDocs, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppUser, Project } from '../types';
import UserAvatar from './UserAvatar';
import { 
  Users, 
  Shield, 
  Lock, 
  Eye, 
  Edit3, 
  Search,
  CheckCircle2,
  XCircle,
  Key,
  Plus,
  Trash2,
  UserPlus,
  MapPin,
  ChevronRight,
  LayoutDashboard,
  PenTool,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export default function Settings({ appUser }: { appUser: AppUser | null }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showProjectSelector, setShowProjectSelector] = useState(false);

  // New user state
  const [newUser, setNewUser] = useState<Partial<AppUser>>({
    displayName: '',
    email: '',
    accessDashboard: false,
    fullProjectAccess: false,
    accessDirectories: false,
    accessSettings: false,
    projectsAccess: {},
    photoURL: ''
  });

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser)));
    });
    const unsubProjects = onSnapshot(collection(db, 'projects'), (snap) => {
      setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    });
    return () => { unsubUsers(); unsubProjects(); };
  }, []);

  const dropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProjectSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedUser = users.find(u => u.uid === selectedUserId);

  const financeCodeRequired = (user: Partial<AppUser> | undefined) =>
    Boolean(user?.accessDashboard && user?.requireFinanceCode);

  const assertFinanceCodeIfRequired = (user: Partial<AppUser> | undefined): boolean => {
    if (!financeCodeRequired(user)) return true;
    if ((user?.financeCode || '').trim()) return true;
    window.alert('Укажите код доступа к финансам при включённом «Запрашивать код»');
    return false;
  };
  
  const handleSaveNewUser = async () => {
    if (!newUser.email || !newUser.displayName) return;
    if (!assertFinanceCodeIfRequired(newUser)) return;
    
    const normalizedEmail = newUser.email.toLowerCase().trim();
    const tempUid = `temp_${Date.now()}`;
    await setDoc(doc(db, 'users', tempUid), {
      ...newUser,
      email: normalizedEmail,
      uid: tempUid,
      createdAt: new Date()
    });
    
    setNewUser({
      displayName: '',
      email: '',
      accessDashboard: false,
      fullProjectAccess: false,
      accessDirectories: false,
      accessSettings: false,
      projectsAccess: {},
      photoURL: ''
    });
    setIsCreating(false);
    setSelectedUserId(tempUid);
  };

  const deleteUser = async (uid: string) => {
    if (window.confirm('Удалить пользователя из системы?')) {
      await deleteDoc(doc(db, 'users', uid));
      if (selectedUserId === uid) setSelectedUserId(null);
    }
  };

  const filteredUsers = users.filter(u => 
    (u.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.email || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

   const updateUser = async (uid: string, updates: Partial<AppUser>) => {
    const base = isCreating ? newUser : selectedUser;
    const merged = { ...base, ...updates };
    if (!assertFinanceCodeIfRequired(merged)) return;

    if (isCreating) {
      setNewUser(prev => ({ ...prev, ...updates }));
    } else {
      await updateDoc(doc(db, 'users', uid), updates);
    }
  };

  const updateProjectAccess = (projectId: string, access: 'view' | 'edit' | null) => {
    const currentAccess = isCreating ? newUser.projectsAccess : selectedUser?.projectsAccess;
    const projectsAccess = { ...(currentAccess || {}) };
    
    if (access === null) {
      delete projectsAccess[projectId];
    } else {
      projectsAccess[projectId] = access;
    }

    if (isCreating) {
      setNewUser(prev => ({ ...prev, projectsAccess }));
    } else if (selectedUserId) {
      updateUser(selectedUserId, { projectsAccess });
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className={cn(
          "rounded-2xl border shadow-sm p-8 space-y-6 flex flex-col transition-colors",
          "bg-white border-[#141414]/5"
        )}>
          <div className="flex items-center justify-between">
            <h3 className={cn("text-xl font-serif font-medium", "text-[#141414]")}>Пользователи</h3>
            <button 
              onClick={() => { setIsCreating(true); setSelectedUserId(null); }}
              className={cn(
                "p-2 rounded-xl transition-all",
                isCreating 
                  ? ("bg-[#5A5A40] text-white")
                  : ("hover:bg-[#141414]/5 text-[#5A5A40]")
              )}
            >
              <UserPlus size={20} />
            </button>
          </div>

          <div className="relative">
            <Search className={cn("absolute left-4 top-1/2 -translate-y-1/2", "text-[#141414]/20")} size={16} />
            <input 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Поиск..."
              className={cn(
                "w-full rounded-2xl pl-10 pr-4 py-3 text-sm transition-all focus:ring-1 border",
                "bg-[#F5F5F0] text-[#141414] border-transparent focus:ring-[#5A5A40]/30"
              )}
            />
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto no-scrollbar min-h-0">
            {filteredUsers.map(user => (
              <div key={user.uid} className="group relative">
                <button 
                  onClick={() => { setSelectedUserId(user.uid); setIsCreating(false); }}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-3xl transition-all text-left pr-12",
                    selectedUserId === user.uid 
                      ? ("bg-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20") 
                      : ("hover:bg-[#141414]/5")
                  )}
                >
                  <UserAvatar 
                    name={user.displayName} 
                    uid={user.uid} 
                    photoURL={user.photoURL} 
                    size="md"
                    className={cn(
                      "border-2", 
                      selectedUserId === user.uid 
                        ? ("border-white/20") 
                        : ("border-[#141414]/10")
                    )}
                  />
                  <div className="flex-1 overflow-hidden">
                    <p className={cn("font-bold text-sm truncate", selectedUserId === user.uid ? ("text-white") : ("text-[#141414]"))}>{user.displayName}</p>
                    <p className={cn("text-[10px] uppercase tracking-widest font-bold", selectedUserId === user.uid ? ("text-white/60") : ("text-[#141414]/40"))}>
                      {user.email}
                    </p>
                  </div>
                </button>
                {user.email !== '444hanimai@gmail.com' && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteUser(user.uid); }}
                    className={cn(
                      "absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all text-rose-500 hover:bg-rose-500/10",
                      selectedUserId === user.uid ? ("text-white/60 hover:text-white") : ""
                    )}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className={cn(
          "lg:col-span-2 rounded-2xl border p-10 transition-colors shadow-sm",
          "bg-white border-[#141414]/5 shadow-xl shadow-[#141414]/5"
        )}>
          {(selectedUser || isCreating) ? (
            <div className="space-y-12">
              <div className="flex items-center gap-6">
                <UserAvatar 
                  name={isCreating ? (newUser.displayName || '') : (selectedUser?.displayName || '')} 
                  uid={isCreating ? '' : (selectedUser?.uid || '')} 
                  photoURL={isCreating ? newUser.photoURL : selectedUser?.photoURL}
                  size="lg"
                  className="w-20 h-20 text-2xl"
                />
                <div className="flex-1 space-y-4">
                  {isCreating ? (
                    <>
                      <div className="space-y-2">
                        <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-2", "text-[#141414]/20")}>Имя пользователя</label>
                        <input 
                          value={newUser.displayName}
                          onChange={e => setNewUser(prev => ({ ...prev, displayName: e.target.value }))}
                          placeholder="Введите имя..."
                          className={cn(
                            "w-full border-none rounded-2xl px-6 py-3 text-xl font-serif focus:ring-1",
                            "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                          )}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-2", "text-[#141414]/20")}>Аккаунт (Google Email)</label>
                        <input 
                          value={newUser.email}
                          onChange={e => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                          placeholder="email@gmail.com"
                          className={cn(
                            "w-full border-none rounded-2xl px-6 py-2 text-sm focus:ring-1",
                            "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                          )}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className={cn("text-3xl font-serif font-medium", "text-[#141414]")}>{selectedUser?.displayName}</h2>
                      <p className={cn("text-sm transition-colors", "text-[#141414]/40")}>{selectedUser?.email}</p>
                    </>
                  )}
                </div>
                {isCreating && (
                  <button 
                    onClick={handleSaveNewUser}
                    className={cn(
                      "px-8 py-3 rounded-2xl font-bold text-xs uppercase tracking-[0.2em] transition-all shadow-lg active:scale-95",
                      "bg-[#141414] text-white hover:bg-black shadow-[#141414]/20"
                    )}
                  >
                    Сохранить
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-4">
                <div className="space-y-4">
                  <p className={cn("text-[10px] font-bold uppercase tracking-[0.2em]", "text-[#141414]/20")}>Доступ к разделам</p>
                  <div className="grid grid-cols-1 gap-3">
                    <PermissionToggle 
                      label="Дашборд" 
                      isEnabled={isCreating ? (newUser.accessDashboard || false) : (selectedUser?.accessDashboard || false)} 
                      onChange={(val) => {
                        const updates: Partial<AppUser> = { accessDashboard: val };
                        if (!val) {
                          updates.requireFinanceCode = false;
                          updates.financeCode = '';
                        }
                        updateUser(selectedUserId!, updates);
                      }}
                    />
                    <PermissionToggle 
                      label="Справочники" 
                      isEnabled={isCreating ? (newUser.accessDirectories || false) : (selectedUser?.accessDirectories || false)} 
                      onChange={(val) => updateUser(selectedUserId!, { accessDirectories: val })}
                    />
                    <PermissionToggle 
                      label="Настройки" 
                      isEnabled={isCreating ? (newUser.accessSettings || false) : (selectedUser?.accessSettings || false)} 
                      onChange={(val) => updateUser(selectedUserId!, { accessSettings: val })}
                    />
                  </div>
                </div>

                {(isCreating ? newUser.accessDashboard : selectedUser?.accessDashboard) && (
                  <div className="space-y-4">
                    <p className={cn("text-[10px] font-bold uppercase tracking-[0.2em]", "text-[#141414]/20")}>Запрашивать код</p>
                    <div className={cn(
                      "p-6 rounded-2xl space-y-4 border transition-colors",
                      "bg-[#F5F5F0] border-[#141414]/5 shadow-inner"
                    )}>
                      <PermissionToggle 
                        label="Запрашивать код" 
                        isEnabled={isCreating ? (newUser.requireFinanceCode || false) : (selectedUser?.requireFinanceCode || false)} 
                        onChange={(val) => {
                          if (val) {
                            const code = (isCreating ? newUser.financeCode : selectedUser?.financeCode)?.trim();
                            if (!code) {
                              window.alert('Сначала укажите код доступа к финансам');
                              return;
                            }
                          }
                          const updates: Partial<AppUser> = { requireFinanceCode: val };
                          if (!val) updates.financeCode = '';
                          updateUser(selectedUserId!, updates);
                        }}
                      />
                      <div className="pt-0">
                        <label className={cn("text-[10px] font-bold uppercase tracking-widest block mb-2 px-2", "text-[#141414]/20")}>Код доступа к финансам</label>
                        <div className="relative">
                          <Key size={16} className={cn("absolute left-4 top-1/2 -translate-y-1/2", "text-[#141414]/20")} />
                          <input 
                            maxLength={10}
                            placeholder={!(isCreating ? newUser.requireFinanceCode : selectedUser?.requireFinanceCode) ? "Код не требуется" : "Код (до 10 симв)"}
                            disabled={!(isCreating ? newUser.requireFinanceCode : selectedUser?.requireFinanceCode)}
                            value={(isCreating ? newUser.financeCode : selectedUser?.financeCode) || ''}
                            onChange={e => updateUser(selectedUserId!, { financeCode: e.target.value })}
                            className={cn(
                              "w-full border-none rounded-2xl pl-10 pr-4 py-3 text-sm font-mono transition-all",
                              "bg-white text-[#141414] shadow-sm",
                              !(isCreating ? newUser.requireFinanceCode : selectedUser?.requireFinanceCode) && "opacity-20 cursor-not-allowed"
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-6 relative" ref={dropdownRef}>
                <div className={cn("flex flex-wrap items-center justify-between border-t pt-8 gap-4", "border-[#141414]/5")}>
                  <div className="flex-1 min-w-[300px]">
                    <div className="flex flex-wrap items-center gap-3">
                       <button 
                        onClick={() => updateUser(selectedUserId!, { fullProjectAccess: false })}
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-all shadow-sm",
                          !(isCreating ? newUser.fullProjectAccess : selectedUser?.fullProjectAccess) 
                            ? ("bg-[#5A5A40] text-white") 
                            : ("text-[#141414]/40 hover:text-[#141414] hover:bg-[#141414]/5")
                        )}
                      >
                        Доступ к проектам ограничен
                      </button>
                      <button 
                        onClick={() => updateUser(selectedUserId!, { fullProjectAccess: true })}
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl transition-all shadow-sm",
                          (isCreating ? newUser.fullProjectAccess : selectedUser?.fullProjectAccess) 
                            ? ("bg-[#5A5A40] text-white") 
                            : ("text-[#141414]/40 hover:text-[#141414] hover:bg-[#141414]/5")
                        )}
                      >
                        Полный доступ ко всем проектам
                      </button>
                    </div>
                  </div>
                  
                  {!(isCreating ? newUser.fullProjectAccess : selectedUser?.fullProjectAccess) && (
                    <button 
                      onClick={() => setShowProjectSelector(!showProjectSelector)}
                      className={cn(
                        "px-6 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 shrink-0 shadow-lg active:scale-95",
                        "bg-[#141414] text-white hover:bg-black shadow-[#141414]/20"
                      )}
                    >
                      <Plus size={14} /> Добавить проект
                    </button>
                  )}
                </div>

                {!(isCreating ? newUser.fullProjectAccess : selectedUser?.fullProjectAccess) && (
                  <>
                    <AnimatePresence>
                      {showProjectSelector && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className={cn(
                            "absolute right-0 top-[120px] w-80 rounded-2xl border shadow-2xl p-6 z-20",
                            "bg-white border-[#141414]/10 shadow-[#141414]/20"
                          )}
                        >
                          <p className={cn("text-[10px] font-bold uppercase mb-4", "text-[#5A5A40]")}>Выберите проект из списка</p>
                          <div className="max-h-64 overflow-y-auto no-scrollbar space-y-2">
                            {projects
                              .filter(p => !(isCreating ? newUser.projectsAccess : selectedUser?.projectsAccess)?.[p.id])
                              .map(project => (
                                <button 
                                  key={project.id}
                                  onClick={() => {
                                    updateProjectAccess(project.id, 'view');
                                    setShowProjectSelector(false);
                                  }}
                                  className={cn(
                                    "w-full text-left p-3 rounded-2xl transition-all group",
                                    "hover:bg-[#141414]/5"
                                  )}
                                >
                                  <p className={cn("text-sm font-bold truncate transition-colors", "text-[#141414] group-hover:text-[#5A5A40]")}>{project.name}</p>
                                  <p className={cn("text-[10px] truncate", "text-[#141414]/40")}>{project.client}</p>
                                </button>
                              ))
                            }
                            {projects.filter(p => !(isCreating ? newUser.projectsAccess : selectedUser?.projectsAccess)?.[p.id]).length === 0 && (
                              <p className={cn("text-[10px] italic text-center py-4", "text-[#141414]/40")}>Нет доступных проектов для добавления</p>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="grid grid-cols-1 gap-4">
                        {Object.entries((isCreating ? newUser.projectsAccess : selectedUser?.projectsAccess) || {}).map(([projectId, access]) => {
                          const project = projects.find(p => p.id === projectId);
                          if (!project) return null;
                          return (
                            <div key={projectId} className={cn(
                              "flex flex-wrap items-center gap-6 p-6 rounded-2xl border group/item transition-colors",
                              "bg-white border-[#141414]/5 shadow-sm"
                            )}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-1">
                                  <h5 className={cn("font-bold truncate", "text-[#141414]")}>{project.name}</h5>
                                  <span className={cn(
                                    "text-[8px] font-black uppercase tracking-tighter px-2 py-0.5 rounded-full",
                                    project.status === 'lead' ? ("bg-[#4b7095]/10 text-[#4b7095]") :
                                    project.status === 'active' ? ("bg-[#7cb244]/10 text-[#7cb244]") :
                                    project.status === 'completed' ? ("bg-[#4fb47c]/10 text-[#4fb47c]") : 
                                    ("bg-[#bc5c5c]/10 text-[#bc5c5c]")
                                  )}>
                                    {project.status === 'lead' ? 'Лид' : project.status === 'active' ? 'В работе' : project.status === 'completed' ? 'Завершен' : 'Отменен'}
                                  </span>
                                </div>
                                <div className={cn("flex flex-wrap items-center gap-4 text-[10px] font-medium", "text-[#141414]/40")}>
                                  <span className="flex items-center gap-1 font-mono uppercase tracking-widest"><Users size={10} /> {project.client}</span>
                                  <span className="flex items-center gap-1 shrink-0 font-mono"><MapPin size={10} /> {project.address || 'Нет адреса'}</span>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-2 shrink-0">
                                <button 
                                  onClick={() => updateProjectAccess(projectId, access === 'view' ? null : 'view')}
                                  className={cn(
                                    "flex flex-col items-center gap-1 p-2 w-20 rounded-2xl transition-all shadow-sm",
                                    access === 'view' 
                                      ? ("bg-[#5A5A40] text-white") 
                                      : ("text-[#141414]/20 hover:bg-[#141414]/5")
                                  )}
                                >
                                  <Eye size={16} />
                                  <span className="text-[8px] font-bold uppercase tracking-widest">Обзор</span>
                                </button>
                                <button 
                                  onClick={() => updateProjectAccess(projectId, access === 'edit' ? null : 'edit')}
                                  className={cn(
                                    "flex flex-col items-center gap-1 p-2 w-20 rounded-2xl transition-all shadow-sm",
                                    access === 'edit' 
                                      ? ("bg-[#5A5A40] text-white") 
                                      : ("text-[#141414]/20 hover:bg-[#141414]/5")
                                  )}
                                >
                                  <Edit3 size={16} />
                                  <span className="text-[8px] font-bold uppercase tracking-widest">Правка</span>
                                </button>
                                <button 
                                  onClick={() => updateProjectAccess(projectId, null)}
                                  className={cn(
                                    "p-3 rounded-2xl transition-all opacity-0 group-hover/item:opacity-100 ml-2",
                                    "text-rose-400 hover:text-rose-600 hover:bg-rose-500/10"
                                  )}
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {Object.keys((isCreating ? newUser.projectsAccess : selectedUser?.projectsAccess) || {}).length === 0 && (
                          <div className={cn(
                            "py-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center px-10 transition-colors",
                            "border-[#141414]/5 bg-[#141414]/[0.02]"
                          )}>
                            <Shield size={32} className={cn("mb-4", "text-[#141414]/5")} />
                            <p className={cn("text-xs font-bold uppercase tracking-widest leading-relaxed", "text-[#141414]/20")}>
                              Список доступов пуст.<br />Добавьте проекты, чтобы пользователь мог с ними работать.
                            </p>
                          </div>
                        )}
                    </div>
                  </>
                )}
                </div>
              </div>
            ) : (
            <div className="h-96 flex flex-col items-center justify-center text-center space-y-6">
              <Users size={64} className={cn("transition-colors", "text-[#141414]/5")} />
              <h3 className={cn("text-xl font-serif font-medium", "text-[#141414]/20")}>Выберите пользователя из списка<br />или создайте нового</h3>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function PermissionToggle({ label, isEnabled, onChange }: { label: string, isEnabled: boolean, onChange: (val: boolean) => void }) {
  return (
    <div className={cn(
      "flex items-center justify-between p-4 rounded-2xl border transition-all",
      "bg-white border-[#141414]/5 shadow-sm"
    )}>
      <span className={cn("text-sm font-bold", "text-[#141414]/80")}>{label}</span>
      <button 
        onClick={() => onChange(!isEnabled)}
        className={cn(
          "w-12 h-6 rounded-full relative transition-all duration-300",
          isEnabled 
            ? ("bg-[#5A5A40]") 
            : ("bg-[#141414]/10")
        )}
      >
        <div className={cn(
          "absolute top-1 w-4 h-4 rounded-full transition-all shadow-sm",
          isEnabled 
            ? "left-7 bg-white" 
            : ("left-1 bg-white")
        )} />
      </button>
    </div>
  );
}
