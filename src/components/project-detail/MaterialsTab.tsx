import React, { useState, useEffect } from 'react';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, Trash2, Layers, Pencil, ChevronRight, FileText, ExternalLink, Loader2, Check } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { getMarginColor } from '../../lib/financeCalculations';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { Project, ProjectMaterial, TrustDeed } from '../../types';
import CompanySelect from '../CompanySelect';
import MaterialSelect from '../MaterialSelect';
import { Button } from '../ui/Button';
import DirectorySelect from './shared/DirectorySelect';
import {
    calcMaterial,
    calcProjectMaterialsTotals,
    createEmptyProjectMaterial,
    getMarkupPercent,
    priceFromMarkup,
    DEFAULT_VAT_PERCENT,
} from '../../lib/materialFinance';
import { ensureProjectDocsFolder, findOrCreateSubfolder } from '../../lib/googleDriveFolders';
import { uploadFileToDrive } from '../../lib/googleDriveFiles';
import { generateKPDocx, buildKPFileName, KPTemplateType } from '../../lib/generateKPDocx';
import { syncPlannedExpensesForMaterials, getMaterialIdsWithActualExpenses } from '../../lib/plannedExpenses';
import { calcMaterialCurrency, autoSalePriceCurrency } from '../../lib/materialCurrency';

const KP_SUBFOLDER_NAME = 'Коммерческие предложения';

/**
 * Вид товара, для которого форма материала считается по м²/штукам/поддонам, а не
 * просто как единое "количество". Сравнение по имени — так решил заказчик; вид
 * товара при этом заводится только через справочники. Сравнение НАМЕРЕННО
 * регистронезависимое (см. isBrickProductType ниже) — "кирпич"/"Кирпич"/"КИРПИЧ "
 * должны считаться одним и тем же значением, а не разными.
 *
 * Этот же признак используется и для выбора шаблона КП: если среди отмеченных
 * материалов есть хотя бы один "кирпич" — печатаем кирпичным шаблоном
 * (template_kp.docx, заточен под расчёт по м²/поддонам), иначе — универсальным
 * (template_kp_other.docx). Выбор делается по "есть хотя бы один", а не "все" —
 * так было и раньше, когда это условие просто блокировало печать совсем.
 */
const BRICK_PRODUCT_TYPE_NAME = 'Кирпич';

function isBrickProductType(name?: string): boolean {
    return (name || '').trim().toLowerCase() === BRICK_PRODUCT_TYPE_NAME.toLowerCase();
}

// ───────────────────────── форматирование чисел ─────────────────────────

function formatMoney(n: number | null | undefined): string {
    if (n === null || n === undefined || !isFinite(n)) return '';
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatPercent(n: number | null | undefined): string {
    if (n === null || n === undefined || !isFinite(n)) return '';
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function parseDecimal(raw: string): number {
    const cleaned = raw.replace(/\s/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
}

// ───────────────────────── вкладка «Материалы» ─────────────────────────

function MaterialsTab({ project, canEdit, directories, trustDeeds = [], accessToken, onConnectCalendar }: { project: Project, canEdit: boolean, directories: any, trustDeeds?: TrustDeed[], accessToken?: string | null, onConnectCalendar?: () => Promise<boolean> }) {
    const [isAdding, setIsAdding] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<ProjectMaterial>>({});
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const materials = project.materials || [];
    const selected = materials.find(m => m.id === selectedId) || null;

    // Название валюты КП материала — только если это НЕ рубль (режим "КП в валюте"
    // включён); для рублёвых материалов пусто, чтобы валютные записи было видно сразу.
    const currencyNameOf = (m: ProjectMaterial): string =>
        m.kpInCurrency ? ((directories.currencies || []).find((c: any) => c.id === m.currencyId)?.name || '') : '';
    const totals = calcProjectMaterialsTotals(materials);

    useEffect(() => {
        setSelectedId(prev => {
            if (materials.length === 0) return null;
            if (prev && materials.some(m => m.id === prev)) return prev;
            return materials[0].id;
        });
    }, [materials.length]);

    const handleAdd = () => {
        if (!canEdit) return;
        setFormData(createEmptyProjectMaterial());
        setIsEditing(false);
        setIsAdding(true);
    };

    const handleEdit = (m: ProjectMaterial) => {
        setFormData(m);
        setIsEditing(true);
        setIsAdding(true);
    };

    const handleSave = async () => {
        if (!canEdit) return;
        try {
            const newMaterial = {
                ...createEmptyProjectMaterial(),
                ...formData,
                id: (isEditing && formData.id) ? formData.id : crypto.randomUUID(),
            } as ProjectMaterial;

            let updated;
            if (isEditing && formData.id) {
                updated = materials.map(m => m.id === formData.id ? newMaterial : m);
            } else {
                updated = [...materials, newMaterial];
            }

            // Сумма контракта пересчитывается автоматически от состава/стоимости материалов
            // при каждом изменении — перезаписывает то, что могло быть введено вручную
            // во вкладке «Финансы» (возможность редактировать там сумму вручную остаётся,
            // просто следующее изменение материалов снова её пересчитает).
            const newTotals = calcProjectMaterialsTotals(updated);
            // Плановые расходы (закуп/транспорт/дизайнер/ГП на каждый материал + общий
            // налог по проекту) пересобираются заново из свежего состава материалов —
            // id детерминированные, поэтому уже существующие ссылки фактических расходов
            // на плановые (plannedExpenseId) не рвутся, просто суммы обновляются на месте.
            const newExpenses = syncPlannedExpensesForMaterials(project.finance?.expenses || [], updated);
            await updateDoc(doc(db, 'projects', project.id), {
                materials: updated,
                'finance.contractSum': newTotals.saleSum,
                'finance.expenses': newExpenses,
                updatedAt: serverTimestamp(),
            });
            setIsAdding(false);
            setFormData({});
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const handleDelete = async (id: string) => {
        if (!canEdit) return;

        const material = materials.find(m => m.id === id);
        if (!material) return;

        // Доверенности, ссылающиеся на этот материал (по ID справочника или по названию,
        // на случай если materialId не заполнен, например у совсем старых записей).
        const relatedDeeds = trustDeeds.filter(d =>
            (material.materialId && d.materialId === material.materialId) ||
            d.materialName === material.materialName
        );
        const hasTrustDeed = relatedDeeds.length > 0;

        // Отгрузки, ссылающиеся на любую из найденных доверенностей.
        const relatedDeedIds = new Set(relatedDeeds.map(d => d.id));
        const relatedDeedNumbers = new Set(relatedDeeds.map(d => d.number));
        const hasShipment = (project.shipments || []).some(s =>
            relatedDeedIds.has((s as any).trustDeedId) || relatedDeedNumbers.has(s.poaNumber)
        );

        if (hasTrustDeed && hasShipment) {
            alert('Материал нельзя удалить: по нему уже оформлена доверенность и зафиксирована отгрузка. Сначала удалите отгрузку и доверенность, если материал больше не нужен в проекте.');
            return;
        }
        if (hasTrustDeed) {
            alert('Материал нельзя удалить: по нему уже оформлена доверенность. Сначала удалите или измените доверенность, чтобы она не ссылалась на этот материал.');
            return;
        }

        // Фактические расходы (не плановые — плановые созданы автоматически и удалятся
        // вместе с материалом без вопросов) — если хоть один есть, блокируем удаление
        // точно так же, как с доверенностями.
        const materialIdsWithActualExpenses = getMaterialIdsWithActualExpenses(project.finance?.expenses || []);
        if (materialIdsWithActualExpenses.has(material.id)) {
            alert('Материал нельзя удалить: по нему уже есть фактические расходы. Сначала удалите или переназначьте эти расходы на другой материал.');
            return;
        }

        // Ни доверенности, ни фактических расходов нет — по договорённости удаляем
        // молча, без диалога подтверждения (у материала есть только плановые расходы,
        // они уйдут вместе с ним автоматически).
        try {
            const updated = materials.filter(m => m.id !== id);
            const newTotals = calcProjectMaterialsTotals(updated);
            const newExpenses = syncPlannedExpensesForMaterials(project.finance?.expenses || [], updated);
            await updateDoc(doc(db, 'projects', project.id), {
                materials: updated,
                'finance.contractSum': newTotals.saleSum,
                'finance.expenses': newExpenses,
                updatedAt: serverTimestamp(),
            });
            if (selectedId === id) setSelectedId(null);
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}/materials/${id}`);
        }
    };

    const [isKPModalOpen, setIsKPModalOpen] = useState(false);
    const [isGeneratingKP, setIsGeneratingKP] = useState(false);
    const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);

    const handleConnectGoogle = async () => {
        if (!onConnectCalendar || isConnectingGoogle) return;
        setIsConnectingGoogle(true);
        try {
            await onConnectCalendar();
        } finally {
            setIsConnectingGoogle(false);
        }
    };

    /**
     * Формирует КП из отмеченных пользователем материалов — шаблон выбирается
     * автоматически: кирпичный (template_kp.docx), если среди отмеченных позиций
     * есть хотя бы один материал с видом товара "Кирпич", иначе универсальный
     * (template_kp_other.docx). Колонка с фото в самом шаблоне тоже решается
     * автоматически — внутри generateKPDocx.ts, по наличию/отсутствию фото у
     * отмеченных материалов.
     *
     * Дальше: гарантирует наличие папки документов проекта и подпапки "Коммерческие
     * предложения" внутри неё (создаёт при необходимости, переиспользует дальше),
     * генерирует docx и кладёт его туда. Каждый вызов создаёт НОВЫЙ файл — единственного
     * "того самого" КП на проект больше нет, история формирований просто копится в папке.
     */
    const handleGenerateKP = async (selected: ProjectMaterial[]) => {
        if (!accessToken || selected.length === 0) return;

        // ── Валюта КП: один КП — одна валюта. Если у ВСЕХ отмеченных материалов включён
        // "КП в валюте" и валюта одна и та же — печатаем в валюте (цены/суммы берутся из
        // валютных полей, в шапке — название валюты, плюс фраза про курс). Если тумблер
        // не включён ни у одного — обычный рублёвый КП, как раньше. Любая смесь (часть
        // в валюте, часть в рублях; или разные валюты) — не печатаем, просим разделить. ──
        let kpCurrencyName: string | undefined;
        const currencyModeCount = selected.filter(m => m.kpInCurrency).length;
        if (currencyModeCount > 0) {
            if (currencyModeCount !== selected.length) {
                alert('В одном КП нельзя смешивать материалы «в валюте» и «в рублях». Отметьте либо только материалы с включённым «КП в валюте» (с одной валютой), либо только рублёвые.');
                return;
            }
            const currencyIds = Array.from(new Set(selected.map(m => m.currencyId || '')));
            if (currencyIds.length > 1) {
                alert('В одном КП должна быть одна валюта, а у отмеченных материалов валюты разные. Отметьте материалы с одной валютой.');
                return;
            }
            const currency = (directories.currencies || []).find((c: any) => c.id === currencyIds[0]);
            if (!currency) {
                alert('Не удалось определить валюту КП — проверьте, что в материалах выбрана валюта и она есть в справочнике «Валюты».');
                return;
            }
            const incomplete = selected.filter(m => !m.salePriceCurrency || !calcMaterialCurrency(m).saleSumCurrency);
            if (incomplete.length > 0) {
                alert(`Не заполнены цена и сумма в валюте у материалов: ${incomplete.map(m => m.materialName).join(', ')}. Откройте материал и заполните их.`);
                return;
            }
            kpCurrencyName = currency.name;
        }

        const hasBrickSelected = selected.some(m => {
            const dir = (directories.materials || []).find((dm: any) => dm.id === m.materialId);
            const productTypeName = (directories.productTypes || []).find((pt: any) => pt.id === dir?.productTypeId)?.name;
            return isBrickProductType(productTypeName);
        });
        const templateType: KPTemplateType = hasBrickSelected ? 'brick' : 'other';

        setIsGeneratingKP(true);
        try {
            let docsFolder = { id: project.driveDocsFolderId || '', link: project.driveDocsFolderLink || '' };
            if (!docsFolder.id) {
                docsFolder = await ensureProjectDocsFolder(project, accessToken);
                await updateDoc(doc(db, 'projects', project.id), {
                    driveDocsFolderId: docsFolder.id,
                    driveDocsFolderLink: docsFolder.link,
                    updatedAt: serverTimestamp(),
                }).catch(console.error);
            }

            let kpFolder = { id: project.kpFolderId || '', link: project.kpFolderLink || '' };
            if (!kpFolder.id) {
                kpFolder = await findOrCreateSubfolder(docsFolder.id, KP_SUBFOLDER_NAME, accessToken);
                await updateDoc(doc(db, 'projects', project.id), {
                    kpFolderId: kpFolder.id,
                    kpFolderLink: kpFolder.link,
                    updatedAt: serverTimestamp(),
                }).catch(console.error);
            }

            const sellerCompany = (directories.companies || []).find((c: any) => c.id === (project as any).sellerLegalEntityId);

            const kpMaterials = selected.map(m => {
                const dir = (directories.materials || []).find((dm: any) => dm.id === m.materialId);
                const manufacturerName = (directories.companies || []).find((c: any) => c.id === dir?.manufacturerId)?.name;
                const calc = calcMaterial(m);
                return {
                    materialName: m.materialName,
                    characteristics: dir?.characteristics || '',
                    manufacturerName: manufacturerName || '',
                    unit: m.unitName || '',
                    qtyPerM2: dir?.qtyPerM2,
                    qtyPerPallet: dir?.qtyPerPallet,
                    photoDriveFileId: dir?.photoDriveFileId,
                    price: kpCurrencyName ? (m.salePriceCurrency as number) : m.salePrice,
                    quantityM2: m.quantityM2,
                    quantity: m.quantity,
                    sum: kpCurrencyName ? (calcMaterialCurrency(m).saleSumCurrency as number) : calc.saleSum,
                    saleVatPercent: m.saleVatPercent,
                };
            });

            const blob = await generateKPDocx({
                templateType,
                currencyName: kpCurrencyName,
                clientName: project.client,
                projectName: project.name,
                sellerLegalEntity: (project as any).sellerLegalEntityName || '',
                sellerLegalEntityAddress: sellerCompany?.address || '',
                managerName: project.leadManagerName || '',
                materials: kpMaterials,
                accessToken,
            });

            const filename = buildKPFileName(project.name, project.client, templateType);
            const { link } = await uploadFileToDrive(blob, filename, kpFolder.id, accessToken);
            window.open(link, '_blank');
            setIsKPModalOpen(false);
        } catch (error) {
            console.error('Не удалось сформировать КП:', error);
            alert('Не удалось сформировать коммерческое предложение. Попробуйте ещё раз.');
        } finally {
            setIsGeneratingKP(false);
        }
    };

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {!accessToken && onConnectCalendar && (
                <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-[12px] text-ink-3 leading-snug">
                        Чтобы формировать коммерческие предложения, подключите Google.
                    </p>
                    <button
                        type="button"
                        onClick={handleConnectGoogle}
                        disabled={isConnectingGoogle}
                        className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                        {isConnectingGoogle ? 'Подключение…' : 'Подключить Google'}
                    </button>
                </div>
            )}

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setIsKPModalOpen(true)}
                    disabled={!accessToken || materials.length === 0}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12.5px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <FileText size={13} /> Сформировать КП
                </button>
                {project.kpFolderLink ? (
                    <a
                        href={project.kpFolderLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12.5px] font-semibold border border-line bg-surface hover:bg-surface-2 transition-colors"
                    >
                        <ExternalLink size={13} /> Открыть КП
                    </a>
                ) : (
                    <span
                        title="КП ещё не формировались"
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[12.5px] font-semibold border border-line bg-surface text-ink-4 opacity-50 cursor-not-allowed"
                    >
                        <ExternalLink size={13} /> Открыть КП
                    </span>
                )}
            </div>

            {materials.length > 0 ? (
                <div className="flex flex-col lg:grid lg:grid-cols-5 gap-4 items-start">
                    {/* Таблица — 3/5 */}
                    <div className="lg:col-span-3 min-w-0 self-start rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3 shrink-0">
                            <h3 className="text-[14px] font-serif font-medium flex items-center gap-2 text-ink">
                                Материалы по проекту
                                <span className="text-[11px] font-serif opacity-40">· {materials.length}</span>
                            </h3>
                            {canEdit && (
                                <Button
                                    variant="ochre"
                                    size="sm"
                                    className="h-8 px-2.5 text-[11.5px] font-semibold"
                                    icon={<Plus size={12} />}
                                    onClick={handleAdd}
                                >
                                    Добавить материал
                                </Button>
                            )}
                        </div>
                        <div className="overflow-x-auto custom-scrollbar p-4 pt-2">
                            <table className="w-full text-left">
                                <thead>
                                <tr className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] border-b border-[#E1D8C5]">
                                    <th className="px-4 py-3 font-bold">Материал / поставщик</th>
                                    <th className="px-4 py-3 font-bold">Валюта</th>
                                    <th className="px-4 py-3 font-bold">Кол-во</th>
                                    <th className="px-4 py-3 font-bold">Цена прод.</th>
                                    <th className="px-4 py-3 font-bold">Сумма прод.</th>
                                    <th className="px-4 py-3 font-bold text-right">Налог к уплате</th>
                                    <th className="px-4 py-3 font-bold text-right" title="Остаток от продажи после закупа, услуг и налогов">Чистая прибыль</th>
                                </tr>
                                </thead>
                                <tbody>
                                {materials.map((m) => {
                                    const calc = calcMaterial(m);
                                    const isSelected = m.id === selectedId;
                                    const marginColor = calc.marginIncVatPercent !== null ? getMarginColor(calc.marginIncVatPercent) : undefined;
                                    return (
                                        <tr
                                            key={m.id}
                                            onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
                                            className={cn(
                                                "cursor-pointer transition-colors border-b border-[#E1D8C5]/60 last:border-b-0",
                                                isSelected ? "bg-[#F5E9CC] shadow-[inset_3px_0_0_0_#B07A2C]" : "hover:bg-[#F5F2E9]/80"
                                            )}
                                        >
                                            <td className="px-4 py-3.5">
                                                <p className="text-[13px] font-bold text-ink truncate max-w-[220px]">{m.materialName || '—'}</p>
                                                <p className="text-[11px] text-ink-3 truncate max-w-[220px]">{m.supplierName || '—'}</p>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                {currencyNameOf(m) && (
                                                    <span className="inline-flex px-1.5 py-0.5 rounded-md bg-ochre-bg text-ochre text-[10.5px] font-semibold whitespace-nowrap">{currencyNameOf(m)}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className="text-[12px] font-mono text-ink whitespace-nowrap">{formatMoney(m.quantity)} {m.unitName}</span>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className="text-[12px] font-mono text-ink">{formatMoney(m.salePrice)}</span>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span className="text-[12px] font-mono text-ink">{formatMoney(calc.saleSum)}</span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <span className="text-[12px] font-mono text-ink">{formatMoney(calc.vatPayable)}</span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <div className="text-[13px] font-mono font-bold" style={{ color: marginColor }}>{formatMoney(calc.marginIncVat)}</div>
                                                <div className="text-[11px] font-mono" style={{ color: marginColor }}>{calc.marginIncVatPercent !== null ? `${formatPercent(calc.marginIncVatPercent)}%` : '—'}</div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                </tbody>
                                <tfoot>
                                <tr className="border-t-2 border-[#DAD3C1] bg-surface-2">
                                    <td className="px-4 py-3.5">
                                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">Итого по проекту</span>
                                    </td>
                                    <td className="px-4 py-3.5" />
                                    <td className="px-4 py-3.5" />
                                    <td className="px-4 py-3.5">
                                        <p className="text-[10px] uppercase tracking-wide text-ink-4">закуп</p>
                                        <p className="text-[12px] font-mono font-bold text-ink">{formatMoney(totals.purchaseSum)}</p>
                                    </td>
                                    <td className="px-4 py-3.5">
                                        <p className="text-[10px] uppercase tracking-wide text-ink-4">продажа</p>
                                        <p className="text-[12px] font-mono font-bold text-ink">{formatMoney(totals.saleSum)}</p>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <p className="text-[10px] uppercase tracking-wide text-ink-4">налог</p>
                                        <p className="text-[12px] font-mono font-bold text-ink">{formatMoney(totals.vatPayable)}</p>
                                    </td>
                                    <td className="px-4 py-3.5 text-right">
                                        <div className="text-[11px] font-mono" style={{ color: totals.marginIncVatPercent !== null ? getMarginColor(totals.marginIncVatPercent) : undefined }}>{totals.marginIncVatPercent !== null ? `${formatPercent(totals.marginIncVatPercent)}%` : '—'}</div>
                                        <div className="text-[13px] font-mono font-bold" style={{ color: totals.marginIncVatPercent !== null ? getMarginColor(totals.marginIncVatPercent) : undefined }}>{formatMoney(totals.marginIncVat)}</div>
                                    </td>
                                </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Деталка — 2/5 */}
                    {selected ? (
                        <MaterialDetailPanel
                            material={selected}
                            canEdit={canEdit}
                            onEdit={() => handleEdit(selected)}
                            onDelete={() => handleDelete(selected.id)}
                            onClose={() => setSelectedId(null)}
                        />
                    ) : (
                        <div className="lg:col-span-2 w-full self-start rounded-2xl border border-dashed border-line bg-transparent p-8 flex flex-col items-center justify-center gap-2 text-center">
                            <ChevronRight size={18} className="text-ink-4 opacity-40" />
                            <p className="text-[12px] font-medium text-ink-3">Выберите материал</p>
                            <p className="text-[10px] text-ink-4">для просмотра подробностей</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="rounded-2xl border transition-colors bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line/50 px-4 py-3">
                        <h3 className="text-[14px] font-serif font-medium flex items-center gap-2 text-ink">
                            Материалы по проекту <span className="text-[11px] font-serif opacity-40">· 0</span>
                        </h3>
                    </div>
                    <div className="py-7 px-5 m-4 border border-dashed rounded-2xl flex flex-col items-center justify-center gap-3.5 border-line bg-transparent">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center bg-white border border-line text-ink-3 shadow-sm">
                            <Layers size={16} />
                        </div>
                        <div className="text-center space-y-0.5">
                            <p className="text-[13px] font-serif font-medium text-ink">Материалы ещё не добавлены</p>
                            <p className="text-[9.5px] uppercase font-semibold tracking-[0.08em] opacity-60 text-ink-4">Здесь формируется смета проекта</p>
                        </div>
                        {canEdit && (
                            <Button variant="ochre" size="sm" className="mt-2 px-3 h-8 text-[11.5px] font-semibold" icon={<Plus size={12} />} onClick={handleAdd}>
                                Добавить материал
                            </Button>
                        )}
                    </div>
                </div>
            )}

            <AnimatePresence>
                {isAdding && (
                    <MaterialModal
                        formData={formData}
                        setFormData={setFormData}
                        onClose={() => { setIsAdding(false); setFormData({}); }}
                        onSave={handleSave}
                        directories={directories}
                        isEditing={isEditing}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isKPModalOpen && (
                    <KPMaterialsSelectionModal
                        materials={materials}
                        directories={directories}
                        isGenerating={isGeneratingKP}
                        onClose={() => !isGeneratingKP && setIsKPModalOpen(false)}
                        onConfirm={handleGenerateKP}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ───────────────────────── правая панель с деталями ─────────────────────────

function DetailRow({ label, value, sub, valueColor, tooltip }: { label: string; value: React.ReactNode; sub?: React.ReactNode; valueColor?: string; tooltip?: string }) {
    return (
        <div className="flex items-start justify-between gap-3 py-2 border-b border-dashed border-[#E5E0D6] last:border-b-0">
            <span className="text-[12px] text-ink-3 shrink-0" title={tooltip}>{label}</span>
            <div className="text-right min-w-0">
                <div className="text-[13px] font-semibold tabular-nums" style={{ color: valueColor }}>{value}</div>
                {sub && <div className="text-[10.5px] text-ink-3 mt-0.5 tabular-nums">{sub}</div>}
            </div>
        </div>
    );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-1.5">{title}</h5>
            <div>{children}</div>
        </div>
    );
}

function MaterialDetailPanel({ material, canEdit, onEdit, onDelete, onClose }: {
    material: ProjectMaterial;
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const calc = calcMaterial(material);
    const marginColor = calc.marginIncVatPercent !== null ? getMarginColor(calc.marginIncVatPercent) : undefined;

    return (
        <div className="lg:col-span-2 w-full self-start rounded-2xl border border-line bg-surface shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden flex flex-col max-h-[75vh]">
            <div className="shrink-0 px-4 pt-3.5 pb-3 border-b border-[#E8E4DC] bg-[#FCF9F2]">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#8A8574] mb-0.5">Материал</p>
                        <h4 className="font-serif text-[18px] font-normal text-[#2C2922] leading-[1.15] truncate">{material.materialName || '—'}</h4>
                        <p className="text-[11.5px] text-ink-3 mt-0.5 truncate">{formatMoney(material.quantity)} {material.unitName} · {material.supplierName || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        {canEdit && (
                            <>
                                <button onClick={onEdit} title="Редактировать" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><Pencil size={13} /></button>
                                <button onClick={onDelete} title="Удалить" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#A04930] hover:bg-[#F5E6E2] transition-colors"><Trash2 size={13} /></button>
                            </>
                        )}
                        <button onClick={onClose} title="Свернуть" className="w-8 h-8 rounded-full border border-[#E5E0D6] bg-white flex items-center justify-center text-[#8A8574] hover:text-[#2C2922] transition-colors"><X size={13} /></button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 space-y-4 bg-[#FCF9F2]">
                <DetailSection title="Закуп">
                    <DetailRow label="Цена закупа с НДС" value={`${formatMoney(material.purchasePrice)} ₽`} />
                    <DetailRow
                        label="Сумма закупа с НДС"
                        value={`${formatMoney(calc.purchaseSum)} ₽`}
                        sub={`НДС ${material.purchaseVatPercent}% ${formatMoney(calc.purchaseVatAmount)}`}
                    />
                </DetailSection>

                <DetailSection title="Продажа">
                    <DetailRow label="% накрутки" value={calc.markupPercent !== null ? `${formatPercent(calc.markupPercent)}%` : '—'} />
                    <DetailRow label="Цена продажи с НДС" value={`${formatMoney(material.salePrice)} ₽`} />
                    <DetailRow
                        label="Сумма продажи с НДС"
                        value={`${formatMoney(calc.saleSum)} ₽`}
                        sub={`НДС ${material.saleVatPercent}% ${formatMoney(calc.saleVatAmount)}`}
                        valueColor="var(--ochre)"
                    />
                </DetailSection>

                <DetailSection title="Услуги в том числе">
                    <DetailRow
                        label={`Дизайнеру · ${material.designerPercent}%`}
                        value={`${formatMoney(calc.designerSum)} ₽`}
                        sub={`НДС ${material.designerVatPercent}% ${formatMoney(calc.designerVatAmount)}`}
                    />
                    <DetailRow
                        label={`ГП · ${material.gcPercent}%`}
                        value={`${formatMoney(calc.gcSum)} ₽`}
                        sub={`НДС ${material.gcVatPercent}% ${formatMoney(calc.gcVatAmount)}`}
                    />
                    <DetailRow
                        label="Транспорт до ТК с НДС"
                        value={`${formatMoney(material.transportAmount)} ₽`}
                        sub={`НДС ${material.transportVatPercent}% ${formatMoney(calc.transportVatAmount)}`}
                    />
                </DetailSection>

                <div className="rounded-xl border border-[var(--ochre-soft)] bg-[var(--ochre-bg)] p-3.5 space-y-1">
                    <DetailRow label="Маржа с НДС" value={`${formatMoney(calc.marginExVat)} ₽`} tooltip="Остаток от продажи после закупа и услуг" />
                    <DetailRow label="Маржа с НДС, %" value={calc.marginExVatPercent !== null ? `${formatPercent(calc.marginExVatPercent)}%` : '—'} tooltip="Остаток от продажи после закупа и услуг" />
                    <DetailRow label="НДС к уплате" value={`${formatMoney(calc.vatPayable)} ₽`} />
                    <DetailRow label="Чистая прибыль" value={`${formatMoney(calc.marginIncVat)} ₽`} valueColor={marginColor} tooltip="Остаток от продажи после закупа, услуг и налогов" />
                    <DetailRow label="Рентабельность, %" value={calc.marginIncVatPercent !== null ? `${formatPercent(calc.marginIncVatPercent)}%` : '—'} valueColor={marginColor} />
                </div>
            </div>
        </div>
    );
}

// ───────────────────────── поля ввода (для модалки) ─────────────────────────

/** Простое денежное/числовое поле: локальный буфер строки, коммит по blur. */
function AmountInput({ value, onCommit, placeholder = '0', className }: {
    value: number;
    onCommit: (n: number) => void;
    placeholder?: string;
    className?: string;
}) {
    const [text, setText] = useState(value ? formatMoney(value) : '');

    useEffect(() => {
        setText(value ? formatMoney(value) : '');
    }, [value]);

    const commit = () => {
        const n = parseDecimal(text);
        onCommit(n);
        setText(n ? formatMoney(n) : '');
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            value={text}
            placeholder={placeholder}
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commit(); }}
            className={className}
        />
    );
}

/** Поле ставки НДС (просто число, без сложной логики, по умолчанию 22). */
function VatPercentInput({ value, onCommit, className }: { value: number; onCommit: (n: number) => void; className?: string }) {
    const [text, setText] = useState(String(value ?? DEFAULT_VAT_PERCENT));
    useEffect(() => { setText(String(value ?? DEFAULT_VAT_PERCENT)); }, [value]);
    const commit = () => {
        const n = parseDecimal(text);
        onCommit(n);
        setText(String(n));
    };
    return (
        <input
            type="text"
            inputMode="decimal"
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commit(); }}
            className={className}
        />
    );
}

// ───────────────────────── модалка добавления/редактирования ─────────────────────────

function MaterialModal({ formData, setFormData, onClose, onSave, directories, isEditing }: {
    formData: Partial<ProjectMaterial>;
    setFormData: (data: Partial<ProjectMaterial>) => void;
    onClose: () => void;
    onSave: () => void;
    directories: any;
    isEditing: boolean;
}) {
    const inputClass = "w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4";
    const readonlyClass = "w-full bg-surface-2 border border-line rounded-md px-3 h-9 text-[13px] text-ink-3 flex items-center tabular-nums";
    const labelClass = "block text-[8.5px] font-semibold uppercase tracking-[0.16em] text-[#8A8574] mb-1.5";
    const sectionLabel = "text-[10px] font-bold uppercase tracking-[0.16em] text-[#A67C3C] border-b border-[#A67C3C]/10 pb-1.5 mb-3";

    const m = { ...createEmptyProjectMaterial(), ...formData } as ProjectMaterial;
    const calc = calcMaterial(m);

    // ── КП в валюте: информационные поля только для печатной формы КП (смета и все
    // расчёты остаются в рублях). Валюта выбирается строго из справочника currencies. ──
    const currencyCalc = calcMaterialCurrency(m);
    const currencies: { id: string; name: string }[] = directories.currencies || [];
    const selectedCurrencyName = currencies.find(c => c.id === m.currencyId)?.name || '';

    // Авто-цена продажи в валюте. Подставляется ТОЛЬКО если режим включён и выполнены оба
    // условия: цена закупа в валюте заполнена И % накрутки определён. Иначе пустой патч —
    // поле не трогаем (его вводят вручную). Если пользователь правил цену продажи в валюте
    // руками, а потом снова меняет одно из исходных полей (цену закупа в валюте, рублёвые
    // цены, накрутку) — цена пересчитается заново от них. Сама ручная правка % накрутки
    // не меняет.
    const salePriceCurrencyPatch = (purchasePriceCurrency: number | undefined, markupPercent: number | null): Partial<ProjectMaterial> => {
        if (!m.kpInCurrency) return {};
        const auto = autoSalePriceCurrency(purchasePriceCurrency, markupPercent);
        return auto !== null ? { salePriceCurrency: auto } : {};
    };

    const set = (patch: Partial<ProjectMaterial>) => setFormData({ ...formData, ...patch });

    // ── Вид товара выбранного материала (из справочника) — определяет, нужна ли особая
    // раскладка формы (кирпич: поставщик отдельной строкой + расчёт по м²/поддонам).
    // Название вида товара берём ЖИВЬЁМ из справочника product_types по ID — а не из
    // когда-то сохранённой копии в самом материале (её там больше нет вообще). ──
    const selectedMaterialDir = (directories.materials || []).find((dm: any) => dm.id === m.materialId);
    const selectedProductTypeName = (directories.productTypes || []).find((pt: any) => pt.id === selectedMaterialDir?.productTypeId)?.name;
    const isBrick = isBrickProductType(selectedProductTypeName);
    const qtyPerM2 = Number(selectedMaterialDir?.qtyPerM2) || 0;
    const qtyPerPallet = Number(selectedMaterialDir?.qtyPerPallet) || 0;
    const hasM2Ratio = qtyPerM2 > 0;
    const hasPalletRatio = qtyPerPallet > 0;

    // Для кирпича единица измерения всегда "шт" (в наименованиях полей уже написано, что
    // считаем в м²/шт/поддонах) — скрываем поле и проставляем значение автоматически.
    useEffect(() => {
        if (isBrick && m.unitName !== 'шт') {
            set({ unitName: 'шт' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBrick]);

    // ── Связка "кол-во м² ↔ кол-во шт" для кирпича — тот же принцип, что и % накрутки
    // ↔ цена продажи: локальные буферы, пересчёт только по blur/Enter/Tab. ──
    const [m2Text, setM2Text] = useState(m.quantityM2 ? String(m.quantityM2) : '');
    const [pcsText, setPcsText] = useState(m.quantityPcsRaw ? String(m.quantityPcsRaw) : '');

    useEffect(() => {
        setM2Text(m.quantityM2 ? String(m.quantityM2) : '');
        setPcsText(m.quantityPcsRaw ? String(m.quantityPcsRaw) : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m.materialId]);

    /**
     * Пересчитывает м²/поддоны/итоговое quantity от введённого количества штук —
     * единым патчем (не несколькими последовательными set()), иначе второй set()
     * перезаписал бы результат первого, читая ту же устаревшую formData.
     */
    const applyPcsCalculation = (pcsRaw: number) => {
        const patch: Partial<ProjectMaterial> = { quantityPcsRaw: pcsRaw };
        if (hasM2Ratio) {
            const m2 = Math.round((pcsRaw / qtyPerM2) * 10) / 10; // округление до 1 знака
            setM2Text(m2 ? String(m2) : '');
            patch.quantityM2 = m2;
        }
        if (hasPalletRatio) {
            const pallets = pcsRaw > 0 ? Math.ceil(pcsRaw / qtyPerPallet) : 0;
            const roundedPcs = pallets * qtyPerPallet;
            patch.quantityPallets = pallets || undefined;
            patch.quantity = roundedPcs;
        } else {
            // Нет данных о шт-в-поддоне в справочнике — автоматический расчёт по поддонам
            // не делаем, итоговое количество просто равно введённому "сырому" кол-ву шт.
            patch.quantityPallets = undefined;
            patch.quantity = pcsRaw;
        }
        set(patch);
    };

    const commitPcs = () => {
        const pcs = Math.round(parseDecimal(pcsText));
        setPcsText(pcs ? String(pcs) : '');
        applyPcsCalculation(pcs);
    };

    const commitM2 = () => {
        if (!hasM2Ratio) return;
        const m2 = Math.round(parseDecimal(m2Text) * 10) / 10;
        setM2Text(m2 ? String(m2) : '');
        const pcs = Math.round(m2 * qtyPerM2);
        setPcsText(pcs ? String(pcs) : '');
        applyPcsCalculation(pcs);
    };

    // ── Связка "% накрутки ↔ цена продажи с НДС" — локальные буферы, пересчёт только по blur/Enter/Tab ──
    const [markupText, setMarkupText] = useState(calc.markupPercent !== null ? formatPercent(calc.markupPercent) : '');
    const [salePriceText, setSalePriceText] = useState(m.salePrice ? formatMoney(m.salePrice) : '');

    useEffect(() => {
        setMarkupText(calc.markupPercent !== null ? formatPercent(calc.markupPercent) : '');
        setSalePriceText(m.salePrice ? formatMoney(m.salePrice) : '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [m.purchasePrice, m.salePrice]);

    const commitMarkup = () => {
        const pct = parseDecimal(markupText);
        const newSalePrice = priceFromMarkup(m.purchasePrice || 0, pct);
        // Пустое поле накрутки не считаем "заполненным" (иначе пустое поле давало бы 0%).
        const markupFilled = markupText.trim() !== '';
        set({ salePrice: newSalePrice, ...salePriceCurrencyPatch(m.purchasePriceCurrency, markupFilled ? pct : null) });
        setSalePriceText(formatMoney(newSalePrice));
        setMarkupText(formatPercent(pct));
    };

    const commitSalePrice = () => {
        const price = parseDecimal(salePriceText);
        const pct = getMarkupPercent(m.purchasePrice || 0, price);
        set({ salePrice: price, ...salePriceCurrencyPatch(m.purchasePriceCurrency, pct) });
        setMarkupText(pct !== null ? formatPercent(pct) : '');
        setSalePriceText(price ? formatMoney(price) : '');
    };

    const handlePurchasePriceCommit = (newPrice: number) => {
        // % накрутки — производное значение, просто пересчитаем отображение
        const pct = getMarkupPercent(newPrice, m.salePrice || 0);
        set({ purchasePrice: newPrice, ...salePriceCurrencyPatch(m.purchasePriceCurrency, pct) });
        setMarkupText(pct !== null ? formatPercent(pct) : '');
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-3xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[90vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">
                            {isEditing ? 'Редактировать материал' : 'Добавить материал'}
                        </h2>
                        <p className="text-[11px] text-ink-3 mt-0.5">Серые поля рассчитываются автоматически. НДС по умолчанию 22%.</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {/* ТОВАР */}
                    <div>
                        <h3 className={sectionLabel}>Товар</h3>
                        <div className="space-y-3">
                            <div>
                                <label className={labelClass}>Наименование</label>
                                <MaterialSelect
                                    value={m.materialName || ''}
                                    materialId={m.materialId}
                                    onChange={(name, id) => set({ materialName: name, materialId: id })}
                                    placeholder="Из справочника..."
                                />
                            </div>
                            {isBrick ? (
                                <>
                                    {/* Кирпич: поставщик отдельной строкой под наименованием */}
                                    <div>
                                        <label className={labelClass}>Поставщик</label>
                                        <CompanySelect
                                            value={m.supplierName || ''}
                                            onChange={(name, id) => set({ supplierName: name, supplierId: id })}
                                            placeholder="Компания-поставщик..."
                                            companyType="Поставщик"
                                        />
                                    </div>
                                    {/* Кирпич: 4 количественных поля вместо простого "Кол-во" */}
                                    <div className="grid grid-cols-4 gap-3">
                                        <div>
                                            <label className={labelClass}>Кол-во, м²</label>
                                            {hasM2Ratio ? (
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={m2Text}
                                                    onChange={e => setM2Text(e.target.value)}
                                                    onBlur={commitM2}
                                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitM2(); }}
                                                    placeholder="0"
                                                    className={inputClass}
                                                />
                                            ) : (
                                                <div className={readonlyClass} title="Нет данных «шт в 1 м²» в справочнике материала">—</div>
                                            )}
                                        </div>
                                        <div>
                                            <label className={labelClass}>Кол-во, шт</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={pcsText}
                                                onChange={e => setPcsText(e.target.value)}
                                                onBlur={commitPcs}
                                                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitPcs(); }}
                                                placeholder="0"
                                                className={inputClass}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Кол-во поддонов</label>
                                            <div className={readonlyClass} title={!hasPalletRatio ? 'Нет данных «шт в поддоне» в справочнике материала' : undefined}>
                                                {hasPalletRatio ? (m.quantityPallets ?? '—') : '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <label className={labelClass}>Шт кратно поддону</label>
                                            <div className={readonlyClass} title={!hasPalletRatio ? 'Нет данных «шт в поддоне» — используется кол-во шт как есть' : undefined}>
                                                {hasPalletRatio ? formatMoney(m.quantity) : (m.quantity ? formatMoney(m.quantity) : '—')}
                                            </div>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="grid grid-cols-[100px_120px_1fr] gap-3">
                                    <div>
                                        <label className={labelClass}>Кол-во</label>
                                        <AmountInput value={m.quantity} onCommit={n => set({ quantity: n })} className={inputClass} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Ед. изм.</label>
                                        <DirectorySelect
                                            value={m.unitName || ''}
                                            options={directories.units || []}
                                            onChange={v => set({ unitName: v })}
                                            onAdd={async name => {
                                                await addDoc(collection(db, 'units'), { name, createdAt: serverTimestamp() });
                                                set({ unitName: name });
                                            }}
                                            placeholder="—"
                                            className={inputClass}
                                            iconType="unit"
                                            inputHeight="h-9"
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Поставщик</label>
                                        <CompanySelect
                                            value={m.supplierName || ''}
                                            onChange={(name, id) => set({ supplierName: name, supplierId: id })}
                                            placeholder="Компания-поставщик..."
                                            companyType="Поставщик"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* КП В ВАЛЮТЕ */}
                    <div className="flex flex-wrap items-center gap-4">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={!!m.kpInCurrency}
                            onClick={() => {
                                if (m.kpInCurrency) {
                                    set({ kpInCurrency: false });
                                    return;
                                }
                                // При включении — если цена продажи в валюте ещё пуста, а условия
                                // авто-расчёта уже выполнены, заполняем её сразу.
                                const auto = !m.salePriceCurrency ? autoSalePriceCurrency(m.purchasePriceCurrency, calc.markupPercent) : null;
                                set({ kpInCurrency: true, ...(auto !== null ? { salePriceCurrency: auto } : {}) });
                            }}
                            className="inline-flex items-center gap-2.5 select-none"
                        >
                            <span className={cn(
                                "relative inline-block w-9 h-5 rounded-full transition-colors shrink-0",
                                m.kpInCurrency ? "bg-ochre" : "bg-line"
                            )}>
                                <span className={cn(
                                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                                    m.kpInCurrency && "translate-x-4"
                                )} />
                            </span>
                            <span className="text-[12.5px] font-medium text-ink">КП в валюте</span>
                        </button>
                        {m.kpInCurrency && (
                            <div className="w-52">
                                <select
                                    value={m.currencyId || ''}
                                    onChange={e => set({ currencyId: e.target.value })}
                                    className={cn(inputClass, "appearance-none cursor-pointer")}
                                >
                                    <option value="">Выберите валюту...</option>
                                    {currencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* ЗАКУП / ПРОДАЖА */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl border border-line bg-surface-2/30">
                            <h3 className={sectionLabel}>Закуп</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelClass}>Цена с НДС, ₽</label>
                                    <AmountInput value={m.purchasePrice} onCommit={handlePurchasePriceCommit} className={inputClass} />
                                </div>
                                <div>
                                    <label className={labelClass}>Сумма с НДС, ₽</label>
                                    <div className={readonlyClass}>{formatMoney(calc.purchaseSum)}</div>
                                </div>
                            </div>
                            {m.kpInCurrency && (
                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    <div>
                                        <label className={labelClass}>Цена с НДС в валюте</label>
                                        <AmountInput
                                            value={m.purchasePriceCurrency || 0}
                                            onCommit={n => set({ purchasePriceCurrency: n, ...salePriceCurrencyPatch(n, calc.markupPercent) })}
                                            placeholder={selectedCurrencyName || '0'}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Сумма с НДС в валюте</label>
                                        <div className={readonlyClass}>
                                            {currencyCalc.purchaseSumCurrency !== null ? `${formatMoney(currencyCalc.purchaseSumCurrency)} ${selectedCurrencyName}`.trim() : ''}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-[1fr_70px_110px] gap-2 items-end mt-3">
                                <label className={cn(labelClass, "mb-0 self-center")}>НДС от закупа, ₽</label>
                                <VatPercentInput value={m.purchaseVatPercent} onCommit={n => set({ purchaseVatPercent: n })} className={inputClass} />
                                <div className={readonlyClass}>{formatMoney(calc.purchaseVatAmount)}</div>
                            </div>
                        </div>

                        <div className="p-4 rounded-xl border border-line bg-surface-2/30">
                            <h3 className={sectionLabel}>Продажа</h3>
                            <div className="grid grid-cols-[70px_1fr_1fr] gap-3">
                                <div>
                                    <label className={labelClass}>% накр.</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={markupText}
                                        onChange={e => setMarkupText(e.target.value)}
                                        onBlur={commitMarkup}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitMarkup(); }}
                                        className={inputClass}
                                        placeholder="—"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Цена с НДС, ₽</label>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={salePriceText}
                                        onChange={e => setSalePriceText(e.target.value)}
                                        onBlur={commitSalePrice}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitSalePrice(); }}
                                        className={inputClass}
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>Сумма с НДС, ₽</label>
                                    <div className={readonlyClass}>{formatMoney(calc.saleSum)}</div>
                                </div>
                            </div>
                            {m.kpInCurrency && (
                                <div className="grid grid-cols-2 gap-3 mt-3">
                                    <div>
                                        <label className={labelClass}>Цена с НДС в валюте</label>
                                        <AmountInput
                                            value={m.salePriceCurrency || 0}
                                            onCommit={n => set({ salePriceCurrency: n })}
                                            placeholder={selectedCurrencyName || '0'}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Сумма с НДС в валюте</label>
                                        <div className={readonlyClass}>
                                            {currencyCalc.saleSumCurrency !== null ? `${formatMoney(currencyCalc.saleSumCurrency)} ${selectedCurrencyName}`.trim() : ''}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-[1fr_70px_110px] gap-2 items-end mt-3">
                                <label className={cn(labelClass, "mb-0 self-center")}>НДС от продажи, ₽</label>
                                <VatPercentInput value={m.saleVatPercent} onCommit={n => set({ saleVatPercent: n })} className={inputClass} />
                                <div className={readonlyClass}>{formatMoney(calc.saleVatAmount)}</div>
                            </div>
                        </div>
                    </div>

                    {/* УСЛУГИ */}
                    <div>
                        <h3 className={sectionLabel}>Услуги в том числе</h3>
                        <div className="grid grid-cols-[1fr_90px_110px_70px_110px] gap-2 items-center text-[9px] font-semibold uppercase tracking-wide text-[#8A8574] mb-1.5">
                            <span />
                            <span className="text-right">%</span>
                            <span className="text-right">Сумма, ₽</span>
                            <span className="text-right">НДС, %</span>
                            <span className="text-right">НДС, ₽</span>
                        </div>

                        <div className="grid grid-cols-[1fr_90px_110px_70px_110px] gap-2 items-center py-1.5">
                            <span className="text-[12.5px] text-ink">% дизайнеру с НДС</span>
                            <AmountInput value={m.designerPercent} onCommit={n => set({ designerPercent: n })} className={inputClass} />
                            <div className={readonlyClass}>{formatMoney(calc.designerSum)}</div>
                            <VatPercentInput value={m.designerVatPercent} onCommit={n => set({ designerVatPercent: n })} className={inputClass} />
                            <div className={readonlyClass}>{formatMoney(calc.designerVatAmount)}</div>
                        </div>

                        <div className="grid grid-cols-[1fr_90px_110px_70px_110px] gap-2 items-center py-1.5">
                            <span className="text-[12.5px] text-ink">% ГП с НДС</span>
                            <AmountInput value={m.gcPercent} onCommit={n => set({ gcPercent: n })} className={inputClass} />
                            <div className={readonlyClass}>{formatMoney(calc.gcSum)}</div>
                            <VatPercentInput value={m.gcVatPercent} onCommit={n => set({ gcVatPercent: n })} className={inputClass} />
                            <div className={readonlyClass}>{formatMoney(calc.gcVatAmount)}</div>
                        </div>

                        <div className="grid grid-cols-[1fr_90px_110px_70px_110px] gap-2 items-center py-1.5">
                            <span className="text-[12.5px] text-ink">Транспорт до ТК с НДС</span>
                            <span />
                            <AmountInput value={m.transportAmount} onCommit={n => set({ transportAmount: n })} className={inputClass} />
                            <VatPercentInput value={m.transportVatPercent} onCommit={n => set({ transportVatPercent: n })} className={inputClass} />
                            <div className={readonlyClass}>{formatMoney(calc.transportVatAmount)}</div>
                        </div>
                    </div>

                    {/* ИТОГИ */}
                    <div className="rounded-xl border border-[var(--ochre-soft)] bg-[var(--ochre-bg)] p-4 grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#8A8574] mb-1" title="Остаток от продажи после закупа и услуг">Маржа с НДС, ₽</p>
                            <p className="text-[14px] font-bold text-ink tabular-nums">{formatMoney(calc.marginExVat)}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#8A8574] mb-1" title="Остаток от продажи после закупа и услуг">Маржа с НДС, %</p>
                            <p className="text-[14px] font-bold text-ink tabular-nums">{calc.marginExVatPercent !== null ? `${formatPercent(calc.marginExVatPercent)}%` : '—'}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#8A8574] mb-1">НДС к уплате, ₽</p>
                            <p className="text-[14px] font-bold text-ink tabular-nums">{formatMoney(calc.vatPayable)}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#8A8574] mb-1" title="Остаток от продажи после закупа, услуг и налогов">Чистая прибыль, ₽</p>
                            <p className="text-[14px] font-bold tabular-nums" style={{ color: calc.marginIncVatPercent !== null ? getMarginColor(calc.marginIncVatPercent) : undefined }}>{formatMoney(calc.marginIncVat)}</p>
                        </div>
                        <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#8A8574] mb-1">Рентабельность, %</p>
                            <p className="text-[14px] font-bold tabular-nums" style={{ color: calc.marginIncVatPercent !== null ? getMarginColor(calc.marginIncVatPercent) : undefined }}>{calc.marginIncVatPercent !== null ? `${formatPercent(calc.marginIncVatPercent)}%` : '—'}</p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 bg-surface-2/30">
                    <div />
                    <div className="flex gap-2 w-full sm:w-auto">
                        <button onClick={onClose} className="flex-1 sm:flex-none inline-flex items-center justify-center h-9 px-4 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                            Отмена
                        </button>
                        <button
                            onClick={() => {
                                if (isBrick && !m.quantity) {
                                    alert('Поле «Кол-во, шт» обязательно для заполнения.');
                                    return;
                                }
                                if (m.kpInCurrency) {
                                    // При включённом "КП в валюте" обязательны: валюта, а также цена и сумма
                                    // с НДС в валюте в блоке "Продажа". В "Закупе" валютные поля необязательны
                                    // (закупить могут в рублях, а продавать в валюте).
                                    if (!m.currencyId) {
                                        alert('Включён режим «КП в валюте» — выберите валюту.');
                                        return;
                                    }
                                    if (!m.salePriceCurrency) {
                                        alert('Режим «КП в валюте»: заполните «Цену с НДС в валюте» в блоке «Продажа».');
                                        return;
                                    }
                                    if (!currencyCalc.saleSumCurrency) {
                                        alert('Режим «КП в валюте»: «Сумма с НДС в валюте» в блоке «Продажа» не рассчитана — укажите количество.');
                                        return;
                                    }
                                }
                                onSave();
                            }}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors"
                        >
                            {isEditing ? 'Сохранить изменения' : 'Добавить материал'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

// ───────────────────────── модалка выбора материалов для КП ─────────────────────────

/**
 * Список материалов проекта с чекбоксами — пользователь отмечает, что должно
 * попасть в конкретное коммерческое предложение (можно отметить сразу все).
 * Показываем полную склейку (наименование + характеристики + производитель из
 * справочника, оба резолвятся по ID из живых справочников), как и в MaterialSelect.
 */
function KPMaterialsSelectionModal({ materials, directories, isGenerating, onClose, onConfirm }: {
    materials: ProjectMaterial[];
    directories: any;
    isGenerating: boolean;
    onClose: () => void;
    onConfirm: (selected: ProjectMaterial[]) => void;
}) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggle = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const allSelected = materials.length > 0 && selectedIds.size === materials.length;
    const toggleAll = () => {
        setSelectedIds(allSelected ? new Set() : new Set(materials.map(m => m.id)));
    };

    const getFullLabel = (m: ProjectMaterial): string => {
        const dir = (directories.materials || []).find((dm: any) => dm.id === m.materialId);
        const manufacturerName = (directories.companies || []).find((c: any) => c.id === dir?.manufacturerId)?.name;
        return [m.materialName, dir?.characteristics, manufacturerName].filter(Boolean).join(', ');
    };

    const handleConfirmClick = () => {
        const selected = materials.filter(m => selectedIds.has(m.id));
        onConfirm(selected);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-ink/40 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="relative w-full max-w-xl bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] flex flex-col my-auto max-h-[85vh] overflow-hidden"
            >
                <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">Сформировать КП</h2>
                        <p className="text-[11px] text-ink-3 mt-0.5">Отметьте материалы, которые должны попасть в документ</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="px-6 py-2.5 border-b border-line shrink-0">
                    <button
                        type="button"
                        onClick={toggleAll}
                        className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-ochre hover:underline"
                    >
                        <span className={cn(
                            "w-4 h-4 rounded flex items-center justify-center border shrink-0 transition-colors",
                            allSelected ? "bg-ochre border-ochre text-white" : "border-line bg-surface"
                        )}>
                            {allSelected && <Check size={11} strokeWidth={3} />}
                        </span>
                        Выбрать все
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {materials.map(m => {
                        const calc = calcMaterial(m);
                        const isChecked = selectedIds.has(m.id);
                        // Валюта КП материала — только если не рубль, чтобы при выборе сразу
                        // было видно, какие материалы можно печатать в одном КП.
                        const currencyName = m.kpInCurrency
                            ? ((directories.currencies || []).find((c: any) => c.id === m.currencyId)?.name || '')
                            : '';
                        return (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => toggle(m.id)}
                                className={cn(
                                    "w-full flex items-start gap-3 px-6 py-3 text-left border-b border-line/60 last:border-b-0 transition-colors",
                                    isChecked ? "bg-ochre-bg/40" : "hover:bg-surface-2"
                                )}
                            >
                                <span className={cn(
                                    "w-4 h-4 rounded flex items-center justify-center border shrink-0 mt-0.5 transition-colors",
                                    isChecked ? "bg-ochre border-ochre text-white" : "border-line bg-surface"
                                )}>
                                    {isChecked && <Check size={11} strokeWidth={3} />}
                                </span>
                                <span className="flex-1 min-w-0 text-[13px] text-ink leading-snug">{getFullLabel(m)}</span>
                                {currencyName && (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-ochre-bg text-ochre text-[10.5px] font-semibold whitespace-nowrap">{currencyName}</span>
                                )}
                                <span className="shrink-0 text-[13px] font-mono font-semibold text-ink tabular-nums">{formatCurrency(calc.saleSum)}</span>
                            </button>
                        );
                    })}
                    {materials.length === 0 && (
                        <p className="px-6 py-8 text-center text-[13px] text-ink-4">В проекте пока нет материалов</p>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-3 shrink-0 bg-surface-2/30">
                    <span className="text-[12px] text-ink-3">{selectedIds.size > 0 ? `Выбрано: ${selectedIds.size}` : ''}</span>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                            Отмена
                        </button>
                        <button
                            onClick={handleConfirmClick}
                            disabled={selectedIds.size === 0 || isGenerating}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isGenerating && <Loader2 size={14} className="animate-spin" />}
                            {isGenerating ? 'Формируем…' : 'Сформировать'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

export default MaterialsTab;