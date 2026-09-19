import React, { useState, useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Check, Trash2, Pencil, ChevronRight, Download, Truck } from 'lucide-react';
import { cn, formatCurrency, formatDate, formatDateToDisplay, getShippingProgress } from '../../lib/utils';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { exportShipmentsToExcel } from '../../lib/export-shipments';
import { Project, Shipment, TrustDeed } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import { Button } from '../ui/Button';
import { STATUS_BG, STATUS_COLOR } from '../../lib/statuses';
import { ShipmentDetailSection, ShipmentDetailField } from './shared/ShipmentDetailField.tsx';

/**
 * Вкладка «Отгрузки» — таблица отгрузок с деталкой и формой создания/редактирования.
 * Раньше жила на одном экране вместе с материалами (вкладка «Материалы и отгрузки») —
 * логика и вёрстка перенесены без изменений, просто теперь это отдельная вкладка.
 */
function ShipmentsTab({ project, canEdit, trustDeeds = [] }: { project: Project, canEdit: boolean, trustDeeds?: TrustDeed[] }) {
    const [isAddingShipment, setIsAddingShipment] = useState(false);
    const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
    const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
    const [migrationDone, setMigrationDone] = useState(false);

    const shipments = project.shipments || [];
    const selectedShipment = shipments.find(s => s.id === selectedShipmentId) ?? null;
    const allMaterialShipped = React.useMemo(
        () => getShippingProgress(project, trustDeeds).isComplete,
        [project.materials, project.shipments]
    );

    // Миграция: удаляем отгрузки без привязки к доверенности
    useEffect(() => {
        if (migrationDone || !canEdit) return;
        const oldShipments = shipments.filter(s => !(s as any).trustDeedId);
        if (oldShipments.length === 0) { setMigrationDone(true); return; }
        const clean = shipments.filter(s => (s as any).trustDeedId);
        updateDoc(doc(db, 'projects', project.id), { shipments: clean, updatedAt: serverTimestamp() })
            .then(() => setMigrationDone(true))
            .catch(console.error);
    }, [project.id, canEdit]);

    useEffect(() => {
        setSelectedShipmentId(prev => {
            if (shipments.length === 0) return null;
            if (prev && shipments.some(s => s.id === prev)) return prev;
            return shipments[0].id;
        });
    }, [shipments]);

    const handleDeleteShipment = async (shipmentId: string) => {
        if (!confirm('Удалить эту отгрузку?')) return;
        try {
            const updated = shipments.filter(s => s.id !== shipmentId);
            await updateDoc(doc(db, 'projects', project.id), {
                shipments: updated,
                updatedAt: serverTimestamp(),
            });
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/shipments/${shipmentId}`);
        }
    };

    const handleExportToExcel = () => {
        exportShipmentsToExcel(shipments, project.name);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8"
        >
            {/* Shipments Section */}
            {shipments.length > 0 ? (
                <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 items-start">
                    {/* Table card — 2/3 width, height by content only */}
                    <div className={cn(
                        "lg:col-span-2 min-w-0 self-start rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden"
                    )}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3 shrink-0">
                            <h3 className={cn("text-[14px] font-serif font-medium flex items-center gap-2", "text-ink")}>
                                Отгрузки
                                <span className="text-[11px] font-serif opacity-40">· {shipments.length}</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="soft"
                                    size="sm"
                                    className="h-8 px-2.5 text-[11.5px] font-medium"
                                    icon={<Download size={12} />}
                                    onClick={handleExportToExcel}
                                >
                                    Экспорт в Excel
                                </Button>
                                {canEdit && (
                                    <span
                                        className="inline-flex"
                                        title={allMaterialShipped ? 'Весь материал отгружен' : undefined}
                                    >
                  <Button
                      variant="primary"
                      size="sm"
                      className="h-8 px-2.5 text-[11.5px] font-semibold"
                      icon={<Plus size={12} />}
                      disabled={allMaterialShipped}
                      onClick={() => {
                          if (allMaterialShipped) return;
                          setEditingShipmentId(null);
                          setIsAddingShipment(true);
                      }}
                  >
                    Новая отгрузка
                  </Button>
                </span>
                                )}
                            </div>
                        </div>

                        <div className="overflow-x-auto custom-scrollbar p-4 pt-2">
                            <table className="w-full text-left">
                                <thead>
                                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                                    <th className="px-4 py-3 font-bold">Тип / Номер</th>
                                    <th className="px-4 py-3 font-bold">Скан</th>
                                    <th className="px-4 py-3 font-bold">Материал / Кол-во</th>
                                    <th className="px-4 py-3 font-bold">Даты</th>
                                    <th className="px-4 py-3 font-bold">Перевозчик / Стоимость</th>
                                    <th className="w-8 px-2 py-3" aria-hidden />
                                </tr>
                                </thead>
                                <tbody>
                                {shipments.map((s) => {
                                    const isSelected = s.id === selectedShipmentId;
                                    const scan = getShipmentScanMeta(s.scanSentToAccounting);
                                    // Подтягиваем данные из доверенности
                                    const deed = s.poaNumber ? trustDeeds.find(d => d.number === s.poaNumber) : null;
                                    const mat = deed ? project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName) : null;
                                    const materialLabel = mat
                                        ? `${mat.materialName}${(mat as any).supplierName ? ' · ' + (mat as any).supplierName : ''}`
                                        : deed?.materialName || s.materialName || '—';
                                    const quantityLabel = deed?.quantity != null ? deed.quantity.toLocaleString('ru-RU') : (s.quantity || '—');
                                    const carrierLabel = deed?.carrierName || s.carrierName || '—';
                                    return (
                                        <tr
                                            key={s.id}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setSelectedShipmentId(s.id)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedShipmentId(s.id); } }}
                                            className={cn(
                                                "cursor-pointer transition-colors border-b border-[#E1D8C5]/60 last:border-b-0",
                                                isSelected
                                                    ? "bg-[#F5E9CC] shadow-[inset_3px_0_0_0_#B07A2C]"
                                                    : "hover:bg-[#F5F2E9]/80"
                                            )}
                                        >
                                            <td className="px-4 py-3.5 align-top">
                                                <div className="space-y-0.5">
                                                    <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-black/5 text-[#141414]/60">
                                {s.docType === 'upd' ? 'УПД' : 'АКТ'}
                              </span>
                                                        <span className="text-[12px] font-bold text-ink">{s.incomingUPD} / {s.outgoingUPD}</span>
                                                    </div>
                                                    <p className="text-[10px] text-ink-4 font-mono">Дов: {s.poaNumber || '—'}{s.poaDate ? ` от ${formatDateToDisplay(s.poaDate)}` : ''}</p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                          <span className={scan.badge} style={scan.badgeStyle}>
                            {scan.label}
                          </span>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                                                <p className="text-[12px] font-bold text-ink">{materialLabel}</p>
                                                <p className="text-[12px] font-mono font-semibold text-ink-3">{quantityLabel}</p>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                                                <p className="text-[12px] text-ink">{formatDate(s.loadingDate)}</p>
                                                <p className="text-[11px] text-ink-4">{formatDate(s.unloadingDate)}</p>
                                            </td>
                                            <td className="px-4 py-3.5 align-top">
                                                <p className="text-[12px] font-bold text-ink">{carrierLabel}</p>
                                                <p className="text-[12px] font-mono font-semibold text-[#5a6b3c]">{formatCurrency(s.totalCarryingCost)}</p>
                                            </td>
                                            <td className="px-2 py-3.5 align-middle text-ink-4">
                                                <ChevronRight size={14} className={cn("transition-opacity", isSelected ? "opacity-80" : "opacity-30")} />
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Detail card */}
                    {selectedShipment && (
                        <div className={cn(
                            "w-full lg:col-span-1 self-start flex flex-col rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden"
                        )}>
                            <ShipmentDetailPanel
                                shipment={selectedShipment}
                                canEdit={canEdit}
                                onEdit={() => {
                                    setEditingShipmentId(selectedShipment.id);
                                    setIsAddingShipment(true);
                                }}
                                onDelete={() => handleDeleteShipment(selectedShipment.id)}
                                onClose={() => setSelectedShipmentId(null)}
                                trustDeeds={trustDeeds}
                                project={project}
                            />
                        </div>
                    )}
                </div>
            ) : (
                <div className={cn(
                    "rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden"
                )}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                        <h3 className={cn("text-[14px] font-serif font-medium flex items-center gap-2", "text-ink")}>
                            Отгрузки
                            <span className="text-[11px] font-serif opacity-40">· 0</span>
                        </h3>
                    </div>
                    <div className={cn("py-7 px-5 m-4 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5", "border-line bg-transparent")}>
                        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", "bg-white border border-line text-ink-3 shadow-sm")}>
                            <Truck size={16} />
                        </div>
                        <div className="text-center space-y-0.5">
                            <p className={cn("text-[13px] font-serif font-medium", "text-ink")}>Отгрузок пока нет</p>
                            <p className={cn("text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60", "text-ink-4")}>Машины и доверенности появятся здесь</p>
                        </div>
                        {canEdit && <Button
                            variant="ochre"
                            size="sm"
                            className="mt-2 px-3 h-8 text-[11.5px] font-semibold"
                            icon={<Plus size={12} />}
                            onClick={() => {
                                setEditingShipmentId(null);
                                setIsAddingShipment(true);
                            }}
                        >
                            Добавить отгрузку
                        </Button>}
                    </div>
                </div>
            )}


            <AnimatePresence>
                {isAddingShipment && (
                    <ShipmentModal
                        project={project}
                        editingId={editingShipmentId}
                        onClose={() => setIsAddingShipment(false)}
                        directories={{}}
                        trustDeeds={trustDeeds}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function getShipmentScanMeta(scan: Shipment['scanSentToAccounting']) {
    if (scan === true || scan === 'yes') {
        return {
            label: 'ОТПРАВЛЕН',
            badge: cn(SCAN_BADGE_BASE, 'tracking-[0.04em]'),
            badgeStyle: { backgroundColor: STATUS_BG.shipping, color: STATUS_COLOR.shipping },
        };
    }
    return {
        label: 'НЕТ',
        badge: cn(SCAN_BADGE_BASE, 'bg-[#f1d9cf] text-terracotta tracking-[0.12em]'),
    };
}

function getScanDisplayValue(scan: Shipment['scanSentToAccounting']) {
    if (scan === true || scan === 'yes') return 'Да';
    if (scan === false || scan === 'no') return 'Нет';
    return '—';
}

function ShipmentDetailPanel({
                                 shipment,
                                 canEdit,
                                 onEdit,
                                 onDelete,
                                 onClose,
                                 trustDeeds = [],
                                 project,
                             }: {
    shipment: Shipment;
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onClose: () => void;
    trustDeeds?: TrustDeed[];
    project: Project;
}) {
    const machineLabel = shipment.autoNumber ? `Машина №${shipment.autoNumber}` : 'Отгрузка';
    const isUpd = shipment.docType === 'upd';
    const incomingDocLabel = isUpd ? 'Входящий УПД' : 'Входящий акт';
    const outgoingDocLabel = isUpd ? 'Исходящий УПД' : 'Исходящий МХ-3';

    // Resolve deed
    const deed = shipment.poaNumber ? trustDeeds.find(d => d.number === shipment.poaNumber) : null;
    const mat = deed ? project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName) : null;
    const materialLabel = mat
        ? `${mat.materialName}${(mat as any).supplierName ? ' ' + (mat as any).supplierName : ''}`
        : deed?.materialName || '';
    const carrierInvoiceLabel = deed?.accountNumber
        ? `Счёт №${deed.accountNumber}${(deed as any).accountDate ? ' от ' + formatDateToDisplay((deed as any).accountDate) : ''}`
        : '';

    return (
        <div className="flex flex-col max-h-[75vh] bg-[#FCF9F2]">
            <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-[#E8E4DC]">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] mb-0.5">Отгрузка</p>
                        <h4 className="font-serif text-[20px] font-normal text-[#2C2922] leading-[1.15] truncate">{machineLabel}</h4>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {canEdit && (
                            <>
                                <button type="button" onClick={onEdit} title="Редактировать" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><Pencil size={13} /></button>
                                <button type="button" onClick={onDelete} title="Удалить" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#A04930] hover:bg-[#F5E6E2] transition-colors"><Trash2 size={13} /></button>
                            </>
                        )}
                        <button type="button" onClick={onClose} title="Свернуть" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><X size={13} /></button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4">
                <ShipmentDetailSection title="Документы">
                    <ShipmentDetailField label={incomingDocLabel} value={shipment.incomingUPD} />
                    <ShipmentDetailField label="Отправлен скан в бухгалтерию" value={getScanDisplayValue(shipment.scanSentToAccounting)} />
                    <ShipmentDetailField label={outgoingDocLabel} value={shipment.outgoingUPD} />
                    <ShipmentDetailField label="Доверенность №" value={shipment.poaNumber} showDivider={false} />
                </ShipmentDetailSection>

                <ShipmentDetailSection title="Перевозка">
                    <ShipmentDetailField label="Дата загрузки" value={shipment.loadingDate ? formatDate(shipment.loadingDate) : undefined} />
                    <ShipmentDetailField label="Дата выгрузки" value={shipment.unloadingDate ? formatDate(shipment.unloadingDate) : undefined} />
                    <ShipmentDetailField label="Перевозчик" value={deed?.carrierName} />
                    <ShipmentDetailField label="Водитель" value={deed?.driverName} />
                    <ShipmentDetailField label="Стоимость перевозки" value={deed?.rate ? formatCurrency(deed.rate) : undefined} />
                    <ShipmentDetailField label="Стоимость перевозки (общая)" value={formatCurrency(shipment.totalCarryingCost || 0)} />
                    <ShipmentDetailField label="Счёт от перевозчика" value={carrierInvoiceLabel || undefined} />
                    <ShipmentDetailField label="УПД перевозчика" value={shipment.carrierUPD} showDivider={false} />
                </ShipmentDetailSection>

                <ShipmentDetailSection title="Груз">
                    <ShipmentDetailField label="Материал" value={materialLabel || undefined} />
                    <ShipmentDetailField label="Количество" value={deed?.quantity != null ? deed.quantity.toLocaleString('ru-RU') : undefined} showDivider={false} />
                </ShipmentDetailSection>
            </div>
        </div>
    );
}


function ShipmentModal({ project, editingId, onClose, directories, trustDeeds = [] }: { project: Project, editingId: string | null, onClose: () => void, directories: any, trustDeeds?: TrustDeed[] }) {
    const editingShipment = project.shipments?.find(s => s.id === editingId);

    // Resolve deed for editing shipment
    const editingDeed = editingShipment?.poaNumber
        ? trustDeeds.find(d => d.number === editingShipment.poaNumber)
        : null;

    const [form, setForm] = useState<Partial<Shipment>>(() => {
        const isSent = editingShipment
            ? (editingShipment.scanSentToAccounting === true || editingShipment.scanSentToAccounting === 'yes')
            : false;

        const base = editingShipment
            ? { ...editingShipment, autoNumber: editingShipment.autoNumber || String((project.shipments || []).indexOf(editingShipment) + 1) }
            : {
                docType: 'upd',
                incomingUPD: '',
                outgoingUPD: '',
                poaNumber: '',
                autoNumber: String((project.shipments || []).length + 1),
                loadingDate: '',
                unloadingDate: '',
                totalCarryingCost: 0,
                carrierUPD: '',
            };

        return { ...base, scanSentToAccounting: isSent };
    });

    const [quantityError, setQuantityError] = useState<string | null>(null);

    // Resolve current deed from form selection
    const selectedDeed = form.poaNumber
        ? trustDeeds.find(d => d.number === form.poaNumber)
        : null;

    // Derive locked fields from deed
    const deedMaterial = selectedDeed
        ? (() => {
            const mat = project.materials?.find(
                m => m.id === selectedDeed.materialId || m.materialName === selectedDeed.materialName
            );
            return mat
                ? `${mat.materialName}${(mat as any).supplierName ? ' ' + (mat as any).supplierName : ''}`
                : selectedDeed.materialName || '';
        })()
        : '';
    const deedQuantity = selectedDeed?.quantity ?? 0;
    const deedCarryingCost = selectedDeed?.rate ?? 0;
    const deedCarrierInvoice = selectedDeed
        ? `Счёт №${selectedDeed.accountNumber || ''}${(selectedDeed as any).accountDate ? ' от ' + formatDateToDisplay((selectedDeed as any).accountDate) : ''}`
        : '';
    const deedCarrierName = selectedDeed?.carrierName || '';

    const handleSave = async () => {
        if (!form.poaNumber) {
            setQuantityError('Выберите доверенность — это обязательное поле.');
            return;
        }

        setQuantityError(null);

        try {
            const shipments = project.shipments || [];
            // Store only fields NOT derivable from deed
            const newShipment: any = {
                id: editingId || crypto.randomUUID(),
                autoNumber: form.autoNumber,
                poaNumber: form.poaNumber,
                trustDeedId: selectedDeed?.id || editingDeed?.id || '',
                docType: form.docType || 'upd',
                incomingUPD: form.incomingUPD || '',
                outgoingUPD: form.outgoingUPD || '',
                scanSentToAccounting: form.scanSentToAccounting || false,
                loadingDate: form.loadingDate || '',
                unloadingDate: form.unloadingDate || '',
                totalCarryingCost: form.totalCarryingCost || 0,
                carrierUPD: form.carrierUPD || '',
                createdAt: editingShipment?.createdAt || new Date().toISOString(),
            };

            let updated;
            if (editingId) {
                updated = shipments.map(s => s.id === editingId ? newShipment : s);
            } else {
                updated = [...shipments, newShipment];
            }

            await updateDoc(doc(db, 'projects', project.id), {
                shipments: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const handleDelete = async () => {
        if (!editingId || !confirm('Удалить эту отгрузку?')) return;
        try {
            const updated = (project.shipments || []).filter(s => s.id !== editingId);
            await updateDoc(doc(db, 'projects', project.id), {
                shipments: updated,
                updatedAt: serverTimestamp()
            });
            onClose();
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/shipments/${editingId}`);
        }
    };

    const inputClass = cn(
        "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
    );

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
                className="relative w-full max-w-3xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden p-0 transition-colors"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-line flex flex-col gap-1.5 shrink-0">
                    <div className="flex items-center justify-between">
                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                            {editingId ? 'Редактировать отгрузку' : 'Новая отгрузка'}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 flex-1 overflow-y-auto flex flex-col gap-6 custom-scrollbar">
                    {/* Document Section — одна строка */}
                    <div className="space-y-3">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C]">ДОКУМЕНТЫ</h3>
                        <div className="flex flex-wrap items-end gap-3">
                            {/* Тоггер Акт/МХ-3 */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block">Тип</label>
                                <button
                                    type="button"
                                    onClick={() => setForm({ ...form, docType: form.docType === 'act' ? 'upd' : 'act' })}
                                    className="flex items-center gap-2 group focus:outline-none h-9 px-2"
                                >
                                    <div className={cn(
                                        "w-8 h-[18px] rounded-full p-0.5 transition-all duration-300 ease-in-out relative flex items-center cursor-pointer shrink-0",
                                        form.docType === 'act' ? "bg-[#A67C3C]" : "bg-[#F5F2E9] border border-line"
                                    )}>
                                        <motion.div
                                            layout
                                            className="w-3.5 h-3.5 rounded-full bg-white shadow-sm"
                                            animate={{ x: form.docType === 'act' ? 14 : 0 }}
                                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                        />
                                    </div>
                                    <span className={cn(
                                        "text-[10px] uppercase tracking-widest select-none transition-colors whitespace-nowrap",
                                        form.docType === 'act' ? "text-[#A67C3C]" : "text-[#8A8574]"
                                    )}>
                    Акт / МХ-3
                  </span>
                                </button>
                            </div>

                            {/* Входящий */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] whitespace-nowrap">
                                    Вх. {form.docType === 'upd' ? 'УПД' : 'Акт'}
                                </label>
                                <input
                                    value={form.incomingUPD || ''}
                                    onChange={e => setForm({...form, incomingUPD: e.target.value})}
                                    className={cn(inputClass, "w-28")}
                                    placeholder="Номер"
                                />
                            </div>

                            {/* Исходящий */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] whitespace-nowrap">
                                    Исх. {form.docType === 'upd' ? 'УПД' : 'МХ-3'}
                                </label>
                                <input
                                    value={form.outgoingUPD || ''}
                                    onChange={e => setForm({...form, outgoingUPD: e.target.value})}
                                    className={cn(inputClass, "w-28")}
                                    placeholder="Номер"
                                />
                            </div>

                            {/* Чекбокс Скан */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block">Скан</label>
                                <button
                                    type="button"
                                    title="Отправлен скан в бухгалтерию"
                                    onClick={() => setForm({ ...form, scanSentToAccounting: !form.scanSentToAccounting })}
                                    className="flex items-center gap-2 focus:outline-none cursor-pointer h-9 px-2"
                                >
                                    <div className={cn(
                                        "w-5 h-5 rounded border transition-all duration-200 flex items-center justify-center shrink-0",
                                        form.scanSentToAccounting
                                            ? "bg-[#7cb244] border-[#7cb244] text-white"
                                            : "bg-[#FDFBF7] border-[#A67C3C]/30 text-transparent"
                                    )}>
                                        <Check size={13} className="stroke-[3px]" />
                                    </div>
                                    <span className={cn(
                                        "text-[10px] uppercase tracking-widest select-none transition-colors",
                                        form.scanSentToAccounting ? "text-[#7cb244]" : "text-[#8A8574]"
                                    )}>
                    {form.scanSentToAccounting ? 'Да' : 'Нет'}
                  </span>
                                </button>
                            </div>
                        </div>

                        {/* Поле доверенности — часть блока документов */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">
                                Доверенность <span className="text-terracotta ml-1">*</span>
                            </label>
                            <select
                                value={form.poaNumber || ''}
                                onChange={e => {
                                    setForm({ ...form, poaNumber: e.target.value });
                                    setQuantityError(null);
                                }}
                                className={cn(inputClass, "appearance-none bg-surface pr-8 cursor-pointer", !form.poaNumber && quantityError && 'border-terracotta')}
                            >
                                <option value="">Выберите доверенность...</option>
                                {trustDeeds.map(deed => (
                                    <option key={deed.id} value={deed.number}>
                                        № {deed.number} от {formatDateToDisplay(deed.issueDate)} · {deed.driverName} · {deed.materialName}
                                    </option>
                                ))}
                            </select>
                            {!form.poaNumber && quantityError && (
                                <p className="mt-1.5 text-[11px] text-terracotta font-medium">{quantityError}</p>
                            )}
                        </div>
                    </div>

                    {/* Transport Section */}
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Перевозка</h3>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="w-full sm:w-[180px]">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Дата загрузки</label>
                                <DatePicker
                                    value={form.loadingDate || ''}
                                    onChange={v => setForm({...form, loadingDate: v})}
                                    variant="compact"
                                />
                            </div>
                            <div className="w-full sm:w-[180px]">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Дата выгрузки</label>
                                <DatePicker
                                    value={form.unloadingDate || ''}
                                    onChange={v => setForm({...form, unloadingDate: v})}
                                    variant="compact"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Cargo Section */}
                    <div className="space-y-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Груз</h3>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Номер а/м</label>
                                <input value={form.autoNumber || ''} readOnly disabled className={cn(inputClass, "opacity-75 bg-surface-2 cursor-not-allowed")} />
                            </div>
                            <div className="md:col-span-6">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Материал</label>
                                <input value={deedMaterial} readOnly className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")} placeholder="— из доверенности" />
                            </div>
                            <div className="md:col-span-4">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Количество</label>
                                <input value={selectedDeed ? deedQuantity.toLocaleString('ru-RU') : ''} readOnly className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")} placeholder="— из доверенности" />
                            </div>
                        </div>
                    </div>

                    {/* Costs Section */}
                    <div className="space-y-3">
                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5">Стоимость и документы перевозчика</h3>

                        {/* Строка 1: Перевозчик, Счёт, УПД */}
                        <div className="grid grid-cols-[1fr_160px_110px] gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Перевозчик</label>
                                <input
                                    value={selectedDeed ? deedCarrierName : ''}
                                    readOnly
                                    className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")}
                                    placeholder="— из доверенности"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Счёт</label>
                                <input
                                    value={selectedDeed ? deedCarrierInvoice : ''}
                                    readOnly
                                    className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")}
                                    placeholder="— из дов."
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">УПД</label>
                                <input
                                    value={form.carrierUPD || ''}
                                    onChange={e => setForm({...form, carrierUPD: e.target.value})}
                                    className={inputClass}
                                    placeholder="Номер"
                                />
                            </div>
                        </div>

                        {/* Строка 2: Стоимость, Стоимость общая */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Стоимость перевозки, ₽</label>
                                <input
                                    type="text"
                                    value={selectedDeed ? deedCarryingCost.toLocaleString('ru-RU') : ''}
                                    readOnly
                                    className={cn(inputClass, "bg-surface-2 cursor-default text-ink-3")}
                                    placeholder="— из доверенности"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5">Стоимость перевозки (общая), ₽</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={form.totalCarryingCost ? form.totalCarryingCost.toLocaleString('ru-RU') : ''}
                                    onChange={e => {
                                        const raw = e.target.value.replace(/\s/g, '').replace(/[^\d]/g, '');
                                        setForm({...form, totalCarryingCost: raw ? Number(raw) : undefined});
                                    }}
                                    className={inputClass}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-between items-center shrink-0 rounded-b-2xl">
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
                            {editingId ? 'Сохранить изменения' : 'Добавить отгрузку'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

const SCAN_BADGE_BASE = 'inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-semibold uppercase whitespace-nowrap font-ui';


export default ShipmentsTab;