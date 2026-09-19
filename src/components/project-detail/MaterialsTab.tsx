import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, User as UserIcon, CheckCircle2, Layers, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { Project, Contact, ProjectMaterial } from '../../types';
import CompanySelect from '../CompanySelect';
import MaterialSelect from '../MaterialSelect';
import { Button } from '../ui/Button';
import DirectorySelect from './shared/DirectorySelect';

/**
 * Вкладка «Материалы» — таблица материалов проекта с добавлением/редактированием.
 * Отгрузки вынесены в отдельную вкладку ShipmentsTab (раньше были здесь же,
 * на одном экране с материалами — просто разрезано без изменения логики).
 */
function MaterialsTab({ project, canEdit, directories }: { project: Project, canEdit: boolean, directories: any }) {
    const [isAddingMaterial, setIsAddingMaterial] = useState(false);
    const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);

    const materials = project.materials || [];

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            {/* Materials Section */}
            <div className={cn(
                "rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]"
            )}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                    <div className="flex items-center gap-4">
                        <h3 className={cn("text-[14px] font-serif font-medium flex items-center gap-2", "text-ink")}>
                            Материалы по проекту
                            <span className="text-[11px] font-serif opacity-40">· {materials.length}</span>
                        </h3>
                    </div>
                    {materials.length > 0 && canEdit && (
                        <Button
                            variant="ochre"
                            size="sm"
                            className="h-8 px-2.5 text-[11.5px] font-semibold"
                            icon={<Plus size={12} />}
                            onClick={() => {
                                setEditingMaterialId(null);
                                setIsAddingMaterial(true);
                            }}
                        >
                            Добавить материал
                        </Button>
                    )}
                </div>

                <div className="p-4">
                    {materials.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {materials.map((m) => {
                                const contact = directories.contacts?.find((c: any) => c.id === m.supplierContactId) ||
                                    (m.supplierId ? directories.contacts?.find((c: any) => c.companyId === m.supplierId) : null);

                                return (
                                    <div
                                        key={m.id}
                                        className={cn(
                                            "p-4 rounded-xl transition-all group relative border bg-[#F5F2E9] border-transparent hover:bg-[#EBE5D6]"
                                        )}
                                    >
                                        <div className="flex justify-between items-start gap-2.5">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className={cn(
                                                    "w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0",
                                                    "bg-[#F3EAD4] text-[#A67C3C]"
                                                )}>
                                                    <Layers size={14.5} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <h4 className={cn(
                                                        "font-bold text-[13.5px] leading-tight truncate",
                                                        "text-ink"
                                                    )}>
                                                        {m.materialName}
                                                    </h4>
                                                    <p className={cn(
                                                        "text-[11.5px] mt-0.5 tracking-wide font-medium truncate",
                                                        "text-[#8A8574]"
                                                    )}>
                                                        {m.quantity} {m.unitName}{m.deliveryMonth ? ` · поставка ${m.deliveryMonth.toLowerCase()}` : ''}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center shrink-0">
                                                {canEdit && <button
                                                    onClick={() => {
                                                        setEditingMaterialId(m.id);
                                                        setIsAddingMaterial(true);
                                                    }}
                                                    className={cn(
                                                        "p-1.5 rounded-full transition-colors",
                                                        "hover:bg-white/50 text-[#7A7564]"
                                                    )}
                                                    title="Редактировать"
                                                >
                                                    <Pencil size={12.5} />
                                                </button>}
                                            </div>
                                        </div>

                                        <div className={cn(
                                            "border-t border-dashed my-2.5",
                                            "border-[#DAD3C1]"
                                        )} />

                                        <div className="space-y-0.5">
                      <span className={cn(
                          "text-[9px] font-bold uppercase tracking-widest block",
                          "text-[#8A8574]"
                      )}>
                        ПОСТАВЩИК
                      </span>
                                            <p className={cn(
                                                "text-[12.5px] font-bold leading-tight",
                                                "text-ink"
                                            )}>
                                                {m.supplierName || 'Не указан'}
                                            </p>
                                            {contact && (
                                                <p className={cn(
                                                    "text-[11px] leading-normal font-medium truncate",
                                                    "text-[#7A7564]"
                                                )}>
                                                    {contact.name}{contact.phone ? `, ${contact.phone}` : ''}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className={cn("py-7 px-5 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5", "border-line bg-transparent")}>
                            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", "bg-white border border-line text-ink-3 shadow-sm")}>
                                <Layers size={16} />
                            </div>
                            <div className="text-center space-y-0.5">
                                <p className={cn("text-[13px] font-serif font-medium", "text-ink")}>Материалы ещё не добавлены</p>
                                <p className={cn("text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60", "text-ink-4")}>Сначала добавьте материалы — потом по ним пойдут отгрузки</p>
                            </div>
                            <Button
                                variant="ochre"
                                size="sm"
                                className="mt-2 px-3 h-8 text-[11.5px] font-semibold"
                                icon={<Plus size={12} />}
                                onClick={() => {
                                    setEditingMaterialId(null);
                                    setIsAddingMaterial(true);
                                }}
                                style={{ display: canEdit ? undefined : 'none' }}
                            >
                                Добавить материал
                            </Button>
                        </div>
                    )}
                </div>
            </div>


            <AnimatePresence>
                {isAddingMaterial && (
                    <MaterialModal
                        project={project}
                        editingId={editingMaterialId}
                        onClose={() => setIsAddingMaterial(false)}
                        directories={directories}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function MaterialModal({ project, editingId, onClose, directories }: { project: Project, editingId: string | null, onClose: () => void, directories: any }) {
    const editingMaterial = project.materials?.find(m => m.id === editingId);
    const [form, setForm] = useState<Partial<ProjectMaterial>>(editingMaterial || {
        materialName: '',
        quantity: undefined,
        unitName: 'шт.',
        deliveryMonth: '',
        supplierName: '',
        supplierContactId: ''
    });

    const [showAddSupplierContact, setShowAddSupplierContact] = useState(false);
    const [supplierContact, setSupplierContact] = useState({ name: '', position: '', phone: '' });
    const [availableContacts, setAvailableContacts] = useState<Contact[]>([]);

    const selectedSupplierCompany = directories.companies?.find((c: any) => c.name === form.supplierName);
    const supplierId = selectedSupplierCompany?.id;

    // Track contacts for the selected supplier
    useEffect(() => {
        if (supplierId) {
            const q = query(collection(db, 'contacts'), where('companyId', '==', supplierId));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setAvailableContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
            });
            return () => unsubscribe();
        } else {
            setAvailableContacts([]);
        }
    }, [supplierId]);

    const handleCreateSupplierContact = async () => {
        if (!supplierId || !supplierContact.name) return;
        try {
            const docRef = await addDoc(collection(db, 'contacts'), {
                companyId: supplierId,
                ...supplierContact,
                createdAt: serverTimestamp()
            });
            setForm(prev => ({ ...prev, supplierContactId: docRef.id }));
            setSupplierContact({ name: '', position: '', phone: '' });
            setShowAddSupplierContact(false);
        } catch (error) {
            console.error(error);
        }
    };

    const handleSave = async () => {
        try {
            const materials = project.materials || [];
            const newMaterial = {
                ...form,
                quantity: form.quantity || 0,
                id: editingId || crypto.randomUUID(),
            } as ProjectMaterial;

            let updated;
            if (editingId) {
                updated = materials.map(m => m.id === editingId ? newMaterial : m);
            } else {
                updated = [...materials, newMaterial];
            }

            await updateDoc(doc(db, 'projects', project.id), {
                materials: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const handleDelete = async () => {
        if (!editingId || !confirm('Удалить этот материал из проекта?')) return;
        try {
            const updated = (project.materials || []).filter(m => m.id !== editingId);
            await updateDoc(doc(db, 'projects', project.id), {
                materials: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/materials/${editingId}`);
        }
    };

    const inputClass = cn(
        "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
    );

    const isContactFormOpen = supplierId && (availableContacts.length === 0 || showAddSupplierContact);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="fixed inset-0 bg-ink/40 backdrop-blur-sm"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-[560px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto overflow-visible"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                        {editingId ? 'Редактировать материал' : 'Добавить материал'}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 flex-1 overflow-visible flex flex-col gap-5">
                    {/* Материал */}
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                            МАТЕРИАЛ
                        </label>
                        <MaterialSelect
                            value={form.materialName || ''}
                            onChange={(name, id) => setForm({...form, materialName: name, materialId: id})}
                            placeholder="Выбрать из справочника..."
                        />
                    </div>

                    {/* Количество, Ед. изм., Месяц поставки */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                                КОЛИЧЕСТВО
                            </label>
                            <input
                                type="number"
                                value={form.quantity !== undefined ? form.quantity : ''}
                                onChange={e => setForm({...form, quantity: e.target.value ? Number(e.target.value) : undefined})}
                                className={inputClass}
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                                ЕД. ИЗМ.
                            </label>
                            <DirectorySelect
                                value={form.unitName || ''}
                                options={directories.units}
                                onChange={v => setForm({...form, unitName: v})}
                                onAdd={async name => {
                                    await addDoc(collection(db, 'units'), { name, createdAt: serverTimestamp() });
                                    setForm({...form, unitName: name});
                                }}
                                placeholder="шт., м2..."
                                className={inputClass}
                                iconType="unit"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-2">
                                МЕСЯЦ ПОСТАВКИ
                            </label>
                            <input
                                value={form.deliveryMonth || ''}
                                onChange={e => setForm({...form, deliveryMonth: e.target.value})}
                                placeholder="напр. июнь"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {/* Поставщик */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574]">
                                ПОСТАВЩИК
                            </label>
                            {supplierId && !isContactFormOpen && (
                                <button
                                    type="button"
                                    onClick={() => setShowAddSupplierContact(true)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                                >
                                    <Plus size={11} className="text-ochre" /> Добавить контактное лицо
                                </button>
                            )}
                        </div>
                        <CompanySelect
                            value={form.supplierName || ''}
                            onChange={(name, id) => {
                                setForm({...form, supplierName: name, supplierId: id, supplierContactId: ''});
                                setShowAddSupplierContact(false);
                            }}
                            placeholder="Выбрать компанию-поставщика..."
                            companyType="Поставщик"
                            onCreateCompany={{ companyType: 'Поставщик' }}
                        />

                        {/* Контактные лица */}
                        {supplierId && (
                            <div className="mt-3.5">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8574] mb-2">
                                    КОНТАКТНЫЕ ЛИЦА
                                </p>

                                {availableContacts.length > 0 && (
                                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto mb-3">
                                        {availableContacts.map(contact => {
                                            const selected = form.supplierContactId === contact.id;
                                            return (
                                                <div
                                                    key={contact.id}
                                                    className={cn(
                                                        "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors group",
                                                        selected
                                                            ? "bg-ochre-bg border-[var(--ochre-soft)]"
                                                            : "bg-surface-2 border-transparent hover:bg-surface hover:border-line"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setForm(prev => ({
                                                                ...prev,
                                                                supplierContactId: selected ? undefined : contact.id
                                                            }));
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

                                {isContactFormOpen && (
                                    <div className={cn(
                                        "p-4 rounded-xl bg-[var(--ochre-bg)] border border-[var(--ochre-soft)] flex flex-col gap-2.5",
                                        availableContacts.length > 0 && "mt-3"
                                    )}>
                                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ochre)]">
                                            {availableContacts.length === 0
                                                ? `Первое контактное лицо для ${form.supplierName || 'компании'}`
                                                : `Новое контактное лицо для ${form.supplierName}`}
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                placeholder="ФИО"
                                                value={supplierContact.name}
                                                onChange={e => setSupplierContact({...supplierContact, name: e.target.value})}
                                                className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4 h-10"
                                            />
                                            <input
                                                placeholder="Должность"
                                                value={supplierContact.position}
                                                onChange={e => setSupplierContact({...supplierContact, position: e.target.value})}
                                                className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4 h-10"
                                            />
                                            <input
                                                placeholder="Телефон"
                                                value={supplierContact.phone}
                                                onChange={e => setSupplierContact({...supplierContact, phone: e.target.value})}
                                                className="bg-surface border border-line rounded-md px-3 py-2 text-[13px] text-ink focus:border-ochre focus:outline-none placeholder:text-ink-4 col-span-2 h-10"
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleCreateSupplierContact}
                                                disabled={!supplierContact.name}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--ochre)] text-[var(--bg-elev)] hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                Сохранить контакт
                                            </button>
                                            {availableContacts.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setShowAddSupplierContact(false); setSupplierContact({ name: '', position: '', phone: '' }); }}
                                                    className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[#c4a484] hover:bg-surface transition-colors"
                                                >
                                                    Отмена
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-between items-center shrink-0">
                    <div>
                        {editingId && (
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 rounded-md text-[13px] font-semibold text-rose-500 border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500 hover:text-white transition-colors flex items-center gap-1.5"
                            >
                                <Trash2 size={14} /> Удалить
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
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
                            {editingId ? 'Сохранить изменения' : 'Добавить материал'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}


export default MaterialsTab;