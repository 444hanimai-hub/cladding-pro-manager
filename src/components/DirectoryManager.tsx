import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Company, Contact, ExpenseCategory, AppUser, DirectoryItem, Material, Carrier } from '../types';
import {
    User, Plus, Trash2, Edit2, Save, X, Users, Layers, Maximize,
    Truck, Wallet, Search, Briefcase, Pencil, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { OperationType, handleFirestoreError } from '../lib/firestore-errors';

const inputCls = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
const labelCls = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";
const rowCls = "border-b border-[#E1D8C5]/60 last:border-b-0 group transition-colors hover:bg-[#F5F2E9]/60";
const cellCls = "px-4 py-3";
const editInputCls = "w-full bg-surface-2 border border-line rounded-md px-2 h-8 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors";

export default function DirectoryManager({ appUser }: { appUser: AppUser | null }) {
    const [activeTab, setActiveTab] = useState<'companies'|'contacts'|'expense_categories'|'materials'|'units'|'drivers'|'carriers'>('companies');
    const [companies, setCompanies] = useState<Company[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [materials, setMaterials] = useState<DirectoryItem[]>([]);
    const [units, setUnits] = useState<DirectoryItem[]>([]);
    const [drivers, setDrivers] = useState<DirectoryItem[]>([]);
    const [carriers, setCarriers] = useState<Carrier[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [newCompanyName, setNewCompanyName] = useState('');
    const [newExpCategoryName, setNewExpCategoryName] = useState('');
    const [newDirectoryItemName, setNewDirectoryItemName] = useState('');
    const [newMaterialDetails, setNewMaterialDetails] = useState({ brand: '', country: '' });
    const [newCarrierDetails, setNewCarrierDetails] = useState({ contactPerson: '', phone: '', email: '' });
    const [newContact, setNewContact] = useState({ name: '', position: '', phone: '', companyId: '' });
    const [newCompanyType, setNewCompanyType] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const COMPANY_TYPES = ['Заказчик', 'Генподрядчик', 'Подрядчик', 'Архитектор', 'Перевозчик', 'Поставщик'];

    useEffect(() => {
        const unsubs = [
            onSnapshot(query(collection(db, 'companies'), orderBy('name')), s => setCompanies(s.docs.map(d => ({ id: d.id, ...d.data() } as Company)))),
            onSnapshot(query(collection(db, 'contacts'), orderBy('name')), s => setContacts(s.docs.map(d => ({ id: d.id, ...d.data() } as Contact)))),
            onSnapshot(query(collection(db, 'expense_categories'), orderBy('name')), s => setExpenseCategories(s.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseCategory)))),
            onSnapshot(query(collection(db, 'materials'), orderBy('name')), s => setMaterials(s.docs.map(d => ({ id: d.id, ...d.data() } as DirectoryItem)))),
            onSnapshot(query(collection(db, 'units'), orderBy('name')), s => setUnits(s.docs.map(d => ({ id: d.id, ...d.data() } as DirectoryItem)))),
            onSnapshot(query(collection(db, 'drivers'), orderBy('name')), s => setDrivers(s.docs.map(d => ({ id: d.id, ...d.data() } as DirectoryItem)))),
            onSnapshot(query(collection(db, 'carriers'), orderBy('name')), s => setCarriers(s.docs.map(d => ({ id: d.id, ...d.data() } as Carrier)))),
        ];
        return () => unsubs.forEach(u => u());
    }, []);

    const tabs = [
        { id: 'companies' as const,          label: 'Компании',      icon: <Briefcase size={14} />, count: companies.length },
        { id: 'contacts' as const,           label: 'Контакты',      icon: <Users size={14} />,     count: contacts.length },
        { id: 'materials' as const,          label: 'Материалы',     icon: <Layers size={14} />,    count: materials.length },
        { id: 'units' as const,              label: 'Ед. измерения', icon: <Maximize size={14} />,  count: units.length },
        { id: 'drivers' as const,            label: 'Водители',      icon: <User size={14} />,      count: drivers.length },
        { id: 'carriers' as const,           label: 'Перевозчики',   icon: <Truck size={14} />,     count: carriers.length },
        { id: 'expense_categories' as const, label: 'Виды расходов', icon: <Wallet size={14} />,    count: expenseCategories.length },
    ];

    const s = searchTerm.toLowerCase();
    const filtered = {
        companies:          companies.filter(c => c.name.toLowerCase().includes(s) && (!typeFilter || (c as any).companyType === typeFilter)),
        contacts:           contacts.filter(c => c.name.toLowerCase().includes(s)),
        expense_categories: expenseCategories.filter(c => c.name.toLowerCase().includes(s)),
        materials:          materials.filter(c => c.name.toLowerCase().includes(s)),
        units:              units.filter(c => c.name.toLowerCase().includes(s)),
        drivers:            drivers.filter(c => c.name.toLowerCase().includes(s)),
        carriers:           carriers.filter(c => c.name.toLowerCase().includes(s)),
    };

    const handleAdd = async () => {
        try {
            if (activeTab === 'companies' && newCompanyName) {
                await addDoc(collection(db, 'companies'), { name: newCompanyName, companyType: newCompanyType, createdAt: serverTimestamp(), managerId: auth.currentUser?.uid });
                setNewCompanyName(''); setNewCompanyType('');
            } else if (activeTab === 'expense_categories' && newExpCategoryName) {
                await addDoc(collection(db, 'expense_categories'), { name: newExpCategoryName, createdAt: serverTimestamp() });
                setNewExpCategoryName('');
            } else if (activeTab === 'materials' && newDirectoryItemName) {
                await addDoc(collection(db, 'materials'), { name: newDirectoryItemName, ...newMaterialDetails, createdAt: serverTimestamp() });
                setNewDirectoryItemName(''); setNewMaterialDetails({ brand: '', country: '' });
            } else if (activeTab === 'units' && newDirectoryItemName) {
                await addDoc(collection(db, 'units'), { name: newDirectoryItemName, createdAt: serverTimestamp() });
                setNewDirectoryItemName('');
            } else if (activeTab === 'drivers' && newDirectoryItemName) {
                await addDoc(collection(db, 'drivers'), { name: newDirectoryItemName, ...newDriverDetails, createdAt: serverTimestamp() });
                setNewDirectoryItemName(''); setNewDriverDetails({ phone: '', passportSeries: '', passportNumber: '', passportIssuedBy: '', passportIssuedDate: '' });
            } else if (activeTab === 'carriers' && newDirectoryItemName) {
                await addDoc(collection(db, 'carriers'), { name: newDirectoryItemName, ...newCarrierDetails, createdAt: serverTimestamp() });
                setNewDirectoryItemName(''); setNewCarrierDetails({ contactPerson: '', phone: '', email: '' });
            } else if (activeTab === 'contacts' && newContact.name && newContact.companyId) {
                await addDoc(collection(db, 'contacts'), { ...newContact, createdAt: serverTimestamp() });
                setNewContact({ name: '', position: '', phone: '', companyId: '' });
            }
            setShowAddModal(false);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, activeTab);
        }
    };

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-6 items-start">
            {/* Sidebar */}
            <div className="w-56 shrink-0 rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                <div className="px-4 py-3 border-b border-line">
                    <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-ink-3">Справочники</p>
                </div>
                <nav className="p-2 space-y-0.5">
                    {tabs.map(tab => (
                        <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSearchTerm(''); setTypeFilter(''); }}
                                className={cn("w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors",
                                    activeTab === tab.id ? "bg-[#F5E9CC] text-[#7C5A25]" : "text-ink-2 hover:bg-surface-2"
                                )}>
                            <div className="flex items-center gap-2.5">
                                <span className={cn("shrink-0", activeTab === tab.id ? "text-[#A67C3C]" : "text-ink-3")}>{tab.icon}</span>
                                <span className="text-[12px] font-medium">{tab.label}</span>
                            </div>
                            <span className={cn("text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md",
                                activeTab === tab.id ? "bg-[#A67C3C]/15 text-[#7C5A25]" : "bg-surface-2 text-ink-4"
                            )}>{tab.count}</span>
                        </button>
                    ))}
                </nav>
            </div>

            {/* Main */}
            <div className="flex-1 min-w-0 rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-line">
                    <div>
                        <h2 className="font-serif text-[18px] font-medium text-ink leading-tight">{tabs.find(t => t.id === activeTab)?.label}</h2>
                        <p className="text-[10px] text-ink-3 mt-0.5">{tabs.find(t => t.id === activeTab)?.count ?? 0} записей</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Поиск..."
                                   className="w-48 bg-surface-2 border border-line rounded-md pl-8 pr-3 h-8 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4" />
                        </div>
                        <button onClick={() => setShowAddModal(true)}
                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors">
                            <Plus size={13} /> Добавить
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    {activeTab === 'companies'          && <CompaniesTable         companies={filtered.companies} typeFilter={typeFilter} setTypeFilter={setTypeFilter} />}
                    {activeTab === 'contacts'           && <ContactsTable          contacts={filtered.contacts} companies={companies} />}
                    {activeTab === 'materials'          && <MaterialsTable         items={filtered.materials as Material[]} />}
                    {activeTab === 'units'              && <SimpleTable            items={filtered.units}    collectionName="units"    icon={<Maximize size={13} />} />}
                    {activeTab === 'drivers'            && <DriversTable           items={filtered.drivers} />}
                    {activeTab === 'carriers'           && <CarriersTable          items={filtered.carriers as Carrier[]} />}
                    {activeTab === 'expense_categories' && <ExpenseCategoriesTable categories={filtered.expense_categories} />}
                </div>
            </div>

            {/* Add Modal */}
            <AnimatePresence>
                {showAddModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
                        <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
                                    className="relative w-full max-w-md bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] overflow-hidden">
                            <div className="px-6 py-4 border-b border-line flex items-center justify-between">
                                <h3 className="font-serif text-[18px] font-medium text-ink">
                                    {activeTab === 'companies' ? 'Новая компания' : activeTab === 'contacts' ? 'Новый контакт' :
                                        activeTab === 'expense_categories' ? 'Новый вид расхода' : activeTab === 'materials' ? 'Новый материал' :
                                            activeTab === 'units' ? 'Новая ед. измерения' : activeTab === 'drivers' ? 'Новый водитель' : 'Новый перевозчик'}
                                </h3>
                                <button onClick={() => setShowAddModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 transition-colors"><X size={16} /></button>
                            </div>
                            <div className="px-6 py-5 space-y-4">
                                {['companies','expense_categories','materials','units','drivers','carriers'].includes(activeTab) && (
                                    <div>
                                        <label className={labelCls}>{activeTab === 'companies' ? 'Название компании' : activeTab === 'expense_categories' ? 'Название' : 'Название'}</label>
                                        <input value={activeTab === 'companies' ? newCompanyName : activeTab === 'expense_categories' ? newExpCategoryName : newDirectoryItemName}
                                               onChange={e => { if (activeTab === 'companies') setNewCompanyName(e.target.value); else if (activeTab === 'expense_categories') setNewExpCategoryName(e.target.value); else setNewDirectoryItemName(e.target.value); }}
                                               placeholder="Введите название..." className={inputCls} autoFocus />
                                    </div>
                                )}
                                {activeTab === 'companies' && (
                                    <div>
                                        <label className={labelCls}>Тип компании</label>
                                        <select value={newCompanyType} onChange={e => setNewCompanyType(e.target.value)} className={cn(inputCls, "appearance-none cursor-pointer")}>
                                            <option value="">— не указан —</option>
                                            {COMPANY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                )}
                                {activeTab === 'materials' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div><label className={labelCls}>Бренд</label><input value={newMaterialDetails.brand} onChange={e => setNewMaterialDetails({...newMaterialDetails, brand: e.target.value})} className={inputCls} /></div>
                                        <div><label className={labelCls}>Страна</label><input value={newMaterialDetails.country} onChange={e => setNewMaterialDetails({...newMaterialDetails, country: e.target.value})} className={inputCls} /></div>
                                    </div>
                                )}
                                {activeTab === 'drivers' && (
                                    <>
                                        <div><label className={labelCls}>Телефон</label><input value={newDriverDetails.phone} onChange={e => setNewDriverDetails({...newDriverDetails, phone: e.target.value})} className={inputCls} placeholder="+7..." /></div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div><label className={labelCls}>Серия паспорта</label><input value={newDriverDetails.passportSeries} onChange={e => setNewDriverDetails({...newDriverDetails, passportSeries: e.target.value})} className={inputCls} /></div>
                                            <div><label className={labelCls}>Номер паспорта</label><input value={newDriverDetails.passportNumber} onChange={e => setNewDriverDetails({...newDriverDetails, passportNumber: e.target.value})} className={inputCls} /></div>
                                        </div>
                                        <div><label className={labelCls}>Кем выдан</label><input value={newDriverDetails.passportIssuedBy} onChange={e => setNewDriverDetails({...newDriverDetails, passportIssuedBy: e.target.value})} className={inputCls} /></div>
                                        <div><label className={labelCls}>Когда выдан</label><input value={newDriverDetails.passportIssuedDate} onChange={e => setNewDriverDetails({...newDriverDetails, passportIssuedDate: e.target.value})} className={inputCls} placeholder="ДД.ММ.ГГГГ" /></div>
                                    </>
                                )}
                                {activeTab === 'carriers' && (
                                    <>
                                        <div><label className={labelCls}>Контактное лицо</label><input value={newCarrierDetails.contactPerson} onChange={e => setNewCarrierDetails({...newCarrierDetails, contactPerson: e.target.value})} className={inputCls} /></div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div><label className={labelCls}>Телефон</label><input value={newCarrierDetails.phone} onChange={e => setNewCarrierDetails({...newCarrierDetails, phone: e.target.value})} className={inputCls} /></div>
                                            <div><label className={labelCls}>Email</label><input value={newCarrierDetails.email} onChange={e => setNewCarrierDetails({...newCarrierDetails, email: e.target.value})} className={inputCls} /></div>
                                        </div>
                                    </>
                                )}
                                {activeTab === 'contacts' && (
                                    <>
                                        <div><label className={labelCls}>ФИО</label><input value={newContact.name} onChange={e => setNewContact({...newContact, name: e.target.value})} className={inputCls} autoFocus /></div>
                                        <div>
                                            <label className={labelCls}>Компания</label>
                                            <select value={newContact.companyId} onChange={e => setNewContact({...newContact, companyId: e.target.value})} className={cn(inputCls, "appearance-none cursor-pointer")}>
                                                <option value="">Выберите компанию...</option>
                                                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div><label className={labelCls}>Должность</label><input value={newContact.position} onChange={e => setNewContact({...newContact, position: e.target.value})} className={inputCls} /></div>
                                            <div><label className={labelCls}>Телефон</label><input value={newContact.phone} onChange={e => setNewContact({...newContact, phone: e.target.value})} className={inputCls} /></div>
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-end gap-2">
                                <button onClick={() => setShowAddModal(false)} className="h-9 px-4 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">Отмена</button>
                                <button onClick={handleAdd} className="h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors">Сохранить</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function THead({ cols }: { cols: string[] }) {
    return (
        <thead>
        <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
            {cols.map((c, i) => <th key={i} className={cn("px-4 py-3 font-bold", i === cols.length - 1 && "text-right w-20")}>{c}</th>)}
        </tr>
        </thead>
    );
}

function ActionBtns({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
    return (
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onEdit} className="w-7 h-7 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"><Pencil size={13} /></button>
            <button onClick={onDelete} className="w-7 h-7 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-rose-500 transition-colors"><Trash2 size={13} /></button>
        </div>
    );
}
function SaveCancelBtns({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
    return (
        <div className="flex items-center justify-end gap-1">
            <button onClick={onSave} className="w-7 h-7 flex items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 transition-colors"><Save size={13} /></button>
            <button onClick={onCancel} className="w-7 h-7 flex items-center justify-center rounded-full text-rose-500 hover:bg-rose-50 transition-colors"><X size={13} /></button>
        </div>
    );
}

function CompaniesTable({ companies, typeFilter, setTypeFilter }: { companies: Company[], typeFilter: string, setTypeFilter: (v: string) => void }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editType, setEditType] = useState('');
    const [filterOpen, setFilterOpen] = useState(false);
    const filterBtnRef = useRef<HTMLButtonElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (!filterOpen) return;
        if (filterBtnRef.current) {
            const rect = filterBtnRef.current.getBoundingClientRect();
            setCoords({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
        }
        const handler = (e: MouseEvent) => {
            if (filterBtnRef.current && !filterBtnRef.current.contains(e.target as Node)) {
                // check if click is inside dropdown
                const dropdown = document.getElementById('type-filter-dropdown');
                if (!dropdown || !dropdown.contains(e.target as Node)) setFilterOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [filterOpen]);

    const save = async (id: string) => { await updateDoc(doc(db, 'companies', id), { name: editName, companyType: editType }); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить компанию?')) await deleteDoc(doc(db, 'companies', id)); };
    const TYPES = ['Заказчик', 'Генподрядчик', 'Подрядчик', 'Архитектор', 'Перевозчик', 'Поставщик'];

    return (
        <>
            {filterOpen && createPortal(
                <div
                    id="type-filter-dropdown"
                    style={{ position: 'absolute', top: `${coords.top}px`, left: `${coords.left}px`, zIndex: 999999, minWidth: '160px' }}
                    className="bg-surface border border-line rounded-md shadow-[0_8px_32px_rgba(48,42,28,0.16)] overflow-hidden"
                >
                    <button
                        type="button"
                        onClick={() => { setTypeFilter(''); setFilterOpen(false); }}
                        className={cn("w-full flex items-center px-3 py-2 text-[13px] text-left transition-colors",
                            !typeFilter ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold" : "text-ink hover:bg-surface-2"
                        )}
                    >Все типы</button>
                    {TYPES.map(t => (
                        <button key={t} type="button"
                                onClick={() => { setTypeFilter(t); setFilterOpen(false); }}
                                className={cn("w-full flex items-center px-3 py-2 text-[13px] text-left transition-colors",
                                    typeFilter === t ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold" : "text-ink hover:bg-surface-2"
                                )}
                        >{t}</button>
                    ))}
                </div>,
                document.body
            )}
            <table className="w-full text-left">
                <thead>
                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                    <th className="px-4 py-3 font-bold">Наименование</th>
                    <th className="px-4 py-3 font-bold">
                        <button
                            ref={filterBtnRef}
                            onClick={() => setFilterOpen(o => !o)}
                            className={cn("flex items-center gap-1 transition-colors hover:text-ink font-bold text-[9px] uppercase tracking-[0.12em]",
                                typeFilter ? "text-ochre" : "text-[#8A8574]"
                            )}
                        >
                            Тип
                            <ChevronDown size={10} className={cn("transition-transform", filterOpen && "rotate-180")} />
                            {typeFilter && <span className="w-1.5 h-1.5 rounded-full bg-ochre shrink-0" />}
                        </button>
                    </th>
                    <th className="px-4 py-3 font-bold text-right w-20"></th>
                </tr>
                </thead>
                <tbody>
                {companies.map(c => (
                    <tr key={c.id} className={rowCls}>
                        <td className={cellCls}>
                            {editingId === c.id
                                ? <input value={editName} onChange={e => setEditName(e.target.value)} className={editInputCls} autoFocus onKeyDown={e => e.key === 'Enter' && save(c.id)} />
                                : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><Briefcase size={13} /></span><span className="text-[13px] font-medium text-ink">{c.name}</span></div>
                            }
                        </td>
                        <td className={cellCls}>
                            {editingId === c.id
                                ? <select value={editType} onChange={e => setEditType(e.target.value)} className={cn(editInputCls, "w-36 appearance-none cursor-pointer")}>
                                    <option value="">— не указан —</option>
                                    {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                                : <span className="text-[13px] font-medium text-ink">{(c as any).companyType || '—'}</span>
                            }
                        </td>
                        <td className={cn(cellCls, "text-right")}>
                            {editingId === c.id
                                ? <SaveCancelBtns onSave={() => save(c.id)} onCancel={() => setEditingId(null)} />
                                : <ActionBtns onEdit={() => { setEditingId(c.id); setEditName(c.name); setEditType((c as any).companyType || ''); }} onDelete={() => del(c.id)} />
                            }
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>
        </>
    );
}

function ContactsTable({ contacts, companies }: { contacts: Contact[], companies: Company[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editData, setEditData] = useState<Partial<Contact>>({});
    const save = async (id: string) => { await updateDoc(doc(db, 'contacts', id), editData); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить контакт?')) await deleteDoc(doc(db, 'contacts', id)); };
    return (
        <table className="w-full text-left">
            <THead cols={['ФИО', 'Компания', 'Должность / Телефон', '']} />
            <tbody>
            {contacts.map(c => (
                <tr key={c.id} className={rowCls}>
                    <td className={cellCls}>
                        {editingId === c.id
                            ? <input value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className={editInputCls} autoFocus />
                            : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><User size={13} /></span><span className="text-[13px] font-medium text-ink">{c.name}</span></div>
                        }
                    </td>
                    <td className={cn(cellCls, "text-[12px] text-ink-3")}>{companies.find(co => co.id === c.companyId)?.name || '—'}</td>
                    <td className={cellCls}>
                        {editingId === c.id
                            ? <div className="flex flex-col gap-1"><input value={editData.position || ''} onChange={e => setEditData({...editData, position: e.target.value})} placeholder="Должность" className={editInputCls} /><input value={editData.phone || ''} onChange={e => setEditData({...editData, phone: e.target.value})} placeholder="Телефон" className={editInputCls} /></div>
                            : <div><p className="text-[11px] text-ink-3">{c.position || '—'}</p><p className="text-[11px] font-mono text-[#A67C3C]">{c.phone || '—'}</p></div>
                        }
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                        {editingId === c.id
                            ? <SaveCancelBtns onSave={() => save(c.id)} onCancel={() => setEditingId(null)} />
                            : <ActionBtns onEdit={() => { setEditingId(c.id); setEditData(c); }} onDelete={() => del(c.id)} />
                        }
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}

function ExpenseCategoriesTable({ categories }: { categories: ExpenseCategory[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const save = async (id: string) => { await updateDoc(doc(db, 'expense_categories', id), { name: editName }); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить категорию?')) await deleteDoc(doc(db, 'expense_categories', id)); };
    return (
        <table className="w-full text-left">
            <THead cols={['Наименование', '']} />
            <tbody>
            {categories.map(c => (
                <tr key={c.id} className={rowCls}>
                    <td className={cellCls}>
                        {editingId === c.id
                            ? <input value={editName} onChange={e => setEditName(e.target.value)} className={editInputCls} autoFocus onKeyDown={e => e.key === 'Enter' && save(c.id)} />
                            : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><Wallet size={13} /></span><span className="text-[13px] font-medium text-ink">{c.name}</span></div>
                        }
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                        {editingId === c.id
                            ? <SaveCancelBtns onSave={() => save(c.id)} onCancel={() => setEditingId(null)} />
                            : <ActionBtns onEdit={() => { setEditingId(c.id); setEditName(c.name); }} onDelete={() => del(c.id)} />
                        }
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}

function MaterialsTable({ items }: { items: Material[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editData, setEditData] = useState<Partial<Material>>({});
    const save = async (id: string) => { await updateDoc(doc(db, 'materials', id), editData); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить материал?')) await deleteDoc(doc(db, 'materials', id)); };
    return (
        <table className="w-full text-left">
            <THead cols={['Материал', 'Бренд / Страна', '']} />
            <tbody>
            {items.map(item => (
                <tr key={item.id} className={rowCls}>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <input value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className={editInputCls} autoFocus />
                            : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><Layers size={13} /></span><span className="text-[13px] font-medium text-ink">{item.name}</span></div>
                        }
                    </td>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <div className="flex gap-2"><input value={editData.brand || ''} onChange={e => setEditData({...editData, brand: e.target.value})} placeholder="Бренд" className={cn(editInputCls, "w-28")} /><input value={editData.country || ''} onChange={e => setEditData({...editData, country: e.target.value})} placeholder="Страна" className={cn(editInputCls, "w-28")} /></div>
                            : <div><p className="text-[11px] font-medium text-ink-2">{item.brand || '—'}</p><p className="text-[10px] text-ink-4">{item.country || '—'}</p></div>
                        }
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                        {editingId === item.id
                            ? <SaveCancelBtns onSave={() => save(item.id)} onCancel={() => setEditingId(null)} />
                            : <ActionBtns onEdit={() => { setEditingId(item.id); setEditData(item); }} onDelete={() => del(item.id)} />
                        }
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}

function DriversTable({ items }: { items: any[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editData, setEditData] = useState<any>({});
    const save = async (id: string) => { await updateDoc(doc(db, 'drivers', id), editData); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить водителя?')) await deleteDoc(doc(db, 'drivers', id)); };
    return (
        <table className="w-full text-left">
            <THead cols={['ФИО', 'Телефон', 'Паспорт серия / номер', 'Кем / когда выдан', '']} />
            <tbody>
            {items.map(item => (
                <tr key={item.id} className={rowCls}>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <input value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className={editInputCls} autoFocus />
                            : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><User size={13} /></span><span className="text-[13px] font-medium text-ink">{item.name}</span></div>
                        }
                    </td>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <input value={editData.phone || ''} onChange={e => setEditData({...editData, phone: e.target.value})} placeholder="+7..." className={editInputCls} />
                            : <span className="text-[12px] font-mono text-[#A67C3C]">{item.phone || '—'}</span>
                        }
                    </td>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <div className="flex gap-2"><input value={editData.passportSeries || ''} onChange={e => setEditData({...editData, passportSeries: e.target.value})} placeholder="Серия" className={cn(editInputCls, "w-20")} /><input value={editData.passportNumber || ''} onChange={e => setEditData({...editData, passportNumber: e.target.value})} placeholder="Номер" className={cn(editInputCls, "w-24")} /></div>
                            : <div><p className="text-[11px] font-mono text-ink-2">{item.passportSeries || '—'} {item.passportNumber || ''}</p></div>
                        }
                    </td>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <div className="flex flex-col gap-1"><input value={editData.passportIssuedBy || ''} onChange={e => setEditData({...editData, passportIssuedBy: e.target.value})} placeholder="Кем выдан" className={editInputCls} /><input value={editData.passportIssuedDate || ''} onChange={e => setEditData({...editData, passportIssuedDate: e.target.value})} placeholder="ДД.ММ.ГГГГ" className={editInputCls} /></div>
                            : <div><p className="text-[11px] text-ink-3 truncate max-w-[180px]">{item.passportIssuedBy || '—'}</p><p className="text-[10px] font-mono text-ink-4">{item.passportIssuedDate || ''}</p></div>
                        }
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                        {editingId === item.id
                            ? <SaveCancelBtns onSave={() => save(item.id)} onCancel={() => setEditingId(null)} />
                            : <ActionBtns onEdit={() => { setEditingId(item.id); setEditData({...item}); }} onDelete={() => del(item.id)} />
                        }
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}

function CarriersTable({ items }: { items: Carrier[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editData, setEditData] = useState<Partial<Carrier>>({});
    const save = async (id: string) => { await updateDoc(doc(db, 'carriers', id), editData); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить перевозчика?')) await deleteDoc(doc(db, 'carriers', id)); };
    return (
        <table className="w-full text-left">
            <THead cols={['Перевозчик', 'Контакт / Телефон', 'Email', '']} />
            <tbody>
            {items.map(item => (
                <tr key={item.id} className={rowCls}>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <input value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className={editInputCls} autoFocus />
                            : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><Truck size={13} /></span><span className="text-[13px] font-medium text-ink">{item.name}</span></div>
                        }
                    </td>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <div className="flex flex-col gap-1"><input value={editData.contactPerson || ''} onChange={e => setEditData({...editData, contactPerson: e.target.value})} placeholder="ФИО" className={editInputCls} /><input value={editData.phone || ''} onChange={e => setEditData({...editData, phone: e.target.value})} placeholder="Телефон" className={editInputCls} /></div>
                            : <div><p className="text-[11px] text-ink-2">{item.contactPerson || '—'}</p><p className="text-[11px] font-mono text-[#A67C3C]">{item.phone || '—'}</p></div>
                        }
                    </td>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <input value={editData.email || ''} onChange={e => setEditData({...editData, email: e.target.value})} className={editInputCls} />
                            : <span className="text-[12px] text-ink-3">{item.email || '—'}</span>
                        }
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                        {editingId === item.id
                            ? <SaveCancelBtns onSave={() => save(item.id)} onCancel={() => setEditingId(null)} />
                            : <ActionBtns onEdit={() => { setEditingId(item.id); setEditData(item); }} onDelete={() => del(item.id)} />
                        }
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}

function SimpleTable({ items, collectionName, icon }: { items: any[], collectionName: string, icon: React.ReactNode }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const save = async (id: string) => { await updateDoc(doc(db, collectionName, id), { name: editName }); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить запись?')) await deleteDoc(doc(db, collectionName, id)); };
    return (
        <table className="w-full text-left">
            <THead cols={['Наименование', '']} />
            <tbody>
            {items.map(item => (
                <tr key={item.id} className={rowCls}>
                    <td className={cellCls}>
                        {editingId === item.id
                            ? <input value={editName} onChange={e => setEditName(e.target.value)} className={editInputCls} autoFocus onKeyDown={e => e.key === 'Enter' && save(item.id)} />
                            : <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0">{icon}</span><span className="text-[13px] font-medium text-ink">{item.name}</span></div>
                        }
                    </td>
                    <td className={cn(cellCls, "text-right")}>
                        {editingId === item.id
                            ? <SaveCancelBtns onSave={() => save(item.id)} onCancel={() => setEditingId(null)} />
                            : <ActionBtns onEdit={() => { setEditingId(item.id); setEditName(item.name); }} onDelete={() => del(item.id)} />
                        }
                    </td>
                </tr>
            ))}
            </tbody>
        </table>
    );
}
