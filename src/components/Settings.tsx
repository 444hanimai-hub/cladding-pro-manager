import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, updateDoc, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppUser, Project } from '../types';
import UserAvatar from './UserAvatar';
import StatusPill from './StatusPill';
import {
    Users, Shield, Key, Plus, Trash2, UserPlus, Search,
    Eye, Check, X, Pencil, CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const ADMIN_EMAIL = '444hanimai@gmail.com';

export default function Settings({ appUser }: { appUser: AppUser | null }) {
    const [users, setUsers] = useState<AppUser[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');

    const [newUser, setNewUser] = useState<Partial<AppUser>>({
        displayName: '', email: '',
        accessDashboard: false, fullProjectAccess: false,
        accessDirectories: false, accessSettings: false,
        projectsAccess: {}, photoURL: ''
    });

    useEffect(() => {
        const u1 = onSnapshot(collection(db, 'users'), s => setUsers(s.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))));
        const u2 = onSnapshot(collection(db, 'projects'), s => setProjects(s.docs.map(d => ({ id: d.id, ...d.data() } as Project))));
        return () => { u1(); u2(); };
    }, []);

    const selectedUser = users.find(u => u.uid === selectedUserId);
    const currentUser = isCreating ? newUser : selectedUser;
    const uid = selectedUserId || '';
    const isAdmin = selectedUser?.email === ADMIN_EMAIL;

    const handleSaveNewUser = async () => {
        if (!newUser.email || !newUser.displayName) return;
        const normalizedEmail = newUser.email.toLowerCase().trim();
        const tempUid = `temp_${Date.now()}`;
        await setDoc(doc(db, 'users', tempUid), { ...newUser, email: normalizedEmail, uid: tempUid, createdAt: new Date() });
        setNewUser({ displayName: '', email: '', accessDashboard: false, fullProjectAccess: false, accessDirectories: false, accessSettings: false, projectsAccess: {}, photoURL: '' });
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

    const updateUser = async (updates: Partial<AppUser>) => {
        if (isCreating) { setNewUser(p => ({ ...p, ...updates })); }
        else if (uid) { await updateDoc(doc(db, 'users', uid), updates); }
    };

    const updateProjectAccess = async (projectId: string, access: 'view' | 'edit' | null) => {
        if (isCreating) {
            const projectsAccess = { ...(newUser.projectsAccess || {}) };
            if (access === null) { delete projectsAccess[projectId]; } else { projectsAccess[projectId] = access; }
            setNewUser(p => ({ ...p, projectsAccess }));
            return;
        }
        if (!uid) return;
        if (access === null) {
            // Используем FieldValue.deleteField() чтобы реально удалить ключ из Firestore
            const { deleteField } = await import('firebase/firestore');
            await updateDoc(doc(db, 'users', uid), {
                [`projectsAccess.${projectId}`]: deleteField()
            });
        } else {
            await updateDoc(doc(db, 'users', uid), {
                [`projectsAccess.${projectId}`]: access
            });
        }
    };

    const accessCount = Object.keys(currentUser?.projectsAccess || {}).length;
    const totalProjects = projects.length;

    // Проекты отсортированные по убыванию даты создания
    const sortedProjects = [...projects].sort((a, b) => {
        const aDate = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const bDate = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return bDate.getTime() - aDate.getTime();
    });

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-6 items-start">

            {/* ── Left: User list ── */}
            <div className="w-64 shrink-0 rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                <div className="px-4 py-3 border-b border-line flex items-center justify-between">
                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-ink-3">Пользователи</p>
                    <button
                        onClick={() => { setIsCreating(true); setSelectedUserId(null); }}
                        className={cn("w-6 h-6 flex items-center justify-center rounded-full transition-colors",
                            isCreating ? "bg-ochre text-white" : "text-ink-3 hover:bg-surface-2 hover:text-ink"
                        )}
                    >
                        <Plus size={13} />
                    </button>
                </div>
                <div className="px-3 py-2 border-b border-line">
                    <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none" />
                        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Поиск..."
                               className="w-full bg-surface-2 rounded-md pl-7 pr-3 h-7 text-[12px] text-ink focus:outline-none placeholder:text-ink-4" />
                    </div>
                </div>
                <nav className="p-2 space-y-0.5">
                    {filteredUsers.map(user => (
                        <div key={user.uid} className="group relative">
                            <button
                                onClick={() => { setSelectedUserId(user.uid); setIsCreating(false); setIsEditing(false); }}
                                className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors pr-8",
                                    selectedUserId === user.uid ? "bg-[#F5E9CC]" : "hover:bg-surface-2"
                                )}
                            >
                                <UserAvatar name={user.displayName} uid={user.uid} photoURL={user.photoURL} size="sm" />
                                <div className="min-w-0 flex-1">
                                    <p className={cn("text-[13px] font-medium truncate leading-tight", selectedUserId === user.uid ? "text-[#7C5A25]" : "text-ink")}>{user.displayName}</p>
                                    <p className="text-[10px] text-ink-4 truncate">{user.email}</p>
                                </div>
                            </button>
                            {user.email !== ADMIN_EMAIL && (
                                <button
                                    onClick={e => { e.stopPropagation(); deleteUser(user.uid); }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-ink-4 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    <Trash2 size={12} />
                                </button>
                            )}
                        </div>
                    ))}
                </nav>
            </div>

            {/* ── Right: Detail ── */}
            <div className="flex-1 min-w-0 space-y-4">
                {(selectedUser || isCreating) ? (
                    <>
                        {/* Header */}
                        <div className="rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] px-6 py-5 flex items-center gap-5">
                            <UserAvatar
                                name={isCreating ? (newUser.displayName || '') : (selectedUser?.displayName || '')}
                                uid={isCreating ? '' : (selectedUser?.uid || '')}
                                photoURL={isCreating ? newUser.photoURL : selectedUser?.photoURL}
                                size="lg"
                            />
                            <div className="flex-1 min-w-0">
                                {isCreating ? (
                                    <div className="space-y-2">
                                        <input value={newUser.displayName} onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))} placeholder="Имя пользователя"
                                               className="w-full bg-surface-2 border border-line rounded-md px-3 h-9 text-[15px] font-medium text-ink focus:border-ochre focus:outline-none" />
                                        <input value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="email@gmail.com"
                                               className="w-full bg-surface-2 border border-line rounded-md px-3 h-8 text-[13px] text-ink-3 focus:border-ochre focus:outline-none" />
                                    </div>
                                ) : isEditing ? (
                                    <div className="flex items-center gap-2">
                                        <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                                               className="bg-surface-2 border border-line rounded-md px-3 h-9 text-[15px] font-medium text-ink focus:border-ochre focus:outline-none" />
                                        <button onClick={async () => { await updateUser({ displayName: editName }); setIsEditing(false); }}
                                                className="w-8 h-8 flex items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>
                                        <button onClick={() => setIsEditing(false)}
                                                className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2"><X size={14} /></button>
                                    </div>
                                ) : (
                                    <>
                                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">{selectedUser?.displayName}</h2>
                                        <p className="text-[12px] text-ink-3 mt-0.5">{selectedUser?.email}</p>
                                    </>
                                )}
                            </div>
                            <div className="shrink-0">
                                {isCreating ? (
                                    <button onClick={handleSaveNewUser} className="h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors">Сохранить</button>
                                ) : !isEditing ? (
                                    <button onClick={() => { setEditName(selectedUser?.displayName || ''); setIsEditing(true); }}
                                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                                        <Pencil size={12} /> Редактировать
                                    </button>
                                ) : null}
                            </div>
                        </div>

                        {/* Permissions + Finance */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                                <div className="px-5 py-3 border-b border-line">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-ink-3">Доступ к разделам</p>
                                </div>
                                <div className="divide-y divide-line">
                                    <PermissionRow label="Дашборд"
                                                   isEnabled={currentUser?.accessDashboard || false}
                                                   onChange={val => updateUser({ accessDashboard: val, ...(!val ? { requireFinanceCode: false, financeCode: '' } : {}) })}
                                    />
                                    <PermissionRow label="Справочники"
                                                   isEnabled={currentUser?.accessDirectories || false}
                                                   onChange={val => updateUser({ accessDirectories: val })}
                                    />
                                    <PermissionRow label="Настройки"
                                                   isEnabled={isAdmin ? true : (currentUser?.accessSettings || false)}
                                                   locked={isAdmin}
                                                   onChange={val => updateUser({ accessSettings: val })}
                                    />
                                </div>
                            </div>

                            <div className="rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                                <div className="px-5 py-3 border-b border-line">
                                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-ink-3">Служебные данные</p>
                                </div>
                                <div className="divide-y divide-line">
                                    {/* Тумблер "Запрашивать код" — без валидации, просто включить/выключить */}
                                    <PermissionRow label="Запрашивать код"
                                                   isEnabled={currentUser?.requireFinanceCode || false}
                                                   disabled={!currentUser?.accessDashboard}
                                                   onChange={val => updateUser({ requireFinanceCode: val, ...(!val ? { financeCode: '' } : {}) })}
                                    />
                                    <div className="px-5 py-4">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-ink-3 mb-2">Код доступа к финансам</p>
                                        <div className="relative">
                                            <Key size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                                            <input
                                                maxLength={10}
                                                placeholder={!currentUser?.requireFinanceCode ? "Код не требуется" : "Введите код..."}
                                                disabled={!currentUser?.requireFinanceCode}
                                                value={currentUser?.financeCode || ''}
                                                onChange={e => updateUser({ financeCode: e.target.value })}
                                                className={cn("w-full bg-surface-2 border border-line rounded-md pl-9 pr-3 h-9 text-[13px] font-mono text-ink focus:border-ochre focus:outline-none transition-colors",
                                                    !currentUser?.requireFinanceCode && "opacity-40 cursor-not-allowed"
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Projects */}
                        <div className="rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                            <div className="px-5 py-3.5 border-b border-line flex items-center justify-between gap-4">
                                <div>
                                    <h3 className="font-serif text-[15px] font-medium text-ink">Доступ к проектам</h3>
                                    {!currentUser?.fullProjectAccess && (
                                        <p className="text-[11px] text-ink-3 mt-0.5">
                                            Ограниченный режим — права настраиваются индивидуально
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => updateUser({ fullProjectAccess: false })}
                                        className={cn("h-8 px-4 rounded-md text-[11.5px] font-semibold transition-colors",
                                            !currentUser?.fullProjectAccess ? "bg-ink text-bg" : "border border-line text-ink-2 hover:bg-surface-2"
                                        )}
                                    >Ограниченный</button>
                                    <button
                                        onClick={() => updateUser({ fullProjectAccess: true })}
                                        className={cn("h-8 px-4 rounded-md text-[11.5px] font-semibold transition-colors",
                                            currentUser?.fullProjectAccess ? "bg-ink text-bg" : "border border-line text-ink-2 hover:bg-surface-2"
                                        )}
                                    >Полный доступ ко всем</button>
                                </div>
                            </div>

                            {currentUser?.fullProjectAccess ? (
                                <div className="px-5 py-8 flex flex-col items-center justify-center text-center gap-2">
                                    <CheckCircle2 size={28} className="text-emerald-500" />
                                    <p className="text-[13px] font-medium text-ink">Полный доступ ко всем проектам</p>
                                    <p className="text-[11px] text-ink-3">Пользователь видит и редактирует все проекты</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-line">
                                    {sortedProjects.map(project => {
                                        // Проект где пользователь — ведущий менеджер: всегда edit, заблокирован
                                        const isLeadManager = project.leadManagerId === selectedUser?.uid;
                                        const access = isLeadManager
                                            ? 'edit'
                                            : (currentUser?.projectsAccess?.[project.id] ?? null);

                                        return (
                                            <div key={project.id} className={cn(
                                                "px-5 py-3.5 flex items-center gap-4 transition-colors",
                                                !isLeadManager && "hover:bg-surface-2/50"
                                            )}>
                                                <div className="flex-1 min-w-0 flex items-center gap-3">
                                                    <StatusPill status={project.status} />
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-[13px] font-medium text-ink truncate">{project.name}</p>
                                                            {isLeadManager && (
                                                                <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-ochre-bg text-ochre shrink-0">
                                  Менеджер
                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-ink-3 truncate">{project.client} · {project.address}</p>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-3 shrink-0">
                                                    {isLeadManager ? (
                                                        <span className="text-[12px] font-semibold text-[#4fb47c] px-3 py-1 rounded-md bg-[#4fb47c]/10 cursor-not-allowed">
                              Редактирование
                            </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                const next = access === null ? 'view' : access === 'view' ? 'edit' : null;
                                                                updateProjectAccess(project.id, next);
                                                            }}
                                                            className={cn(
                                                                "text-[12px] font-semibold px-3 py-1 rounded-md transition-colors",
                                                                access === null   && "text-ink-4 bg-surface-2 hover:bg-surface border border-line",
                                                                access === 'view' && "text-[#B48444] bg-[#B48444]/10 hover:bg-[#B48444]/15",
                                                                access === 'edit' && "text-[#4fb47c] bg-[#4fb47c]/10 hover:bg-[#4fb47c]/15",
                                                            )}
                                                        >
                                                            {access === null ? 'Закрыт' : access === 'view' ? 'Просмотр' : 'Редактирование'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] flex flex-col items-center justify-center py-24 gap-3">
                        <Users size={32} className="text-ink-4" />
                        <p className="text-[14px] font-serif font-medium text-ink-3">Выберите пользователя из списка</p>
                        <p className="text-[11px] text-ink-4">или создайте нового нажав +</p>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function PermissionRow({ label, isEnabled, onChange, disabled, locked }: {
    label: string;
    isEnabled: boolean;
    onChange: (val: boolean) => void;
    disabled?: boolean;
    locked?: boolean;
}) {
    return (
        <div className={cn("px-5 py-3.5 flex items-center justify-between gap-4", (disabled || locked) && "opacity-50")}>
            <span className="text-[13px] font-medium text-ink">{label}</span>
            <button
                onClick={() => !disabled && !locked && onChange(!isEnabled)}
                disabled={disabled || locked}
                className={cn("w-10 h-5 rounded-full relative transition-all duration-300 shrink-0",
                    isEnabled ? "bg-[#4fb47c]" : "bg-surface-2 border border-line",
                    (disabled || locked) && "cursor-not-allowed"
                )}
            >
                <div className={cn("absolute top-0.5 w-4 h-4 rounded-full shadow transition-all",
                    isEnabled ? "left-5 bg-white" : "left-0.5 bg-[#8A8574]"
                )} />
            </button>
        </div>
    );
}
