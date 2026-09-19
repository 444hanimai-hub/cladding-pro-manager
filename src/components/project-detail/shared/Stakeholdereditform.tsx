import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../../lib/firebase';
import { motion } from 'motion/react';
import { StakeholderGroup, Contact } from '../../../types';
import { User as UserIcon, Plus, X, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import CompanySelect from '../../CompanySelect';

function StakeholderEditForm({ projectId, role, currentData, onClose }: { projectId: string, role: string, currentData?: StakeholderGroup, onClose: () => void }) {
    const [companyName, setCompanyName] = useState(currentData?.companyName || '');
    const [companyId, setCompanyId] = useState(currentData?.companyId || '');
    const [selectedContactIds, setSelectedContactIds] = useState<string[]>(currentData?.contactIds || []);
    const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);
    const [showAddContact, setShowAddContact] = useState(false);
    const [newContact, setNewContact] = useState({ name: '', position: '', phone: '' });
    const [isChangingCompany, setIsChangingCompany] = useState(false);

    useEffect(() => {
        if (companyId) {
            const q = query(collection(db, 'contacts'), where('companyId', '==', companyId));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setAvailableContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
            });
            return () => unsubscribe();
        } else {
            setAvailableContacts([]);
        }
    }, [companyId]);

    const handleCompanyChange = async (name: string, id?: string) => {
        setCompanyName(name);
        setCompanyId(id || '');
        setSelectedContactIds([]);
        setShowAddContact(false);
    };

    const handleCreateContact = async () => {
        if (!companyId || !newContact.name) return;
        try {
            const docRef = await addDoc(collection(db, 'contacts'), {
                companyId,
                ...newContact,
                createdAt: serverTimestamp()
            });
            setSelectedContactIds([...selectedContactIds, docRef.id]);
            setNewContact({ name: '', position: '', phone: '' });
            setShowAddContact(false);
        } catch (error) {
            console.error(error);
        }
    };

    const roleToCompanyType = (r: string): string => {
        switch (r) {
            case 'client':              return 'Заказчик';
            case 'generalContractor':   return 'Генподрядчик';
            case 'subcontractor':       return 'Подрядчик';
            case 'architect':           return 'Архитектор';
            default:                    return '';
        }
    };

    const handleSave = async () => {
        try {
            let finalCompanyId = companyId;
            if (!finalCompanyId && companyName) {
                const companyRef = await addDoc(collection(db, 'companies'), {
                    name: companyName,
                    companyType: roleToCompanyType(role),
                    managerId: auth.currentUser?.uid,
                    createdAt: serverTimestamp()
                });
                finalCompanyId = companyRef.id;
            }
            const updates: any = {
                [`stakeholders.${role}`]: {
                    companyId: finalCompanyId,
                    companyName,
                    contactIds: selectedContactIds
                },
                updatedAt: serverTimestamp()
            };
            if (role === 'client') {
                updates.client = companyName;
            }
            await updateDoc(doc(db, 'projects', projectId), updates);
            onClose();
        } catch (error) {
            console.error(error);
        }
    };

    const roleLabel =
        role === 'generalContractor' ? 'Генподрядчик' :
            role === 'subcontractor' ? 'Подрядчик' :
                role === 'architect' ? 'Архитектор' : 'Заказчик';

    const isContactFormOpen = showAddContact || (Boolean(companyId) && availableContacts.length === 0);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            />

            {/* Dialog */}
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="relative w-full max-w-[560px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col max-h-[90vh] overflow-visible"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
                    <h2 className="font-display text-[20px] font-medium text-ink leading-tight">
                        Редактировать: {roleLabel}
                    </h2>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 flex-1 overflow-visible flex flex-col gap-5">
                    {/* Компания */}
                    <div>
                        <label className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 block mb-2">
                            Компания
                        </label>
                        {companyId && !isChangingCompany ? (
                            <div className="flex items-center justify-between gap-3 bg-surface border border-line rounded-md px-3 py-2.5">
                                <span className="text-[13px] font-semibold text-ink truncate">{companyName}</span>
                                <button
                                    onClick={() => {
                                        setCompanyName('');
                                        setCompanyId('');
                                        setSelectedContactIds([]);
                                        setShowAddContact(false);
                                        setIsChangingCompany(true);
                                    }}
                                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                                >
                                    Сменить
                                </button>
                            </div>
                        ) : (
                            <CompanySelect
                                value={companyName}
                                onChange={(name, id) => {
                                    handleCompanyChange(name, id);
                                    setIsChangingCompany(false);
                                }}
                                placeholder="Поиск по справочнику..."
                                companyType={roleToCompanyType(role)}
                            />
                        )}
                    </div>

                    {/* Контактные лица */}
                    <div>
                        <div className="flex items-center justify-between mb-2.5">
                            <label className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                                Контактные лица
                            </label>
                            {companyId && !isContactFormOpen && (
                                <button
                                    onClick={() => setShowAddContact(true)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                                >
                                    <Plus size={12} /> Добавить
                                </button>
                            )}
                        </div>

                        {/* Список выбранных контактов компании */}
                        {availableContacts.length > 0 && (
                            <div className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto">
                                {availableContacts.map(contact => {
                                    const selected = selectedContactIds.includes(contact.id);
                                    return (
                                        <div
                                            key={contact.id}
                                            className={cn(
                                                "flex items-center gap-2.5 px-3 py-2.5 rounded-md border transition-colors group",
                                                selected
                                                    ? "bg-ochre-bg border-[var(--ochre-soft)]"
                                                    : "bg-surface-2 border-transparent hover:bg-surface hover:border-line"
                                            )}
                                        >
                                            <button
                                                onClick={() => {
                                                    setSelectedContactIds(
                                                        selected
                                                            ? selectedContactIds.filter(id => id !== contact.id)
                                                            : [...selectedContactIds, contact.id]
                                                    );
                                                }}
                                                className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                                            >
                        <span className="w-7 h-7 rounded-full bg-surface border border-line flex items-center justify-center text-ink-3 shrink-0">
                          <UserIcon size={13} />
                        </span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] font-semibold text-ink truncate leading-tight">{contact.name}</p>
                                                    {(contact.position || contact.phone) && (
                                                        <p className="text-[11px] text-ink-3 truncate mt-0.5">
                                                            {contact.position}
                                                            {contact.position && contact.phone && ' · '}
                                                            {contact.phone && <span className="tabular-nums">{contact.phone}</span>}
                                                        </p>
                                                    )}
                                                </div>
                                            </button>
                                            {selected && (
                                                <CheckCircle2 size={14} className="text-ochre shrink-0" />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Форма «Новый контакт» */}
                        {isContactFormOpen && (
                            <div className={cn(
                                "p-4 rounded-md bg-[var(--ochre-bg)] border border-[var(--ochre-soft)] flex flex-col gap-2.5",
                                availableContacts.length > 0 && "mt-3"
                            )}>
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ochre)]">
                                    {availableContacts.length === 0
                                        ? `Первый контакт для ${companyName || 'компании'}`
                                        : `Новый контакт для ${companyName}`}
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        placeholder="ФИО"
                                        value={newContact.name}
                                        onChange={e => setNewContact({...newContact, name: e.target.value})}
                                        className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
                                    />
                                    <input
                                        placeholder="Должность"
                                        value={newContact.position}
                                        onChange={e => setNewContact({...newContact, position: e.target.value})}
                                        className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
                                    />
                                    <input
                                        placeholder="Телефон"
                                        value={newContact.phone}
                                        onChange={e => setNewContact({...newContact, phone: e.target.value})}
                                        className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 col-span-2"
                                    />
                                </div>
                                <div className="flex gap-2 mt-1">
                                    <button
                                        type="button"
                                        onClick={handleCreateContact}
                                        disabled={!newContact.name || !companyId}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--ochre)] text-[var(--bg-elev)] hover:brightness-95 transition-[filter,background] disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Сохранить контакт
                                    </button>
                                    {availableContacts.length > 0 && (
                                        <button
                                            onClick={() => { setShowAddContact(false); setNewContact({ name: '', position: '', phone: '' }); }}
                                            className="px-3 py-1.5 rounded-md text-[12px] font-medium text-ink-2 hover:bg-surface transition-colors"
                                        >
                                            Отмена
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {!companyId && (
                            <p className="text-[11.5px] italic text-ink-4 mt-1">
                                Сначала выберите компанию, затем сможете добавить контакты.
                            </p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                    >
                        Отмена
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors"
                    >
                        Сохранить изменения
                    </button>
                </div>
            </motion.div>
        </div>
    );
}


export default StakeholderEditForm;