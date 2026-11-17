import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, query, addDoc, updateDoc, setDoc, doc, deleteDoc, serverTimestamp, orderBy, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Company, Contact, ExpenseCategory, AppUser, DirectoryItem, Material, Carrier, ProductType } from '../types';
import {
    User, Plus, Trash2, Edit2, Save, X, Users, Layers, Maximize,
    Truck, Wallet, Search, Briefcase, Pencil, ChevronDown, Tag, Coins, Upload, Filter,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { OperationType, handleFirestoreError } from '../lib/firestore-errors';
import CompanySelect from './CompanySelect';
import MaterialsImportModal from './MaterialsImportModal';
import { SELLER_LEGAL_ENTITY_COMPANY_TYPE } from './shared/DashboardFilters';

/**
 * Достаёт ID файла из обычной ссылки "Поделиться" на Google Диске — поддерживает
 * два самых распространённых формата (.../file/d/ID/... и .../open?id=ID), плюс
 * на случай, если пользователь вставит просто голый ID без ссылки вокруг.
 */
function parseDriveFileId(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    const byPath = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (byPath) return byPath[1];
    const byQuery = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (byQuery) return byQuery[1];
    const byGenericPath = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (byGenericPath) return byGenericPath[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
    return '';
}

const inputCls = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
const labelCls = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";
const rowCls = "border-b border-[#E1D8C5]/60 last:border-b-0 group transition-colors hover:bg-[#F5F2E9]/60";
const cellCls = "px-4 py-3";
const editInputCls = "w-full bg-surface-2 border border-line rounded-md px-2 h-8 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors";

// Тип компании "Производитель" — используется в справочнике материалов.
const MANUFACTURER_COMPANY_TYPE = 'Производитель';
// Полный список типов компаний — используется и в форме компании, и в фильтре таблицы.
const COMPANY_ALL_TYPES = ['Заказчик', 'Генподрядчик', 'Подрядчик', 'Архитектор', 'Перевозчик', 'Поставщик', MANUFACTURER_COMPANY_TYPE, SELLER_LEGAL_ENTITY_COMPANY_TYPE];

export default function DirectoryManager({ appUser }: { appUser: AppUser | null }) {
    const [activeTab, setActiveTab] = useState<'companies'|'contacts'|'expense_categories'|'materials'|'product_types'|'units'|'currencies'|'drivers'|'carriers'>('companies');
    const [companies, setCompanies] = useState<Company[]>([]);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [materials, setMaterials] = useState<Material[]>([]);
    const [productTypes, setProductTypes] = useState<ProductType[]>([]);
    const [units, setUnits] = useState<DirectoryItem[]>([]);
    const [currencies, setCurrencies] = useState<DirectoryItem[]>([]);
    const [drivers, setDrivers] = useState<DirectoryItem[]>([]);
    const [carriers, setCarriers] = useState<Carrier[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    // Идёт сохранение новой записи — блокирует кнопку "Сохранить", чтобы повторное
    // нажатие (пока запись ещё уходит на сервер) не создавало дубликат.
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [newExpCategoryName, setNewExpCategoryName] = useState('');
    const [newDirectoryItemName, setNewDirectoryItemName] = useState('');
    const [newDriverDetails, setNewDriverDetails] = useState({ phone: '', passportSeries: '', passportNumber: '', passportIssuedBy: '', passportIssuedDate: '' });
    const [newCarrierDetails, setNewCarrierDetails] = useState({ contactPerson: '', phone: '', email: '' });
    const [newContact, setNewContact] = useState({ name: '', position: '', phone: '', companyId: '' });
    const [typeFilter, setTypeFilter] = useState('');
    const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
    const [isMaterialImportOpen, setIsMaterialImportOpen] = useState(false);
    const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
    const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<Company | null>(null);

    useEffect(() => {
        const unsubs = [
            onSnapshot(query(collection(db, 'companies'), orderBy('name')), s => setCompanies(s.docs.map(d => ({ id: d.id, ...d.data() } as Company)))),
            onSnapshot(query(collection(db, 'contacts'), orderBy('name')), s => setContacts(s.docs.map(d => ({ id: d.id, ...d.data() } as Contact)))),
            onSnapshot(query(collection(db, 'expense_categories'), orderBy('name')), s => setExpenseCategories(s.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseCategory)))),
            onSnapshot(query(collection(db, 'materials'), orderBy('name')), s => setMaterials(s.docs.map(d => ({ id: d.id, ...d.data() } as Material)))),
            onSnapshot(query(collection(db, 'product_types'), orderBy('name')), s => setProductTypes(s.docs.map(d => ({ id: d.id, ...d.data() } as ProductType)))),
            onSnapshot(query(collection(db, 'units'), orderBy('name')), s => setUnits(s.docs.map(d => ({ id: d.id, ...d.data() } as DirectoryItem)))),
            onSnapshot(query(collection(db, 'currencies'), orderBy('name')), s => setCurrencies(s.docs.map(d => ({ id: d.id, ...d.data() } as DirectoryItem)))),
            onSnapshot(query(collection(db, 'drivers'), orderBy('name')), s => setDrivers(s.docs.map(d => ({ id: d.id, ...d.data() } as DirectoryItem)))),
            onSnapshot(query(collection(db, 'carriers'), orderBy('name')), s => setCarriers(s.docs.map(d => ({ id: d.id, ...d.data() } as Carrier)))),
        ];
        return () => unsubs.forEach(u => u());
    }, []);

    const tabs = [
        { id: 'companies' as const,          label: 'Компании',      icon: <Briefcase size={14} />, count: companies.length },
        { id: 'contacts' as const,           label: 'Контакты',      icon: <Users size={14} />,     count: contacts.length },
        { id: 'materials' as const,          label: 'Материалы',     icon: <Layers size={14} />,    count: materials.length },
        { id: 'product_types' as const,      label: 'Виды товара',   icon: <Tag size={14} />,       count: productTypes.length },
        { id: 'units' as const,              label: 'Ед. измерения', icon: <Maximize size={14} />,  count: units.length },
        { id: 'currencies' as const,         label: 'Валюты',        icon: <Coins size={14} />,     count: currencies.length },
        { id: 'drivers' as const,            label: 'Водители',      icon: <User size={14} />,      count: drivers.length },
        { id: 'carriers' as const,           label: 'Перевозчики',   icon: <Truck size={14} />,     count: carriers.length },
        { id: 'expense_categories' as const, label: 'Виды расходов', icon: <Wallet size={14} />,    count: expenseCategories.length },
    ];

    const s = searchTerm.toLowerCase();
    const filtered = {
        companies:          companies.filter(c => c.name.toLowerCase().includes(s) && (!typeFilter || c.companyType === typeFilter)),
        contacts:           contacts.filter(c => c.name.toLowerCase().includes(s)),
        expense_categories: expenseCategories.filter(c => c.name.toLowerCase().includes(s)),
        materials:          materials.filter(c => c.name.toLowerCase().includes(s)),
        product_types:      productTypes.filter(c => c.name.toLowerCase().includes(s)),
        units:              units.filter(c => c.name.toLowerCase().includes(s)),
        currencies:         currencies.filter(c => c.name.toLowerCase().includes(s)),
        drivers:            drivers.filter(c => c.name.toLowerCase().includes(s)),
        carriers:           carriers.filter(c => c.name.toLowerCase().includes(s)),
    };

    const handleOpenAddMaterial = () => {
        setEditingMaterial(null);
        setIsMaterialModalOpen(true);
    };

    const handleOpenEditMaterial = (m: Material) => {
        setEditingMaterial(m);
        setIsMaterialModalOpen(true);
    };

    const handleOpenAddCompany = () => {
        setEditingCompany(null);
        setIsCompanyModalOpen(true);
    };

    const handleOpenEditCompany = (c: Company) => {
        setEditingCompany(c);
        setIsCompanyModalOpen(true);
    };

    const handleAddClick = () => {
        if (activeTab === 'materials') {
            handleOpenAddMaterial();
            return;
        }
        if (activeTab === 'companies') {
            handleOpenAddCompany();
            return;
        }
        setIsAddingItem(false);
        setShowAddModal(true);
    };

    const handleAdd = async () => {
        if (isAddingItem) return;
        setIsAddingItem(true);
        try {
            if (activeTab === 'expense_categories' && newExpCategoryName) {
                await addDoc(collection(db, 'expense_categories'), { name: newExpCategoryName, createdAt: serverTimestamp() });
                setNewExpCategoryName('');
            } else if (activeTab === 'product_types' && newDirectoryItemName) {
                await addDoc(collection(db, 'product_types'), { name: newDirectoryItemName, createdAt: serverTimestamp() });
                setNewDirectoryItemName('');
            } else if (activeTab === 'units' && newDirectoryItemName) {
                await addDoc(collection(db, 'units'), { name: newDirectoryItemName, createdAt: serverTimestamp() });
                setNewDirectoryItemName('');
            } else if (activeTab === 'currencies' && newDirectoryItemName) {
                await addDoc(collection(db, 'currencies'), { name: newDirectoryItemName.trim(), createdAt: serverTimestamp() });
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
            // Окно НЕ закрываем — запись не сохранилась. Частая причина: у коллекции нет прав
            // на запись в правилах Firestore (или пропала связь). Запись при этом могла на
            // мгновение появиться в списке — это локальная копия, после отказа сервера она исчезнет.
            alert('Не удалось сохранить запись — возможно, нет прав на запись в эту коллекцию (правила Firestore) или пропала связь. Обновите страницу и проверьте, не появилась ли запись.');
            handleFirestoreError(error, OperationType.WRITE, activeTab);
        } finally {
            setIsAddingItem(false);
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
                        {activeTab === 'materials' && (
                            <button onClick={() => setIsMaterialImportOpen(true)}
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-semibold border border-line bg-surface text-ink hover:bg-surface-2 transition-colors">
                                <Upload size={13} /> Импорт из Excel
                            </button>
                        )}
                        <button onClick={handleAddClick}
                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors">
                            <Plus size={13} /> Добавить
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    {activeTab === 'companies'          && <CompaniesTable         companies={filtered.companies} typeFilter={typeFilter} setTypeFilter={setTypeFilter} onEdit={handleOpenEditCompany} />}
                    {activeTab === 'contacts'           && <ContactsTable          contacts={filtered.contacts} companies={companies} />}
                    {activeTab === 'materials'          && <MaterialsTable         items={filtered.materials} productTypes={productTypes} companies={companies} onEdit={handleOpenEditMaterial} />}
                    {activeTab === 'product_types'      && <SimpleTable            items={filtered.product_types} collectionName="product_types" icon={<Tag size={13} />} />}
                    {activeTab === 'units'              && <SimpleTable            items={filtered.units}    collectionName="units"    icon={<Maximize size={13} />} />}
                    {activeTab === 'currencies'         && <SimpleTable            items={filtered.currencies} collectionName="currencies" icon={<Coins size={13} />} />}
                    {activeTab === 'drivers'            && <DriversTable           items={filtered.drivers} />}
                    {activeTab === 'carriers'           && <CarriersTable          items={filtered.carriers as Carrier[]} />}
                    {activeTab === 'expense_categories' && <ExpenseCategoriesTable categories={filtered.expense_categories} />}
                </div>
            </div>

            {/* Add Modal (для всех справочников, кроме материалов и компаний — у них свои модалки ниже) */}
            <AnimatePresence>
                {showAddModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
                        <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
                                    className="relative w-full max-w-md bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] overflow-hidden">
                            <div className="px-6 py-4 border-b border-line flex items-center justify-between">
                                <h3 className="font-serif text-[18px] font-medium text-ink">
                                    {activeTab === 'contacts' ? 'Новый контакт' :
                                        activeTab === 'expense_categories' ? 'Новый вид расхода' :
                                            activeTab === 'product_types' ? 'Новый вид товара' :
                                                activeTab === 'units' ? 'Новая ед. измерения' : activeTab === 'currencies' ? 'Новая валюта' : activeTab === 'drivers' ? 'Новый водитель' : 'Новый перевозчик'}
                                </h3>
                                <button onClick={() => setShowAddModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 transition-colors"><X size={16} /></button>
                            </div>
                            <div className="px-6 py-5 space-y-4">
                                {['expense_categories','product_types','units','currencies','drivers','carriers'].includes(activeTab) && (
                                    <div>
                                        <label className={labelCls}>Название</label>
                                        <input value={activeTab === 'expense_categories' ? newExpCategoryName : newDirectoryItemName}
                                               onChange={e => { if (activeTab === 'expense_categories') setNewExpCategoryName(e.target.value); else setNewDirectoryItemName(e.target.value); }}
                                               placeholder="Введите название..." className={inputCls} autoFocus />
                                        {activeTab === 'currencies' && (
                                            <p className="text-[10.5px] text-ink-4 mt-1">Это название будет напечатано в КП как обозначение валюты — например: USD, EUR или «долл. США»</p>
                                        )}
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
                                <button onClick={handleAdd} disabled={isAddingItem} className="h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">{isAddingItem ? 'Сохранение…' : 'Сохранить'}</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Импорт материалов из Excel */}
            <AnimatePresence>
                {isMaterialImportOpen && (
                    <MaterialsImportModal
                        materials={materials}
                        productTypes={productTypes}
                        companies={companies}
                        units={units}
                        onClose={() => setIsMaterialImportOpen(false)}
                    />
                )}
            </AnimatePresence>

            {/* Модалка добавления/редактирования материала — отдельная, в стиле форм по проекту */}
            <AnimatePresence>
                {isMaterialModalOpen && (
                    <MaterialDirectoryModal
                        editingMaterial={editingMaterial}
                        productTypes={productTypes}
                        companies={companies}
                        units={units}
                        onClose={() => { setIsMaterialModalOpen(false); setEditingMaterial(null); }}
                    />
                )}
            </AnimatePresence>

            {/* Модалка добавления/редактирования компании */}
            <AnimatePresence>
                {isCompanyModalOpen && (
                    <CompanyDirectoryModal
                        editingCompany={editingCompany}
                        onClose={() => { setIsCompanyModalOpen(false); setEditingCompany(null); }}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

/**
 * Единый для ВСЕХ справочников выбор строк галочками и массовое удаление.
 * rows — строки, которые сейчас видны в таблице (после фильтров). Удаляются только отмеченные И видимые строки,
 * чтобы нельзя было случайно удалить строку, скрытую фильтром.
 * Возвращает: bar — панель «Выбрано: N / Удалить выбранное» (null, если ничего не выбрано), headCell — <th> с чекбоксом
 * «выбрать/снять все видимые», rowCell(id) — <td> с чекбоксом строки, rowCls(id) — подсветка отмеченной строки.
 */
function useRowSelection(rows: { id: string }[], collectionName: string, title: string) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);

    const selectedVisible = rows.filter(r => selected.has(r.id));
    const allSelected = rows.length > 0 && selectedVisible.length === rows.length;
    const someSelected = selectedVisible.length > 0 && !allSelected;

    const toggleOne = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    /** Если все видимые отмечены — снимает отметку с них, иначе отмечает все видимые. */
    const toggleAll = () => setSelected(prev => {
        const next = new Set(prev);
        if (allSelected) rows.forEach(r => next.delete(r.id));
        else rows.forEach(r => next.add(r.id));
        return next;
    });

    const deleteSelected = async () => {
        const ids = selectedVisible.map(r => r.id);
        if (ids.length === 0) return;
        if (!confirm(`Удалить выбранные записи из справочника «${title}»: ${ids.length} шт.? Это действие нельзя отменить.`)) return;
        setDeleting(true);
        try {
            for (let i = 0; i < ids.length; i += 400) {
                const batch = writeBatch(db);
                ids.slice(i, i + 400).forEach(id => batch.delete(doc(db, collectionName, id)));
                await batch.commit();
            }
            setSelected(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
        } catch (error) {
            console.error(error);
            alert('Не удалось удалить часть записей. Обновите страницу и проверьте, что осталось в списке.');
        } finally {
            setDeleting(false);
        }
    };

    const bar = selectedVisible.length > 0 ? (
        <div className="flex items-center justify-between px-4 py-2 border-b border-line bg-surface-2 text-[12px] text-ink-2">
            <span>Выбрано: <b className="text-ink">{selectedVisible.length}</b></span>
            <span className="flex items-center gap-4">
                <button type="button" onClick={() => setSelected(new Set())}
                        className="font-semibold text-ink-3 hover:underline">Снять выбор</button>
                <button type="button" onClick={deleteSelected} disabled={deleting}
                        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60">
                    <Trash2 size={13} />
                    {deleting ? 'Удаляю…' : 'Удалить выбранное'}
                </button>
            </span>
        </div>
    ) : null;

    const headCell = (
        <th className="pl-4 pr-1 py-3 w-8">
            <input
                type="checkbox"
                title="Выбрать / снять все отфильтрованные строки"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
                disabled={rows.length === 0}
                className="w-4 h-4 accent-ochre cursor-pointer"
            />
        </th>
    );

    const rowCell = (id: string) => (
        <td className="pl-4 pr-1 py-3 w-8" onClick={e => e.stopPropagation()}>
            <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => toggleOne(id)}
                className="w-4 h-4 accent-ochre cursor-pointer"
            />
        </td>
    );

    return { bar, headCell, rowCell, rowCls: (id: string) => (selected.has(id) ? 'bg-ochre-bg/40' : '') };
}

function THead({ cols, leading }: { cols: string[]; leading?: React.ReactNode }) {
    return (
        <thead>
        <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
            {leading}
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

/** Таблица компаний — строка целиком кликабельна и открывает модалку редактирования (с адресом). */
function CompaniesTable({ companies, typeFilter, setTypeFilter, onEdit }: { companies: Company[], typeFilter: string, setTypeFilter: (v: string) => void, onEdit: (c: Company) => void }) {
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
                const dropdown = document.getElementById('type-filter-dropdown');
                if (!dropdown || !dropdown.contains(e.target as Node)) setFilterOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [filterOpen]);

    const del = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('Удалить компанию?')) await deleteDoc(doc(db, 'companies', id));
    };
    const sel = useRowSelection(companies, 'companies', 'Компании');

    return (
        <>
            {sel.bar}
            {filterOpen && createPortal(
                <div
                    id="type-filter-dropdown"
                    style={{ position: 'absolute', top: `${coords.top}px`, left: `${coords.left}px`, zIndex: 999999, minWidth: '180px' }}
                    className="bg-surface border border-line rounded-md shadow-[0_8px_32px_rgba(48,42,28,0.16)] overflow-hidden"
                >
                    <button
                        type="button"
                        onClick={() => { setTypeFilter(''); setFilterOpen(false); }}
                        className={cn("w-full flex items-center px-3 py-2 text-[13px] text-left transition-colors",
                            !typeFilter ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold" : "text-ink hover:bg-surface-2"
                        )}
                    >Все типы</button>
                    {COMPANY_ALL_TYPES.map(t => (
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
                    {sel.headCell}
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
                    <th className="px-4 py-3 font-bold">Адрес</th>
                    <th className="px-4 py-3 font-bold text-right w-20"></th>
                </tr>
                </thead>
                <tbody>
                {companies.map(c => (
                    <tr key={c.id} className={cn(rowCls, "cursor-pointer", sel.rowCls(c.id))} onClick={() => onEdit(c)}>
                        {sel.rowCell(c.id)}
                        <td className={cellCls}>
                            <div className="flex items-center gap-3"><span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0"><Briefcase size={13} /></span><span className="text-[13px] font-medium text-ink">{c.name}</span></div>
                        </td>
                        <td className={cellCls}>
                            <span className="text-[13px] font-medium text-ink">{c.companyType || '—'}</span>
                        </td>
                        <td className={cn(cellCls, "text-[12px] text-ink-3 max-w-[240px] truncate")}>{c.address || '—'}</td>
                        <td className={cn(cellCls, "text-right")}>
                            <ActionBtns onEdit={() => onEdit(c)} onDelete={(e: any) => del(e, c.id)} />
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
    const sel = useRowSelection(contacts, 'contacts', 'Контакты');
    return (
        <>
            {sel.bar}
            <table className="w-full text-left">
                <THead leading={sel.headCell} cols={['ФИО', 'Компания', 'Должность / Телефон', '']} />
                <tbody>
                {contacts.map(c => (
                    <tr key={c.id} className={cn(rowCls, sel.rowCls(c.id))}>
                        {sel.rowCell(c.id)}
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
        </>
    );
}

function ExpenseCategoriesTable({ categories }: { categories: ExpenseCategory[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const save = async (id: string) => { await updateDoc(doc(db, 'expense_categories', id), { name: editName }); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить категорию?')) await deleteDoc(doc(db, 'expense_categories', id)); };
    const sel = useRowSelection(categories, 'expense_categories', 'Категории расходов');
    return (
        <>
            {sel.bar}
            <table className="w-full text-left">
                <THead leading={sel.headCell} cols={['Наименование', '']} />
                <tbody>
                {categories.map(c => (
                    <tr key={c.id} className={cn(rowCls, sel.rowCls(c.id))}>
                        {sel.rowCell(c.id)}
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
        </>
    );
}

/** Фильтр столбца: text — введённый текст; exact — значение выбрано из списка (точное совпадение),
 * иначе фильтр работает по вхождению текста. */
interface ColFilter { text: string; exact: boolean }
const EMPTY_FILTER: ColFilter = { text: '', exact: false };
const normText = (v: string) => (v || '').replace(/ё/gi, 'е').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Заголовок столбца с фильтром-комбобоксом: значок воронки открывает окошко с полем поиска
 * (по вхождению текста — таблица фильтруется по мере ввода) и списком значений столбца для выбора.
 * Окошко рисуется поверх страницы (portal), чтобы его не обрезала прокрутка таблицы.
 */
function ColumnFilterHeader({ label, options, value, onChange, className }: {
    label: string;
    options: string[];
    value: ColFilter;
    onChange: (v: ColFilter) => void;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const active = !!value.text;

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        const onResize = () => setOpen(false);
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', onResize);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', onResize);
        };
    }, [open]);

    const toggle = () => {
        if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - 280)) });
        }
        setOpen(o => !o);
    };

    // Пока значение не выбрано из списка — список сужается по введённому тексту (по вхождению).
    const shown = value.exact || !value.text
        ? options
        : options.filter(o => normText(o).includes(normText(value.text)));

    return (
        <th className={cn("px-4 py-3 font-bold", className)}>
            <span className="inline-flex items-center gap-1.5">
                {label}
                <button
                    ref={btnRef}
                    type="button"
                    onClick={toggle}
                    title="Фильтр по столбцу"
                    className={cn(
                        "w-5 h-5 inline-flex items-center justify-center rounded transition-colors normal-case",
                        active ? "bg-ochre text-white" : "text-ink-4 hover:bg-surface-2 hover:text-ink"
                    )}
                >
                    <Filter size={11} />
                </button>
            </span>
            {open && createPortal(
                <div
                    ref={popRef}
                    style={{ position: 'fixed', top: pos.top, left: pos.left, width: 272, zIndex: 200 }}
                    className="bg-surface border border-line rounded-xl shadow-[0_12px_32px_-8px_rgba(48,42,28,0.28)] p-2.5 normal-case tracking-normal font-normal"
                >
                    <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                        <input
                            autoFocus
                            value={value.text}
                            onChange={e => onChange({ text: e.target.value, exact: false })}
                            placeholder="Поиск по вхождению…"
                            className="w-full bg-surface-2 border border-line rounded-md pl-7 pr-7 h-8 text-[12.5px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4"
                        />
                        {value.text && (
                            <button type="button" onClick={() => onChange(EMPTY_FILTER)} title="Сбросить"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-ink">
                                <X size={12} />
                            </button>
                        )}
                    </div>
                    <div className="mt-2 max-h-56 overflow-y-auto custom-scrollbar">
                        {shown.length === 0 && <p className="px-2 py-2 text-[11.5px] text-ink-4">Ничего не найдено</p>}
                        {shown.map(o => {
                            const selected = value.exact && normText(value.text) === normText(o);
                            return (
                                <button
                                    key={o}
                                    type="button"
                                    onClick={() => { onChange({ text: o, exact: true }); setOpen(false); }}
                                    className={cn(
                                        "w-full text-left px-2 py-1.5 rounded-md text-[12.5px] leading-snug transition-colors",
                                        selected ? "bg-ochre-bg text-ochre font-semibold" : "text-ink hover:bg-surface-2"
                                    )}
                                >
                                    {o}
                                </button>
                            );
                        })}
                    </div>
                </div>,
                document.body
            )}
        </th>
    );
}

/**
 * Таблица справочника материалов — строка целиком кликабельна и открывает модалку редактирования.
 * Вид товара и производитель отображаются по ID, разрешая актуальное название из ЖИВЫХ справочников
 * (productTypes/companies). В заголовке каждого столбца — фильтр-комбобокс (поиск по вхождению + выбор значения).
 */
function MaterialsTable({ items, productTypes, companies, onEdit }: { items: Material[]; productTypes: ProductType[]; companies: Company[]; onEdit: (m: Material) => void }) {
    const [fMaterial, setFMaterial] = useState<ColFilter>(EMPTY_FILTER);
    const [fChar, setFChar] = useState<ColFilter>(EMPTY_FILTER);
    const [fType, setFType] = useState<ColFilter>(EMPTY_FILTER);
    const [fMan, setFMan] = useState<ColFilter>(EMPTY_FILTER);
    const del = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirm('Удалить материал из справочника?')) await deleteDoc(doc(db, 'materials', id));
    };

    const typeOf = (m: Material) => productTypes.find(pt => pt.id === m.productTypeId)?.name || '—';
    const manOf = (m: Material) => companies.find(c => c.id === m.manufacturerId)?.name || '—';
    const uniq = (vals: string[]) => Array.from(new Set(vals)).sort((a, b) => a.localeCompare(b, 'ru'));

    // Совпадение: выбрано из списка — точное (без учёта регистра), иначе — по вхождению текста.
    const matches = (f: ColFilter, exactValue: string, searchText: string) => {
        if (!f.text) return true;
        return f.exact ? normText(exactValue) === normText(f.text) : normText(searchText).includes(normText(f.text));
    };
    const charOf = (m: Material) => (m.characteristics || '').trim() || '—';

    const predicates = {
        material: (m: Material) => matches(fMaterial, m.name, m.name),
        char: (m: Material) => matches(fChar, charOf(m), m.characteristics || ''),
        type: (m: Material) => matches(fType, typeOf(m), typeOf(m)),
        man: (m: Material) => matches(fMan, manOf(m), manOf(m)),
    };
    type ColKey = keyof typeof predicates;
    /** Строки, прошедшие ВСЕ фильтры, кроме указанного столбца. */
    const rowsExcept = (skip?: ColKey) =>
        items.filter(m => (Object.keys(predicates) as ColKey[]).every(k => k === skip || predicates[k](m)));

    const visible = rowsExcept();

    // Варианты в списке каждого фильтра — только из строк, которые остались после ВСЕХ ОСТАЛЬНЫХ фильтров
    // (собственный фильтр столбца не учитывается, чтобы можно было переключить выбор на другое значение).
    const materialOptions = uniq(rowsExcept('material').map(m => m.name));
    const charOptions = uniq(rowsExcept('char').map(charOf));
    const typeOptions = uniq(rowsExcept('type').map(typeOf));
    const manOptions = uniq(rowsExcept('man').map(manOf));
    const anyFilter = !!(fMaterial.text || fChar.text || fType.text || fMan.text);

    const sel = useRowSelection(visible, 'materials', 'Материалы');

    return (
        <>
            {sel.bar}
            {anyFilter && (
                <div className="flex items-center justify-between px-4 py-2 border-b border-line bg-ochre-bg/40 text-[11.5px] text-ink-2">
                    <span>Показано {visible.length} из {items.length}</span>
                    <button type="button" onClick={() => { setFMaterial(EMPTY_FILTER); setFChar(EMPTY_FILTER); setFType(EMPTY_FILTER); setFMan(EMPTY_FILTER); }}
                            className="font-semibold text-ochre hover:underline">Сбросить фильтры</button>
                </div>
            )}
            <table className="w-full text-left">
                <thead>
                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                    {sel.headCell}
                    <ColumnFilterHeader label="Материал" options={materialOptions} value={fMaterial} onChange={setFMaterial} />
                    <ColumnFilterHeader label="Характеристики" options={charOptions} value={fChar} onChange={setFChar} />
                    <ColumnFilterHeader label="Вид товара" options={typeOptions} value={fType} onChange={setFType} />
                    <ColumnFilterHeader label="Производитель" options={manOptions} value={fMan} onChange={setFMan} />
                    <th className="px-4 py-3 font-bold text-right w-20"></th>
                </tr>
                </thead>
                <tbody>
                {visible.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-[12.5px] text-ink-4">Ничего не найдено</td></tr>
                )}
                {visible.map(item => {
                    const productTypeName = typeOf(item);
                    const manufacturerName = manOf(item);
                    return (
                        <tr key={item.id} className={cn(rowCls, "cursor-pointer", sel.rowCls(item.id))} onClick={() => onEdit(item)}>
                            {sel.rowCell(item.id)}
                            <td className={cellCls}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="w-7 h-7 rounded-lg bg-ochre-bg flex items-center justify-center text-ochre shrink-0 overflow-hidden">
                                        {item.photoDriveFileId
                                            ? <img
                                                src={`https://drive.google.com/thumbnail?id=${item.photoDriveFileId}&sz=w100`}
                                                alt=""
                                                className="w-full h-full object-cover"
                                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                            />
                                            : <Layers size={13} />}
                                    </span>
                                    <p className="text-[13px] font-medium text-ink leading-snug">{item.name}</p>
                                </div>
                            </td>
                            <td className={cn(cellCls, "text-[12.5px] text-ink-2 leading-snug max-w-[360px]")}>{item.characteristics || '—'}</td>
                            <td className={cn(cellCls, "text-[12px] text-ink-3")}>{productTypeName}</td>
                            <td className={cn(cellCls, "text-[12px] text-ink-3")}>{manufacturerName}</td>
                            <td className={cn(cellCls, "text-right")}>
                                <ActionBtns onEdit={() => onEdit(item)} onDelete={(e: any) => del(e, item.id)} />
                            </td>
                        </tr>
                    );
                })}
                </tbody>
            </table>
        </>
    );
}

function DriversTable({ items }: { items: any[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editData, setEditData] = useState<any>({});
    const save = async (id: string) => { await updateDoc(doc(db, 'drivers', id), editData); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить водителя?')) await deleteDoc(doc(db, 'drivers', id)); };
    const sel = useRowSelection(items, 'drivers', 'Водители');
    return (
        <>
            {sel.bar}
            <table className="w-full text-left">
                <THead leading={sel.headCell} cols={['ФИО', 'Телефон', 'Паспорт серия / номер', 'Кем / когда выдан', '']} />
                <tbody>
                {items.map(item => (
                    <tr key={item.id} className={cn(rowCls, sel.rowCls(item.id))}>
                        {sel.rowCell(item.id)}
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
        </>
    );
}

function CarriersTable({ items }: { items: Carrier[] }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editData, setEditData] = useState<Partial<Carrier>>({});
    const save = async (id: string) => { await updateDoc(doc(db, 'carriers', id), editData); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить перевозчика?')) await deleteDoc(doc(db, 'carriers', id)); };
    const sel = useRowSelection(items, 'carriers', 'Перевозчики');
    return (
        <>
            {sel.bar}
            <table className="w-full text-left">
                <THead leading={sel.headCell} cols={['Перевозчик', 'Контакт / Телефон', 'Email', '']} />
                <tbody>
                {items.map(item => (
                    <tr key={item.id} className={cn(rowCls, sel.rowCls(item.id))}>
                        {sel.rowCell(item.id)}
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
        </>
    );
}

function SimpleTable({ items, collectionName, icon }: { items: any[], collectionName: string, icon: React.ReactNode }) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const save = async (id: string) => { await updateDoc(doc(db, collectionName, id), { name: editName }); setEditingId(null); };
    const del = async (id: string) => { if (confirm('Удалить запись?')) await deleteDoc(doc(db, collectionName, id)); };
    const sel = useRowSelection(items, collectionName, 'Записи');
    return (
        <>
            {sel.bar}
            <table className="w-full text-left">
                <THead leading={sel.headCell} cols={['Наименование', '']} />
                <tbody>
                {items.map(item => (
                    <tr key={item.id} className={cn(rowCls, sel.rowCls(item.id))}>
                        {sel.rowCell(item.id)}
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
        </>
    );
}

// ───────────────────────── модалка добавления/редактирования компании ─────────────────────────

/** Модалка добавления/редактирования компании — с полем "Адрес" (нужно, например, для реквизитов юр. лица в печатной форме КП). */
function CompanyDirectoryModal({ editingCompany, onClose }: {
    editingCompany: Company | null;
    onClose: () => void;
}) {
    const isEditing = !!editingCompany;
    const [name, setName] = useState(editingCompany?.name || '');
    const [companyType, setCompanyType] = useState(editingCompany?.companyType || '');
    const [address, setAddress] = useState(editingCompany?.address || '');
    const [innKpp, setInnKpp] = useState(editingCompany?.innKpp || '');
    const [ogrnOkpo, setOgrnOkpo] = useState(editingCompany?.ogrnOkpo || '');
    const [bankDetails, setBankDetails] = useState(editingCompany?.bankDetails || '');
    const [directorName, setDirectorName] = useState(editingCompany?.directorName || '');
    const [directorPhone, setDirectorPhone] = useState(editingCompany?.directorPhone || '');
    // Логотип: в карточке хранится только ID файла на Диске; в поле ввода можно вставить
    // любую ссылку "Поделиться", ID распознаём при потере фокуса (как у фото материала).
    const [logoDriveFileId, setLogoDriveFileId] = useState(editingCompany?.logoDriveFileId || '');
    const [logoLinkText, setLogoLinkText] = useState(editingCompany?.logoDriveFileId || '');
    const [isSaving, setIsSaving] = useState(false);

    const commitLogoLink = () => {
        const id = parseDriveFileId(logoLinkText);
        setLogoDriveFileId(id);
        setLogoLinkText(id); // нормализуем поле к самому ID — видно, что ссылка распозналась
        if (logoLinkText.trim() && !id) {
            alert('Не удалось распознать ссылку на файл Google Диска. Проверьте, что скопировали именно ссылку "Поделиться" на файл.');
        }
    };

    const handleRemoveLogo = () => {
        setLogoDriveFileId('');
        setLogoLinkText('');
    };

    const handleSave = async () => {
        if (!name.trim()) return;
        setIsSaving(true);
        try {
            const payload = {
                name: name.trim(),
                companyType: companyType || '',
                address: address.trim(),
                innKpp: innKpp.trim(),
                ogrnOkpo: ogrnOkpo.trim(),
                bankDetails: bankDetails.trim(),
                directorName: directorName.trim(),
                directorPhone: directorPhone.trim(),
                logoDriveFileId,
            };
            if (isEditing && editingCompany) {
                await updateDoc(doc(db, 'companies', editingCompany.id), payload);
            } else {
                await addDoc(collection(db, 'companies'), { ...payload, createdAt: serverTimestamp(), managerId: auth.currentUser?.uid });
            }
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, 'companies');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                        {isEditing ? 'Редактировать компанию' : 'Новая компания'}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    <div>
                        <label className={labelCls}>Название компании</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Введите название..." className={inputCls} autoFocus />
                    </div>
                    <div>
                        <label className={labelCls}>Тип компании</label>
                        <select value={companyType} onChange={e => setCompanyType(e.target.value)} className={cn(inputCls, "appearance-none cursor-pointer")}>
                            <option value="">— не указан —</option>
                            {COMPANY_ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Адрес</label>
                        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Юридический адрес..." className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>ИНН / КПП</label>
                            <input value={innKpp} onChange={e => setInnKpp(e.target.value)} placeholder="ИНН 0000000000, КПП 000000000" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>ОГРН / ОКПО</label>
                            <input value={ogrnOkpo} onChange={e => setOgrnOkpo(e.target.value)} placeholder="ОГРН 0000000000000, ОКПО 00000000" className={inputCls} />
                        </div>
                    </div>
                    <div>
                        <label className={labelCls}>Счёт</label>
                        <textarea
                            value={bankDetails}
                            onChange={e => setBankDetails(e.target.value)}
                            rows={2}
                            placeholder="Расчётный счёт, банк, к/с, БИК..."
                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 resize-none"
                        />
                    </div>
                    <div className="grid grid-cols-[1fr_190px] gap-3">
                        <div>
                            <label className={labelCls}>Генеральный директор</label>
                            <input value={directorName} onChange={e => setDirectorName(e.target.value)} placeholder="Фамилия Имя Отчество" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Телефон директора</label>
                            <input value={directorPhone} onChange={e => setDirectorPhone(e.target.value)} placeholder="+7 000 000 00 00" className={inputCls} />
                        </div>
                    </div>
                    {companyType === SELLER_LEGAL_ENTITY_COMPANY_TYPE && (
                        <div>
                            <label className={labelCls}>Логотип — ссылка на Google Диск</label>
                            <p className="text-[10.5px] text-ink-4 mb-2">Вставьте ссылку «Поделиться» на файл логотипа (PNG или JPG) — он печатается в шапке КП вместо плейсхолдера {'{{COMPANY_LOGO}}'}</p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={logoLinkText}
                                    onChange={e => setLogoLinkText(e.target.value)}
                                    onBlur={commitLogoLink}
                                    placeholder="https://drive.google.com/file/d/..."
                                    className={inputCls}
                                />
                                {logoDriveFileId && (
                                    <button
                                        type="button"
                                        onClick={handleRemoveLogo}
                                        title="Убрать логотип"
                                        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md border border-line text-terracotta hover:bg-terracotta/5 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                            {logoDriveFileId && (
                                <div className="mt-2 flex items-center gap-3">
                                    <img
                                        src={`https://drive.google.com/thumbnail?id=${logoDriveFileId}&sz=w200`}
                                        alt={name}
                                        className="w-20 h-20 rounded-lg object-contain border border-line bg-surface-2"
                                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    <a
                                        href={`https://drive.google.com/file/d/${logoDriveFileId}/view`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[12px] text-ochre hover:underline"
                                    >
                                        Открыть на Диске
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-line flex justify-end gap-2 shrink-0 bg-surface-2/30">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!name.trim() || isSaving}
                        className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSaving ? 'Сохранение…' : 'Сохранить'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// ───────────────────────── модалка добавления/редактирования материала ─────────────────────────

/**
 * Отдельное модальное окно для справочника материалов — в едином стиле с формами
 * материала/отгрузки/доверенности по проекту. Вид товара выбирается ТОЛЬКО из уже
 * существующих значений справочника (без возможности создать новый прямо здесь) —
 * на вид товара завязана бизнес-логика в MaterialsTab, поэтому список видов должен
 * оставаться контролируемым через раздел «Виды товара».
 *
 * В материал сохраняются ТОЛЬКО ID (productTypeId, manufacturerId) — название вида
 * товара и производителя нигде не дублируется строкой, чтобы переименование в
 * соответствующем справочнике сразу отражалось везде, где материал используется.
 */
function MaterialDirectoryModal({ editingMaterial, productTypes, companies, units, onClose }: {
    editingMaterial: Material | null;
    productTypes: ProductType[];
    companies: Company[];
    units: DirectoryItem[];
    onClose: () => void;
}) {
    const isEditing = !!editingMaterial;
    // Генерируем ID заранее (а не через addDoc) — он нужен как путь в Storage для фото
    // ещё ДО того, как сама запись материала будет сохранена в Firestore.
    const materialDocId = useRef(editingMaterial?.id || crypto.randomUUID()).current;
    const [name, setName] = useState(editingMaterial?.name || '');
    const [productTypeId, setProductTypeId] = useState(editingMaterial?.productTypeId || '');
    const [characteristics, setCharacteristics] = useState(editingMaterial?.characteristics || '');
    const [manufacturerId, setManufacturerId] = useState(editingMaterial?.manufacturerId || '');
    const [manufacturerName, setManufacturerName] = useState(
        () => companies.find(c => c.id === editingMaterial?.manufacturerId)?.name || ''
    );
    // Единица измерения — ссылка на справочник «Ед. измерения» (только ID, как у вида товара и производителя).
    const [unitId, setUnitId] = useState(editingMaterial?.unitId || '');
    const [qtyPerM2, setQtyPerM2] = useState(editingMaterial?.qtyPerM2 ? String(editingMaterial.qtyPerM2) : '');
    const [qtyPerPallet, setQtyPerPallet] = useState(editingMaterial?.qtyPerPallet ? String(editingMaterial.qtyPerPallet) : '');
    const [palletsPerTruck, setPalletsPerTruck] = useState(editingMaterial?.palletsPerTruck ? String(editingMaterial.palletsPerTruck) : '');
    const [photoDriveFileId, setPhotoDriveFileId] = useState(editingMaterial?.photoDriveFileId || '');
    // Буфер для самого поля ввода — пользователь может вставить туда любую ссылку
    // на Диск, а не только "чистый" ID; распознаём ID при потере фокуса (см. commitPhotoLink).
    const [photoLinkText, setPhotoLinkText] = useState(editingMaterial?.photoDriveFileId || '');
    const [isSaving, setIsSaving] = useState(false);

    const inputClass = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";


    const commitPhotoLink = () => {
        const id = parseDriveFileId(photoLinkText);
        setPhotoDriveFileId(id);
        setPhotoLinkText(id); // нормализуем поле к самому ID — так видно, что ссылка распозналась
        if (photoLinkText.trim() && !id) {
            alert('Не удалось распознать ссылку на файл Google Диска. Проверьте, что скопировали именно ссылку "Поделиться" на файл.');
        }
    };

    const handleRemovePhoto = () => {
        setPhotoDriveFileId('');
        setPhotoLinkText('');
    };

    const handleSave = async () => {
        if (!name.trim()) return;
        setIsSaving(true);
        try {
            const payload = {
                name: name.trim(),
                productTypeId: productTypeId || '',
                characteristics: characteristics.trim(),
                manufacturerId: manufacturerId || '',
                unitId: unitId || null,
                qtyPerM2: qtyPerM2 ? Number(qtyPerM2) : null,
                qtyPerPallet: qtyPerPallet ? Number(qtyPerPallet) : null,
                palletsPerTruck: palletsPerTruck ? Number(palletsPerTruck) : null,
                photoDriveFileId: photoDriveFileId || null,
            };
            if (isEditing) {
                await updateDoc(doc(db, 'materials', materialDocId), payload);
            } else {
                await setDoc(doc(db, 'materials', materialDocId), { ...payload, createdAt: serverTimestamp() });
            }
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, 'materials');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-lg bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                        {isEditing ? 'Редактировать материал' : 'Новый материал'}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    <div>
                        <label className={labelCls}>Вид товара</label>
                        <select value={productTypeId} onChange={e => setProductTypeId(e.target.value)} className={cn(inputClass, "appearance-none cursor-pointer")}>
                            <option value="">— не указан —</option>
                            {productTypes.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                        </select>
                        <p className="text-[10.5px] text-ink-4 mt-1">Новый вид товара можно добавить только в разделе «Виды товара»</p>
                    </div>

                    <div>
                        <label className={labelCls}>Наименование</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Например: кирпич brown velvet light" className={inputClass} autoFocus />
                    </div>

                    <div>
                        <label className={labelCls}>Характеристики</label>
                        <textarea
                            value={characteristics}
                            onChange={e => setCharacteristics(e.target.value)}
                            rows={3}
                            placeholder="Например: 1 НФ 250*120*65мм, Цвет: PATINA GREEN BROWN..."
                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 resize-none"
                        />
                    </div>

                    <div>
                        <label className={labelCls}>Производитель</label>
                        <CompanySelect
                            value={manufacturerName}
                            onChange={(nm, id) => { setManufacturerName(nm); setManufacturerId(id || ''); }}
                            placeholder="Выбрать или создать производителя..."
                            companyType={MANUFACTURER_COMPANY_TYPE}
                        />
                    </div>

                    <div>
                        <label className={labelCls}>Единица измерения</label>
                        <select value={unitId} onChange={e => setUnitId(e.target.value)} className={cn(inputClass, "appearance-none cursor-pointer")}>
                            <option value="">— не указана —</option>
                            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                        <p className="text-[10.5px] text-ink-4 mt-1">Подставляется в карточку материала проекта автоматически. Новую единицу можно добавить во вкладке «Ед. измерения»</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>Кол-во шт в 1 м²</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={qtyPerM2}
                                onChange={e => setQtyPerM2(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''))}
                                placeholder="—"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Кол-во шт в поддоне</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={qtyPerPallet}
                                onChange={e => setQtyPerPallet(e.target.value.replace(/\D/g, ''))}
                                placeholder="—"
                                className={inputClass}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Кол-во поддонов в машине</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={palletsPerTruck}
                                onChange={e => setPalletsPerTruck(e.target.value.replace(/\D/g, ''))}
                                placeholder="—"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {(
                        <div>
                            <label className={labelCls}>Фото материала — ссылка на Google Диск</label>
                            <p className="text-[10.5px] text-ink-4 mb-2">Вставьте ссылку «Поделиться» на файл из папки с фото на Диске — используется в печатной форме КП</p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={photoLinkText}
                                    onChange={e => setPhotoLinkText(e.target.value)}
                                    onBlur={commitPhotoLink}
                                    placeholder="https://drive.google.com/file/d/..."
                                    className={inputClass}
                                />
                                {photoDriveFileId && (
                                    <button
                                        type="button"
                                        onClick={handleRemovePhoto}
                                        title="Убрать фото"
                                        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-md border border-line text-terracotta hover:bg-terracotta/5 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                            {photoDriveFileId && (
                                <div className="mt-2 flex items-center gap-3">
                                    <img
                                        src={`https://drive.google.com/thumbnail?id=${photoDriveFileId}&sz=w200`}
                                        alt={name}
                                        className="w-20 h-20 rounded-lg object-cover border border-line bg-surface-2"
                                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                    />
                                    <a
                                        href={`https://drive.google.com/file/d/${photoDriveFileId}/view`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[12px] text-ochre hover:underline"
                                    >
                                        Открыть на Диске
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-line flex justify-end gap-2 shrink-0 bg-surface-2/30">
                    <button onClick={onClose} className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!name.trim() || isSaving}
                        className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isSaving ? 'Сохранение…' : 'Сохранить'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}