import React, { useState } from 'react';
import JSZip from 'jszip';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { X, Upload, Check, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import type { Company, DirectoryItem, Material, ProductType } from '../types';
import { OperationType, handleFirestoreError } from '../lib/firestore-errors';
import { ensureGoogleToken } from '../services/googleCalendarAuth';

/**
 * Импорт материалов из Excel (.xlsx) в справочник материалов.
 *
 * Первая строка файла — заголовки столбцов (порядок любой, лишние столбцы игнорируются):
 *   Вид товара | Наименование | Характеристики | Производитель | Ед. изм. |
 *   Кол-во шт в 1 м² | Кол-во шт в поддоне | Кол-во поддонов в машине
 * Обязателен только «Наименование».
 *
 * Вид товара, производитель и единица измерения сопоставляются со справочниками по
 * названию (без учёта регистра). Если названия нет в справочнике — строка помечается
 * ошибкой и не загружается (новые виды/компании/единицы импорт НЕ создаёт — их заводят
 * в соответствующих справочниках). Материал, который уже есть (то же наименование +
 * характеристики + производитель), пропускается — поэтому файл можно безопасно
 * загрузить повторно после исправления ошибок.
 *
 * Файл читается через JSZip (xlsx — это zip с XML), новых библиотек не требуется.
 */

const norm = (s: string) => (s || '').replace(/ё/gi, 'е').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\.$/, '');
const normUnit = (s: string) => norm(s).replace(/м3/g, 'м³').replace(/м2/g, 'м²');

type FieldKey = 'productType' | 'name' | 'characteristics' | 'manufacturer' | 'unit' | 'qtyPerM2' | 'qtyPerPallet' | 'palletsPerTruck' | 'photo';

const COLUMN_ALIASES: Record<FieldKey, string[]> = {
    productType: ['вид товара'],
    name: ['наименование', 'название'],
    characteristics: ['характеристики'],
    manufacturer: ['производитель'],
    unit: ['ед. изм.', 'ед изм', 'ед.изм.', 'единица измерения'],
    qtyPerM2: ['кол-во шт в 1 м²', 'кол-во шт в 1 м2'],
    qtyPerPallet: ['кол-во шт в поддоне'],
    palletsPerTruck: ['кол-во поддонов в машине'],
    photo: ['фото (ссылка на диск)', 'фото', 'фото (ссылка)'],
};

interface SheetRow { rowNumber: number; cells: string[]; }

function colIndexFromRef(ref: string): number {
    const letters = (ref.match(/^[A-Z]+/i)?.[0] || 'A').toUpperCase();
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** Достаёт ID файла из ссылки Google Диска / Таблиц (.../file/d/ID/..., .../spreadsheets/d/ID/..., ?id=ID) или голый ID. */
function parseDriveFileId(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';
    const byPath = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (byPath) return byPath[1];
    const byQuery = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (byQuery) return byQuery[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
    return '';
}

const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Скачивает файл с Диска как .xlsx: обычный Excel-файл — как есть, Google Таблицу — экспортом в xlsx. */
async function downloadDriveXlsx(fileId: string, accessToken: string): Promise<{ bytes: ArrayBuffer; name: string }> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const metaResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType&supportsAllDrives=true`,
        { headers }
    );
    if (!metaResp.ok) throw new Error(`meta:${metaResp.status}`);
    const meta = await metaResp.json() as { name: string; mimeType: string };

    const url = meta.mimeType === GOOGLE_SHEET_MIME
        ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
        : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`download:${resp.status}`);
    return { bytes: await resp.arrayBuffer(), name: meta.name };
}

/** Читает первый лист .xlsx в массив строк (все значения — строками). */
async function readXlsxRows(buffer: ArrayBuffer): Promise<SheetRow[]> {
    const zip = await JSZip.loadAsync(buffer);
    const parser = new DOMParser();
    const parse = async (path: string) => {
        const f = zip.file(path);
        return f ? parser.parseFromString(await f.async('text'), 'application/xml') : null;
    };

    const shared: string[] = [];
    const sharedDoc = await parse('xl/sharedStrings.xml');
    if (sharedDoc) {
        Array.from(sharedDoc.getElementsByTagName('si')).forEach(si => {
            shared.push(Array.from(si.getElementsByTagName('t')).map(t => t.textContent || '').join(''));
        });
    }

    // Путь первого листа: workbook.xml → rId → workbook.xml.rels; запасной вариант — sheet1.xml.
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wbDoc = await parse('xl/workbook.xml');
    const relsDoc = await parse('xl/_rels/workbook.xml.rels');
    const firstSheet = wbDoc?.getElementsByTagName('sheet')[0];
    if (firstSheet && relsDoc) {
        const rid = firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
            || firstSheet.getAttribute('r:id');
        const rel = Array.from(relsDoc.getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === rid);
        const target = rel?.getAttribute('Target');
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }

    const sheetDoc = await parse(sheetPath);
    if (!sheetDoc) throw new Error('Не удалось прочитать лист Excel');

    const rows: SheetRow[] = [];
    Array.from(sheetDoc.getElementsByTagName('row')).forEach((rowEl, i) => {
        const cells: string[] = [];
        Array.from(rowEl.getElementsByTagName('c')).forEach(c => {
            const idx = colIndexFromRef(c.getAttribute('r') || '');
            const type = c.getAttribute('t');
            let value = '';
            if (type === 's') {
                value = shared[Number(c.getElementsByTagName('v')[0]?.textContent)] ?? '';
            } else if (type === 'inlineStr') {
                value = Array.from(c.getElementsByTagName('t')).map(t => t.textContent || '').join('');
            } else {
                value = c.getElementsByTagName('v')[0]?.textContent || '';
            }
            cells[idx] = value;
        });
        rows.push({ rowNumber: Number(rowEl.getAttribute('r')) || i + 1, cells });
    });
    return rows;
}

interface ImportRow {
    rowNumber: number;
    name: string;
    characteristics: string;
    productTypeId: string;
    productTypeName: string;
    manufacturerId: string;
    manufacturerName: string;
    unitId: string;
    unitName: string;
    qtyPerM2: number | null;
    qtyPerPallet: number | null;
    palletsPerTruck: number | null;
    photoDriveFileId: string;
    status: 'new' | 'exists' | 'error';
    message: string;
}

export default function MaterialsImportModal({ materials, productTypes, companies, units, onClose }: {
    materials: Material[];
    productTypes: ProductType[];
    companies: Company[];
    units: DirectoryItem[];
    onClose: () => void;
}) {
    const [fileName, setFileName] = useState('');
    const [rows, setRows] = useState<ImportRow[] | null>(null);
    const [fatalError, setFatalError] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [doneCount, setDoneCount] = useState<number | null>(null);
    const [driveLink, setDriveLink] = useState('');
    const [isLoadingDrive, setIsLoadingDrive] = useState(false);

    /** Загрузка с Google Диска по ссылке (обычный .xlsx или Google Таблица). Вызывается из клика —
     * ensureGoogleToken должен идти первым действием, иначе браузер заблокирует окно Google. */
    const handleDriveLoad = async () => {
        const fileId = parseDriveFileId(driveLink);
        if (!fileId) {
            setFatalError('Не удалось распознать ссылку на файл Google Диска. Вставьте ссылку «Поделиться» на файл или Google Таблицу.');
            return;
        }
        setIsLoadingDrive(true);
        setFatalError('');
        try {
            const token = await ensureGoogleToken();
            if (!token) {
                setFatalError('Нет доступа к Google Диску. Нажмите «Загрузить с Диска» ещё раз и подтвердите доступ в окне Google.');
                return;
            }
            const { bytes, name } = await downloadDriveXlsx(fileId, token);
            await processBuffer(bytes, name);
        } catch (error) {
            console.error('Не удалось загрузить файл с Google Диска:', error);
            setRows(null);
            setFatalError('Не удалось получить файл с Диска. Проверьте ссылку и что у вашего аккаунта Google есть доступ к этому файлу.');
        } finally {
            setIsLoadingDrive(false);
        }
    };

    const handleFile = async (file: File) => {
        setIsLoadingDrive(false);
        await processBuffer(await file.arrayBuffer(), file.name);
    };

    const processBuffer = async (buffer: ArrayBuffer, label: string) => {
        setFileName(label);
        setFatalError('');
        setRows(null);
        setDoneCount(null);
        try {
            const sheet = await readXlsxRows(buffer);
            const headerIdx = sheet.findIndex(r => r.cells.some(c => norm(c || '') === 'наименование' || norm(c || '') === 'название'));
            if (headerIdx < 0) {
                setFatalError('Не найден заголовок «Наименование» в первой строке. Проверьте, что в первой строке файла стоят названия столбцов.');
                return;
            }
            const header = sheet[headerIdx].cells;
            const colOf = {} as Record<FieldKey, number>;
            (Object.keys(COLUMN_ALIASES) as FieldKey[]).forEach(key => {
                const aliases = COLUMN_ALIASES[key].map(norm);
                colOf[key] = header.findIndex(h => aliases.includes(norm(h || '')));
            });
            const get = (cells: string[], key: FieldKey) => (colOf[key] >= 0 ? (cells[colOf[key]] || '').trim() : '');

            const existingKeys = new Set(materials.map(m => `${norm(m.name)}|${norm(m.characteristics || '')}|${m.manufacturerId || ''}`));
            const seenInFile = new Set<string>();
            const parsed: ImportRow[] = [];

            for (const r of sheet.slice(headerIdx + 1)) {
                if (!r.cells.some(c => (c || '').trim())) continue; // пустая строка
                const name = get(r.cells, 'name');
                const characteristics = get(r.cells, 'characteristics');
                const productTypeName = get(r.cells, 'productType');
                const manufacturerName = get(r.cells, 'manufacturer');
                const unitName = get(r.cells, 'unit');

                const problems: string[] = [];
                if (!name) problems.push('не заполнено наименование');

                const productType = productTypeName ? productTypes.find(p => norm(p.name) === norm(productTypeName)) : undefined;
                if (productTypeName && !productType) problems.push(`вид товара «${productTypeName}» не найден в справочнике`);

                const manufacturer = manufacturerName ? companies.find(c => norm(c.name) === norm(manufacturerName)) : undefined;
                if (manufacturerName && !manufacturer) problems.push(`производитель «${manufacturerName}» не найден в справочнике компаний`);

                const unit = unitName ? units.find(u => normUnit(u.name) === normUnit(unitName)) : undefined;
                if (unitName && !unit) problems.push(`единица «${unitName}» не найдена в справочнике`);

                const num = (key: FieldKey, label: string): number | null => {
                    const raw = get(r.cells, key);
                    if (!raw) return null;
                    const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
                    if (!Number.isFinite(n) || n < 0) { problems.push(`«${label}»: «${raw}» — не число`); return null; }
                    return n || null;
                };
                // Фото: ссылка «Поделиться» на файл на Google Диске (сохраняется только ID файла).
                const photoRaw = get(r.cells, 'photo');
                const photoDriveFileId = photoRaw ? parseDriveFileId(photoRaw) : '';
                if (photoRaw && !photoDriveFileId) problems.push('ссылка на фото не распознана (нужна ссылка «Поделиться» на файл Google Диска)');

                const qtyPerM2 = num('qtyPerM2', 'Кол-во шт в 1 м²');
                const qtyPerPallet = num('qtyPerPallet', 'Кол-во шт в поддоне');
                const palletsPerTruck = num('palletsPerTruck', 'Кол-во поддонов в машине');

                let status: ImportRow['status'] = 'new';
                let message = '';
                if (problems.length) {
                    status = 'error';
                    message = problems.join('; ');
                } else {
                    const key = `${norm(name)}|${norm(characteristics)}|${manufacturer?.id || ''}`;
                    if (existingKeys.has(key)) { status = 'exists'; message = 'уже есть в справочнике — пропущено'; }
                    else if (seenInFile.has(key)) { status = 'exists'; message = 'повтор в файле — пропущено'; }
                    seenInFile.add(key);
                }

                parsed.push({
                    rowNumber: r.rowNumber, name, characteristics,
                    productTypeId: productType?.id || '', productTypeName: productType?.name || '',
                    manufacturerId: manufacturer?.id || '', manufacturerName: manufacturer?.name || '',
                    unitId: unit?.id || '', unitName: unit?.name || '',
                    qtyPerM2, qtyPerPallet, palletsPerTruck, photoDriveFileId, status, message,
                });
            }

            if (!parsed.length) { setFatalError('В файле нет строк с данными под заголовками.'); return; }
            setRows(parsed);
        } catch (error) {
            console.error('Ошибка чтения Excel:', error);
            setFatalError('Не удалось прочитать файл. Нужен файл Excel в формате .xlsx.');
        }
    };

    const newRows = (rows || []).filter(r => r.status === 'new');
    const existsCount = (rows || []).filter(r => r.status === 'exists').length;
    const errorCount = (rows || []).filter(r => r.status === 'error').length;

    const handleImport = async () => {
        if (!newRows.length || isImporting) return;
        setIsImporting(true);
        try {
            // Пачками по 400 записей (лимит Firestore на одну пачку — 500).
            for (let i = 0; i < newRows.length; i += 400) {
                const batch = writeBatch(db);
                newRows.slice(i, i + 400).forEach(r => {
                    batch.set(doc(collection(db, 'materials')), {
                        name: r.name,
                        productTypeId: r.productTypeId || '',
                        characteristics: r.characteristics,
                        manufacturerId: r.manufacturerId || '',
                        unitId: r.unitId || null,
                        qtyPerM2: r.qtyPerM2,
                        qtyPerPallet: r.qtyPerPallet,
                        palletsPerTruck: r.palletsPerTruck,
                        photoDriveFileId: r.photoDriveFileId || null,
                        createdAt: serverTimestamp(),
                    });
                });
                await batch.commit();
            }
            setDoneCount(newRows.length);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, 'materials');
        } finally {
            setIsImporting(false);
        }
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
                    <h2 className="font-serif text-[20px] font-medium text-ink leading-tight">Импорт материалов из Excel</h2>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                    {doneCount !== null ? (
                        <div className="flex items-center gap-3 text-[14px] text-ink">
                            <span className="w-8 h-8 rounded-full bg-ochre-bg flex items-center justify-center text-ochre"><Check size={16} /></span>
                            Загружено материалов: {doneCount}
                        </div>
                    ) : (
                        <>
                            <label className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-[13px] font-semibold border border-line bg-surface hover:bg-surface-2 cursor-pointer transition-colors">
                                <Upload size={14} /> {fileName ? 'Выбрать другой файл' : 'Выбрать файл Excel'}
                                <input
                                    type="file"
                                    accept=".xlsx"
                                    className="hidden"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                                />
                            </label>
                            {fileName && <span className="ml-3 text-[12px] text-ink-3">{fileName}</span>}

                            <div>
                                <p className="text-[11px] text-ink-3 mb-1.5">или файл на Google Диске (Excel или Google Таблица) — вставьте ссылку:</p>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={driveLink}
                                        onChange={e => setDriveLink(e.target.value)}
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                        className="w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleDriveLoad}
                                        disabled={!driveLink.trim() || isLoadingDrive}
                                        className="shrink-0 h-9 px-4 rounded-md text-[13px] font-semibold border border-line bg-surface hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isLoadingDrive ? 'Загрузка…' : 'Загрузить с Диска'}
                                    </button>
                                </div>
                            </div>


                            {fatalError && (
                                <div className="flex items-start gap-2 text-[12.5px] text-terracotta">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {fatalError}
                                </div>
                            )}

                            {rows && (
                                <>
                                    <div className="text-[12.5px] text-ink">
                                        Новых: <b>{newRows.length}</b> · Уже есть: <b>{existsCount}</b> · С ошибками: <b className={errorCount ? 'text-terracotta' : ''}>{errorCount}</b>
                                    </div>
                                    <div className="border border-line rounded-lg overflow-hidden">
                                        {rows.map(r => (
                                            <div key={r.rowNumber} className={cn(
                                                "px-4 py-2.5 border-b border-line/60 last:border-b-0 flex items-start gap-3",
                                                r.status === 'error' && "bg-terracotta/5",
                                                r.status === 'exists' && "bg-surface-2/60"
                                            )}>
                                                <span className="text-[10.5px] font-mono text-ink-4 w-8 shrink-0 pt-0.5">{r.rowNumber}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[13px] text-ink leading-snug">{r.name || '—'}</p>
                                                    {r.characteristics && <p className="text-[11.5px] text-ink-3 leading-snug">{r.characteristics}</p>}
                                                    <p className="text-[10.5px] text-ink-4 mt-0.5">
                                                        {[r.productTypeName, r.manufacturerName, r.unitName, r.photoDriveFileId ? 'есть фото' : ''].filter(Boolean).join(' · ') || '—'}
                                                    </p>
                                                    {r.message && (
                                                        <p className={cn("text-[11px] mt-0.5", r.status === 'error' ? "text-terracotta" : "text-ink-3")}>{r.message}</p>
                                                    )}
                                                </div>
                                                <span className={cn(
                                                    "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded shrink-0",
                                                    r.status === 'new' && "bg-ochre-bg text-ochre",
                                                    r.status === 'exists' && "bg-surface-2 text-ink-3",
                                                    r.status === 'error' && "bg-terracotta/10 text-terracotta"
                                                )}>
                                                    {r.status === 'new' ? 'Новый' : r.status === 'exists' ? 'Пропуск' : 'Ошибка'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-line bg-surface-2/30 flex justify-end gap-2 shrink-0">
                    <button onClick={onClose} className="h-9 px-4 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors">
                        {doneCount !== null ? 'Закрыть' : 'Отмена'}
                    </button>
                    {doneCount === null && (
                        <button
                            onClick={handleImport}
                            disabled={!newRows.length || isImporting}
                            className="h-9 px-5 rounded-md text-[13px] font-semibold bg-ink text-bg hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isImporting ? 'Загрузка…' : `Загрузить${newRows.length ? ` (${newRows.length})` : ''}`}
                        </button>
                    )}
                </div>
            </motion.div>
        </div>
    );
}