import React, { useState, useEffect } from 'react';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, ChevronRight, FileText, Printer, Pencil, Trash2, Download, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatDateToDisplay } from '../../lib/utils';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { generateTrustDeedDocx, downloadBlob, uploadTrustDeedToDrive, driveFileExists, TrustDeedDocxData } from '../../lib/generateTrustDeedDocx';
import {
    getSuggestedTrustDeedNumber,
    createTrustDeedWithNumber,
    updateTrustDeedWithNumber,
    deleteTrustDeedWithNumber,
    NumberTakenError,
} from '../../lib/trustDeedNumbering';
import { Project, TrustDeed } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import DirectorySelect from './shared/DirectorySelect';
import { ShipmentDetailField } from './shared/ShipmentDetailField';

function TrustDeedsTab({ project, canEdit, directories, trustDeeds, accessToken, onConnectCalendar, onClearCalendarToken }: { project: Project, canEdit: boolean, directories: any, trustDeeds: TrustDeed[], accessToken?: string | null, onConnectCalendar?: () => Promise<boolean>, onClearCalendarToken?: () => void }) {
    const [selectedDeedId, setSelectedDeedId] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<TrustDeed>>({});
    const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
    // Номер доверенности на момент начала редактирования — нужен, чтобы понять,
    // изменился ли номер при сохранении (тогда нужно переносить "замок" номера).
    const [originalNumber, setOriginalNumber] = useState<string | null>(null);

    const selectedDeed = trustDeeds.find(d => d.id === selectedDeedId);

    const handleGenerateDeed = async (deed: TrustDeed) => {
        // Открываем пустую вкладку СРАЗУ, синхронно — до первого await в этой функции,
        // то есть в тот же момент, что и клик пользователя. Только так браузер точно не
        // сочтёт её "неожиданным" попапом. Реальный адрес документа мы узнаем позже
        // (после проверки на Drive, возможного диалога подтверждения и самой загрузки) —
        // тогда просто перенаправим уже открытую вкладку на готовую ссылку.
        const pendingTab = accessToken ? window.open('', '_blank') : null;

        const mat = project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName);
        // Поставщик берётся ТОЛЬКО из материала проекта — доверенность больше не хранит
        // supplierName отдельно (раньше это приводило к рассинхронизации данных).
        const materialSupplier = (mat as any)?.supplierName || '';

        const data: TrustDeedDocxData = {
            number: deed.number,
            issueDate: formatDateToDisplay(deed.issueDate),
            expiryDate: formatDateToDisplay(deed.expiryDate),
            organization: 'ООО "АРХИХАБ", ИНН 1655466404, КПП 165501001, 420021, Республика Татарстан, г. Казань, ул. Николая Столбова, д. 1/3, пом. 1014',
            driverName: deed.driverName || '',
            driverPosition: '',
            driverPassportSeries: deed.driverPassportSeries || '',
            driverPassportNumber: deed.driverPassportNumber || '',
            driverPassportIssuedBy: (deed as any).driverPassportIssuedBy || '',
            driverPassportIssuedDate: formatDateToDisplay((deed as any).driverPassportIssuedDate),
            supplierName: materialSupplier,
            accountNumber: deed.accountNumber || '',
            accountDate: formatDateToDisplay((deed as any).accountDate),
            bankAccount: '',
            bankName: '',
            materialName: deed.materialName || '',
            materialUnit: 'Шт.',
            quantity: String(deed.quantity || ''),
            quantityText: '',
            headName: 'Аухадуллина Д.Н.',
            chiefAccountantName: 'Аухадуллина Д.Н.',
        };

        // Формируем имя файла: номер_Поставщик_ставка_Фамилия_Перевозчик
        const stripAbbr = (name: string) =>
            name.replace(/^(ООО|ОАО|ЗАО|АО|ИП|НКО|ПАО)\s+["«»"']?/i, '').replace(/["«»"']/g, '').trim();
        const supplier = stripAbbr(materialSupplier);
        const rateK = deed.rate ? Math.floor(deed.rate / 1000) : 0;
        const driverLastName = (deed.driverName || '').split(' ')[0] || '';
        const carrier = stripAbbr(deed.carrierName || '');
        const filename = `${deed.number}_${supplier}_${rateK}_${driverLastName}_${carrier}.docx`
            .replace(/\s+/g, '_').replace(/[/\\:*?"<>|]/g, '');

        try {
            const blob = await generateTrustDeedDocx(data);

            if (!accessToken) {
                pendingTab?.close();
                downloadBlob(blob, filename);
                return;
            }

            // Если в базе сохранён driveFileId — проверяем, что файл РЕАЛЬНО ещё существует
            // на Google Диске (его могли удалить вручную), и только тогда спрашиваем,
            // заменять ли его. Если файла на Диске уже нет — вопрос не задаём, просто
            // создаём новый (existingFileId ниже станет undefined).
            const existingFileId = deed.driveFileId && await driveFileExists(deed.driveFileId, accessToken)
                ? deed.driveFileId
                : undefined;

            // «Да» — перезаписываем существующий файл (без дублей).
            // «Нет» — Диск не трогаем вообще, просто отдаём свежий файл на скачивание/открытие.
            if (existingFileId) {
                const shouldReplace = window.confirm(
                    `Доверенность №${deed.number} уже есть на Google Диске. Вы хотите её заменить?`
                );
                if (!shouldReplace) {
                    pendingTab?.close();
                    downloadBlob(blob, filename);
                    return;
                }
            }

            const { fileId, link } = await uploadTrustDeedToDrive(blob, filename, accessToken, existingFileId);
            // Перенаправляем заранее открытую вкладку на готовый документ.
            if (pendingTab) {
                pendingTab.location.href = link;
            }
            // Сохраняем/обновляем driveFileId и ссылку в самой доверенности — driveFileId
            // нужен, чтобы при следующей печати перезаписать этот же файл, а не плодить
            // новые; driveFileLink — чтобы показать постоянную кнопку "Открыть документ"
            // в панели деталей (обычная ссылка <a>, которую не блокирует блокировщик попапов).
            if (fileId && (fileId !== deed.driveFileId || link !== deed.driveFileLink)) {
                try {
                    await updateDoc(doc(db, 'trust_deeds', deed.id), { driveFileId: fileId, driveFileLink: link });
                } catch (saveIdErr) {
                    console.error('Не удалось сохранить driveFileId доверенности:', saveIdErr);
                }
            }
        } catch (e) {
            pendingTab?.close();
            console.error('Ошибка генерации документа:', e);
            alert('Не удалось загрузить доверенность в Google Drive. Файл будет скачан на компьютер.');
            try {
                const blob2 = await generateTrustDeedDocx(data);
                downloadBlob(blob2, filename);
            } catch (e2) {
                console.error('Fallback download failed:', e2);
            }
        }
    };

    const addExpiryWeek = (issueDate: string) => {
        if (!issueDate) return '';
        const d = new Date(issueDate);
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
    };

    const handleAdd = async () => {
        if (!canEdit) return;
        const issueDate = new Date().toISOString().split('T')[0];
        // Подсказка "следующий свободный номер" по сквозному счётчику (по всей системе,
        // не только в рамках проекта). Поле в форме остаётся редактируемым — можно
        // стереть и вписать любой номер вручную (например, чтобы продолжить нумерацию,
        // которая уже велась у заказчика до перехода на эту систему).
        const suggested = await getSuggestedTrustDeedNumber(db);
        setFormData({
            number: suggested,
            issueDate,
            expiryDate: addExpiryWeek(issueDate),
            supplierId: '',
            carrierId: '', carrierName: '',
            accountNumber: '', accountDate: '',
            rate: 0,
            driverId: '', driverName: '',
            driverPassportSeries: '', driverPassportNumber: '',
            driverPassportIssuedBy: '', driverPassportIssuedDate: '',
            materialId: '', materialName: '',
            quantity: 0,
        });
        setOriginalNumber(null);
        setIsAdding(true);
        setIsEditing(false);
    };

    const handleEdit = (deed: TrustDeed) => {
        setFormData(deed);
        setOriginalNumber(deed.number);
        setIsAdding(true);
        setIsEditing(true);
    };

    /**
     * Возвращает ID сохранённой доверенности (новый — при создании, тот же — при
     * редактировании) при успехе, или null, если сохранение прервалось (валидация,
     * занятый номер, ошибка записи). ID нужен вызывающему коду (см. handleSaveAndGenerate),
     * чтобы после генерации документа сохранить driveFileId именно в ЭТОТ документ —
     * у новой доверенности id появляется только в момент сохранения, поэтому простого
     * true/false недостаточно.
     */
    const handleSave = async (): Promise<string | null> => {
        if (!canEdit) return null;
        const number = String(formData.number || '').trim();
        if (!number) {
            alert('Укажите номер доверенности — это обязательное поле.');
            return null;
        }

        const path = isEditing && formData.id
            ? `trust_deeds/${formData.id}`
            : `trust_deeds`;
        try {
            // ── Синхронизация водителя со справочником ────────────────────────────
            let driverId = formData.driverId || '';
            const driverPayload: any = {};
            if (formData.driverPassportSeries)     driverPayload.passportSeries     = formData.driverPassportSeries;
            if (formData.driverPassportNumber)     driverPayload.passportNumber     = formData.driverPassportNumber;
            if (formData.driverPassportIssuedBy)   driverPayload.passportIssuedBy   = formData.driverPassportIssuedBy;
            if (formData.driverPassportIssuedDate) driverPayload.passportIssuedDate = formData.driverPassportIssuedDate;
            if ((formData as any).driverPhone)     driverPayload.phone              = (formData as any).driverPhone;

            if (formData.driverName) {
                if (driverId) {
                    // Водитель выбран из справочника — обновляем его данные
                    if (Object.keys(driverPayload).length > 0) {
                        await updateDoc(doc(db, 'drivers', driverId), driverPayload).catch(console.error);
                    }
                } else {
                    // Новый водитель — создаём запись в справочнике
                    const newDriverRef = await addDoc(collection(db, 'drivers'), {
                        name: formData.driverName,
                        ...driverPayload,
                        createdAt: serverTimestamp(),
                    });
                    driverId = newDriverRef.id;
                }
            }

            // Собираем данные доверенности для сохранения — без id/number (id не хранится
            // внутри документа, number передаётся отдельным аргументом в функции ниже).
            const { id: _omitId, number: _omitNumber, ...rest } = formData as any;
            const dataToSave = { ...rest, driverId, projectId: project.id };

            let deedId: string;
            if (isEditing && formData.id) {
                await updateTrustDeedWithNumber(db, formData.id, originalNumber || number, number, dataToSave);
                deedId = formData.id;
            } else {
                deedId = await createTrustDeedWithNumber(db, number, dataToSave);
            }

            if (!isEditing) {
                // Автоматически создаём строку в таблице отгрузок
                const existingShipments = project.shipments || [];
                const mat = project.materials?.find(
                    m => m.id === dataToSave.materialId || m.materialName === dataToSave.materialName
                );
                const matLabel = mat
                    ? `${mat.materialName}${(mat as any).supplierName ? ' ' + (mat as any).supplierName : ''}`
                    : dataToSave.materialName || '';

                const newShipment: any = {
                    id: crypto.randomUUID(),
                    autoNumber: String(existingShipments.length + 1),
                    trustDeedId: deedId,
                    trustDeedNumber: number,
                    poaNumber: number,
                    materialName: matLabel,
                    materialId: dataToSave.materialId || '',
                    quantity: dataToSave.quantity || 0,
                    carryingCost: dataToSave.rate || 0,
                    totalCarryingCost: 0,
                    carrierName: dataToSave.carrierName || '',
                    docType: 'upd',
                    incomingUPD: '',
                    outgoingUPD: '',
                    scanSentToAccounting: false,
                    loadingDate: '',
                    unloadingDate: '',
                    carrierUPD: '',
                    createdAt: new Date().toISOString(),
                };

                await updateDoc(doc(db, 'projects', project.id), {
                    shipments: [...existingShipments, newShipment],
                    updatedAt: serverTimestamp(),
                });
            }
            setIsAdding(false);
            setFormData({});
            setOriginalNumber(null);
            return deedId;
        } catch (error) {
            if (error instanceof NumberTakenError) {
                const suggested = await getSuggestedTrustDeedNumber(db);
                setFormData(prev => ({ ...prev, number: suggested }));
                alert(`Доверенность с номером «${number}» уже существует. Номер в форме обновлён на следующий свободный: ${suggested}.`);
                return null;
            }
            handleFirestoreError(error, OperationType.WRITE, path);
            return null;
        }
    };

    const handleSaveAndGenerate = async () => {
        const snapshot = { ...formData } as TrustDeed;
        const savedId = await handleSave();
        // Если сохранение не удалось (занятый номер / ошибка записи) — не генерируем
        // документ со старыми (несохранёнными) данными.
        if (!savedId) return;
        // У новой доверенности id появляется только сейчас, в снимке формы его не было —
        // без этого driveFileId после генерации сохранился бы не в тот документ (или никуда).
        await handleGenerateDeed({ ...snapshot, id: savedId });
    };

    const handleDelete = async (id: string, number: string) => {
        if (!canEdit || !window.confirm('Вы уверены, что хотите удалить эту доверенность?')) return;
        try {
            await deleteTrustDeedWithNumber(db, id, number);
            if (selectedDeedId === id) setSelectedDeedId(null);
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `trust_deeds/${id}`);
        }
    };

    const sortedTrustDeeds = [...trustDeeds].sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));

    useEffect(() => {
        setSelectedDeedId(prev => {
            if (sortedTrustDeeds.length === 0) return null;
            if (prev && sortedTrustDeeds.some(d => d.id === prev)) return prev;
            return sortedTrustDeeds[0].id;
        });
    }, [trustDeeds.length]);

    const handleConnectGoogle = async () => {
        if (!onConnectCalendar || isConnectingGoogle) return;
        setIsConnectingGoogle(true);
        try {
            await onConnectCalendar();
        } finally {
            setIsConnectingGoogle(false);
        }
    };

    return (
        <div className="space-y-4">
            {!accessToken && onConnectCalendar && (
                <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-ink">Google не подключён</p>
                        <p className="text-[12px] text-ink-3 mt-1 leading-snug">
                            Печать доверенности сохранит файл только на ваш компьютер. Подключите Google, чтобы документы сразу сохранялись на Google Диске.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleConnectGoogle}
                        disabled={isConnectingGoogle}
                        className="shrink-0 h-9 px-4 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                        {isConnectingGoogle ? 'Подключение…' : 'Подключить Google'}
                    </button>
                </div>
            )}
            {sortedTrustDeeds.length > 0 ? (
                <div className="flex flex-col lg:grid lg:grid-cols-5 gap-4 items-start">
                    {/* Table card — 3/5 width */}
                    <div className="lg:col-span-3 min-w-0 self-start rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3 shrink-0">
                            <h3 className="text-[14px] font-serif font-medium flex items-center gap-2 text-ink">
                                Реестр доверенностей
                                <span className="text-[11px] font-serif opacity-40">· {trustDeeds.length}</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => selectedDeed && handleGenerateDeed(selectedDeed)}
                                    disabled={!selectedDeed}
                                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-semibold border border-line text-ink-2 bg-surface hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                    <Printer size={12} /> Печать
                                </button>
                                {canEdit && (
                                    <button onClick={handleAdd} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11.5px] font-semibold bg-[#B48444] text-white hover:bg-[#A6783D] transition-colors">
                                        <Plus size={12} /> Новая доверенность
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="overflow-x-auto custom-scrollbar p-4 pt-2">
                            <table className="w-full text-left">
                                <thead>
                                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                                    <th className="px-4 py-3 font-bold w-10">№</th>
                                    <th className="px-2 py-3 font-bold w-24">Выдана</th>
                                    <th className="px-2 py-3 font-bold w-24">До</th>
                                    <th className="px-4 py-3 font-bold">Водитель</th>
                                    <th className="px-4 py-3 font-bold">Перевозчик</th>
                                    <th className="px-4 py-3 font-bold text-right w-36">Кол-во</th>
                                    <th className="w-8 px-2 py-3" />
                                </tr>
                                </thead>
                                <tbody>
                                {sortedTrustDeeds.map((deed) => {
                                    const isSelected = deed.id === selectedDeedId;
                                    return (
                                        <tr
                                            key={deed.id}
                                            onClick={() => setSelectedDeedId(deed.id === selectedDeedId ? null : deed.id)}
                                            className={cn(
                                                "cursor-pointer transition-colors border-b border-[#E1D8C5]/60 last:border-b-0",
                                                isSelected ? "bg-[#F5E9CC] shadow-[inset_3px_0_0_0_#B07A2C]" : "hover:bg-[#F5F2E9]/80"
                                            )}
                                        >
                                            <td className="px-4 py-3.5">
                                                <span className="text-[11px] text-ink-4 font-mono mr-0.5">№</span>
                                                <span className="text-[13px] font-bold text-ink">{deed.number}</span>
                                            </td>
                                            <td className="px-2 py-3.5"><span className="text-[11px] font-mono text-ink-3 whitespace-nowrap">{deed.issueDate ? formatDateToDisplay(deed.issueDate) : '—'}</span></td>
                                            <td className="px-2 py-3.5"><span className="text-[11px] font-mono text-ink-3 whitespace-nowrap">{deed.expiryDate ? formatDateToDisplay(deed.expiryDate) : '—'}</span></td>
                                            <td className="px-4 py-3.5"><span className="text-[12px] font-medium text-ink">{deed.driverName || '—'}</span></td>
                                            <td className="px-4 py-3.5"><span className="text-[12px] text-ink-3">{deed.carrierName || '—'}</span></td>
                                            <td className="px-4 py-3.5 text-right"><span className="text-[12px] font-mono font-semibold text-ink">{deed.quantity ? (() => {
                                                const mat = project.materials?.find(m => m.id === deed.materialId || m.materialName === deed.materialName);
                                                const unit = (mat as any)?.unitName || '';
                                                return `${deed.quantity.toLocaleString('ru-RU')}${unit ? ' ' + unit : ''}`;
                                            })() : '—'}</span></td>
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

                    {/* Detail card — 2/5 width */}
                    {selectedDeed ? (
                        <div className="lg:col-span-2 w-full self-start rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col max-h-[75vh]">
                            <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-[#E8E4DC] bg-[#FCF9F2]">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] mb-0.5">Доверенность</p>
                                        <h4 className="font-serif text-[20px] font-normal text-[#2C2922] leading-[1.15]">№ {selectedDeed.number}</h4>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {canEdit && (
                                            <>
                                                <button onClick={() => handleEdit(selectedDeed)} title="Редактировать" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><Pencil size={13} /></button>
                                                <button onClick={() => handleDelete(selectedDeed.id, selectedDeed.number)} title="Удалить" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#A04930] hover:bg-[#F5E6E2] transition-colors"><Trash2 size={13} /></button>
                                            </>
                                        )}
                                        <button onClick={() => setSelectedDeedId(null)} title="Свернуть" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><X size={13} /></button>
                                    </div>
                                </div>
                                {selectedDeed.driveFileLink && (
                                    <a
                                        href={selectedDeed.driveFileLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--ochre)] hover:underline"
                                    >
                                        <ExternalLink size={11} /> Открыть документ на Google Диске
                                    </a>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4 bg-[#FCF9F2]">
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Сроки</h5>
                                    <div>
                                        <ShipmentDetailField label="Дата выдачи" value={selectedDeed.issueDate ? formatDateToDisplay(selectedDeed.issueDate) : undefined} />
                                        <ShipmentDetailField label="Действует до" value={selectedDeed.expiryDate ? formatDateToDisplay(selectedDeed.expiryDate) : undefined} showDivider={false} />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Груз</h5>
                                    <div>
                                        <ShipmentDetailField label="Материал" value={(() => {
                                            const mat = project.materials?.find(m => m.id === selectedDeed.materialId || m.materialName === selectedDeed.materialName);
                                            const supplier = (mat as any)?.supplierName;
                                            return selectedDeed.materialName
                                                ? (supplier ? `${selectedDeed.materialName} · ${supplier}` : selectedDeed.materialName)
                                                : undefined;
                                        })()} />
                                        <ShipmentDetailField label="Количество" value={selectedDeed.quantity ? `${selectedDeed.quantity.toLocaleString('ru-RU')} шт` : undefined} showDivider={false} />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Логистика</h5>
                                    <div>
                                        <ShipmentDetailField label="Перевозчик" value={selectedDeed.carrierName} />
                                        <ShipmentDetailField label="Счёт №" value={selectedDeed.accountNumber} />
                                        <ShipmentDetailField label="Дата счёта" value={(selectedDeed as any).accountDate ? formatDateToDisplay((selectedDeed as any).accountDate) : undefined} />
                                        <ShipmentDetailField label="Ставка" value={selectedDeed.rate ? formatCurrency(selectedDeed.rate) : undefined} showDivider={false} />
                                    </div>
                                </div>
                                <div>
                                    <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">Кому</h5>
                                    <div>
                                        <ShipmentDetailField label="ФИО водителя" value={selectedDeed.driverName} />
                                        <ShipmentDetailField label="Паспорт — серия" value={selectedDeed.driverPassportSeries} />
                                        <ShipmentDetailField label="Паспорт — номер" value={selectedDeed.driverPassportNumber} />
                                        <ShipmentDetailField label="Кем выдан" value={(selectedDeed as any).driverPassportIssuedBy} />
                                        <ShipmentDetailField label="Когда выдан" value={(selectedDeed as any).driverPassportIssuedDate ? formatDateToDisplay((selectedDeed as any).driverPassportIssuedDate) : undefined} showDivider={false} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="lg:col-span-2 w-full self-start rounded-2xl border border-dashed border-line bg-transparent p-8 flex flex-col items-center justify-center gap-2 text-center">
                            <ChevronRight size={18} className="text-ink-4 opacity-40" />
                            <p className="text-[12px] font-medium text-ink-3">Выберите доверенность</p>
                            <p className="text-[10px] text-ink-4">для просмотра подробностей</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                        <h3 className="text-[14px] font-serif font-medium flex items-center gap-2 text-ink">
                            Реестр доверенностей <span className="text-[11px] font-serif opacity-40">· 0</span>
                        </h3>
                    </div>
                    <div className="py-7 px-5 m-4 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5 border-line bg-transparent">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center bg-white border border-line text-ink-3 shadow-sm">
                            <FileText size={16} />
                        </div>
                        <div className="text-center space-y-0.5">
                            <p className="text-[13px] font-serif font-medium text-ink">Доверенностей пока нет</p>
                            <p className="text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60 text-ink-4">Создавайте и формируйте документ прямо отсюда</p>
                        </div>
                        {canEdit && (
                            <button onClick={handleAdd} className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[11.5px] font-semibold bg-[#B48444] text-white hover:bg-[#A6783D] transition-colors">
                                <Plus size={12} /> Новая доверенность
                            </button>
                        )}
                    </div>
                </div>
            )}

            <AnimatePresence>
                {isAdding && (
                    <TrustDeedModal
                        formData={formData}
                        setFormData={(data: Partial<TrustDeed>) => {
                            if (data.issueDate !== formData.issueDate && data.issueDate) {
                                setFormData({ ...data, expiryDate: addExpiryWeek(data.issueDate) });
                            } else {
                                setFormData(data);
                            }
                        }}
                        onClose={() => { setIsAdding(false); setFormData({}); setOriginalNumber(null); }}
                        onSave={handleSave}
                        onSaveAndGenerate={handleSaveAndGenerate}
                        directories={directories}
                        project={project}
                        isEditing={isEditing}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}



function TrustDeedModal({ formData, setFormData, onClose, onSave, onSaveAndGenerate, directories, project, isEditing }: { formData: Partial<TrustDeed> & { accountDate?: string; driverPassportIssuedBy?: string; driverPassportIssuedDate?: string; driverPhone?: string }, setFormData: any, onClose: () => void, onSave: () => void, onSaveAndGenerate: () => void, directories: any, project: Project, isEditing: boolean }) {
    const inputClass = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
    const labelClass = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";
    const sectionLabel = "text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5";

    const materialOptions = (project.materials || []).map(m => ({
        id: m.id,
        name: m.materialName,
        sub: (m as any).supplierName || '',
    }));

    const driverOptions = (directories.drivers || []).map((d: any) => ({ id: d.id, name: d.name }));

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-2xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                            {isEditing ? 'Редактировать доверенность' : 'Новая доверенность'}
                        </h2>
                        <p className="text-[11px] text-ink-3 mt-0.5">Номер сквозной по всей системе (не по проекту) — при желании введите свой</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className={labelClass}>Номер</label>
                            <input type="text" value={formData.number || ''} onChange={e => setFormData({...formData, number: e.target.value})} className={inputClass} placeholder="Авто" />
                        </div>
                        <div>
                            <label className={labelClass}>Дата выдачи</label>
                            <DatePicker value={formData.issueDate || ''} onChange={v => setFormData({...formData, issueDate: v})} variant="compact" className="[&_input]:h-9" />
                        </div>
                        <div>
                            <label className={labelClass}>Действует до</label>
                            <DatePicker value={formData.expiryDate || ''} onChange={v => setFormData({...formData, expiryDate: v})} variant="compact" className="[&_input]:h-9" />
                        </div>
                    </div>

                    <div>
                        <h3 className={sectionLabel}>Груз</h3>
                        <div className="mt-3 grid grid-cols-[1fr_100px] gap-4">
                            <div>
                                <label className={labelClass}>Материал</label>
                                <DirectorySelect
                                    value={formData.materialName || ''}
                                    options={materialOptions.map(m => ({ id: m.id, name: m.sub ? `${m.name} · ${m.sub}` : m.name }))}
                                    onChange={v => {
                                        const mat = materialOptions.find(m => `${m.name} · ${m.sub}` === v || m.name === v);
                                        setFormData({...formData, materialName: mat?.name || v, materialId: mat?.id || ''});
                                    }}
                                    onAdd={async () => {}}
                                    placeholder="Выбрать материал..."
                                    iconType="material"
                                    inputHeight="h-9"
                                />
                            </div>
                            <div>
                                <label className={labelClass}>Количество</label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={formData.quantity ? formData.quantity.toLocaleString('ru-RU') : ''}
                                    onChange={e => {
                                        const raw = e.target.value.replace(/\s/g, '').replace(/[^\d]/g, '');
                                        setFormData({...formData, quantity: raw ? Number(raw) : 0});
                                    }}
                                    className={inputClass}
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className={sectionLabel}>Логистика</h3>
                        <div className="mt-3 space-y-4">
                            <div>
                                <label className={labelClass}>Логистическая компания</label>
                                <DirectorySelect
                                    value={formData.carrierName || ''}
                                    options={(directories.carriers || []).map((c: any) => ({ id: c.id, name: c.name }))}
                                    onChange={v => {
                                        const carrier = (directories.carriers || []).find((c: any) => c.name === v);
                                        setFormData({...formData, carrierName: v, carrierId: carrier?.id || ''});
                                    }}
                                    onAdd={async (name) => {
                                        const ref = await addDoc(collection(db, 'carriers'), { name, createdAt: serverTimestamp() });
                                        await addDoc(collection(db, 'companies'), { name, companyType: 'Перевозчик', createdAt: serverTimestamp() });
                                        setFormData({...formData, carrierName: name, carrierId: ref.id});
                                    }}
                                    placeholder="Выбрать перевозчика..."
                                    iconType="carrier"
                                    inputHeight="h-9"
                                />
                            </div>
                            <div className="grid grid-cols-[140px_130px_1fr] gap-3">
                                <div>
                                    <label className={labelClass}>Счёт №</label>
                                    <input type="text" value={formData.accountNumber || ''} onChange={e => setFormData({...formData, accountNumber: e.target.value})} className={inputClass} placeholder="Номер" />
                                </div>
                                <div>
                                    <label className={labelClass}>от</label>
                                    <DatePicker value={formData.accountDate || ''} onChange={v => setFormData({...formData, accountDate: v})} variant="compact" className="[&_input]:h-9" />
                                </div>
                                <div>
                                    <label className={labelClass}>Ставка, ₽</label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={formData.rate ? formData.rate.toLocaleString('ru-RU') : ''}
                                        onChange={e => {
                                            const raw = e.target.value.replace(/\s/g, '').replace(/[^\d]/g, '');
                                            setFormData({...formData, rate: raw ? Number(raw) : 0});
                                        }}
                                        className={inputClass}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className={sectionLabel}>Кому</h3>
                        <div className="mt-3 space-y-4">
                            <div className="grid grid-cols-[1fr_80px_100px] gap-3">
                                <div>
                                    <label className={labelClass}>ФИО водителя</label>
                                    <DirectorySelect
                                        value={formData.driverName || ''}
                                        options={driverOptions}
                                        onChange={v => {
                                            const driver = (directories.drivers || []).find((d: any) => d.name === v);
                                            setFormData({
                                                ...formData,
                                                driverName: v,
                                                driverId: driver?.id || '',
                                                driverPassportSeries: driver?.passportSeries || formData.driverPassportSeries || '',
                                                driverPassportNumber: driver?.passportNumber || formData.driverPassportNumber || '',
                                                driverPassportIssuedBy: driver?.passportIssuedBy || formData.driverPassportIssuedBy || '',
                                                driverPassportIssuedDate: driver?.passportIssuedDate || formData.driverPassportIssuedDate || '',
                                                driverPhone: driver?.phone || formData.driverPhone || '',
                                            });
                                        }}
                                        onAdd={async () => {}}
                                        placeholder="Выбрать водителя..."
                                        iconType="driver"
                                        inputHeight="h-9"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Серия</label>
                                    <input type="text" maxLength={6} value={formData.driverPassportSeries || ''} onChange={e => setFormData({...formData, driverPassportSeries: e.target.value})} className={inputClass} placeholder="0000" />
                                </div>
                                <div>
                                    <label className={labelClass}>Номер</label>
                                    <input type="text" maxLength={6} value={formData.driverPassportNumber || ''} onChange={e => setFormData({...formData, driverPassportNumber: e.target.value})} className={inputClass} placeholder="000000" />
                                </div>
                            </div>
                            <div className="grid grid-cols-[1fr_130px_130px] gap-3">
                                <div>
                                    <label className={labelClass}>Кем выдан</label>
                                    <input type="text" value={formData.driverPassportIssuedBy || ''} onChange={e => setFormData({...formData, driverPassportIssuedBy: e.target.value})} className={inputClass} placeholder="Наименование органа" />
                                </div>
                                <div>
                                    <label className={labelClass}>Когда выдан</label>
                                    <DatePicker value={formData.driverPassportIssuedDate || ''} onChange={v => setFormData({...formData, driverPassportIssuedDate: v})} variant="compact" className="[&_input]:h-9" />
                                </div>
                                <div>
                                    <label className={labelClass}>Телефон</label>
                                    <input type="text" value={formData.driverPhone || ''} onChange={e => setFormData({...formData, driverPhone: e.target.value})} className={inputClass} placeholder="+7..." />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-line flex flex-col sm:flex-row items-center justify-end gap-3 shrink-0 bg-surface-2/30">
                    <button onClick={onClose} className="w-full sm:w-auto inline-flex items-center justify-center h-9 px-4 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        Отмена
                    </button>
                    <button onClick={onSaveAndGenerate} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md text-[13px] font-semibold border border-line text-ink-3 hover:bg-surface-2 transition-colors">
                        <Download size={14} /> Сохранить и сформировать
                    </button>
                    <button onClick={onSave} className="w-full sm:w-auto inline-flex items-center justify-center h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors">
                        {isEditing ? 'Сохранить изменения' : 'Создать доверенность'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}


export default TrustDeedsTab;