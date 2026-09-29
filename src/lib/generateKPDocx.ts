/**
 * generateKPDocx.ts
 *
 * Генерация коммерческого предложения по шаблону template_kp.docx — шаблон специально
 * под материалы вида товара "кирпич" (имя файла и структура таблицы заточены под это).
 * Технически похоже на generateTrustDeedDocx.ts (JSZip, прямая работа с XML внутри
 * архива docx), но с добавленными сложностями:
 *
 * 1. Таблица материалов — переменное число строк (по числу выбранных позиций).
 *    В шаблоне должна быть РОВНО ОДНА строка-образец с плейсхолдерами внутри —
 *    код находит её границы по первому вхождению {{ROW_MATERIAL_NAME}}, размножает
 *    по числу материалов, в каждой копии подставляет свои значения.
 *
 * 2. Плейсхолдеры лежат не только в основном тексте документа (word/document.xml),
 *    но и в НИЖНЕМ КОЛОНТИТУЛЕ — а колонтитулов в docx может быть НЕСКОЛЬКО файлов
 *    (footer1.xml/footer2.xml/footer3.xml — для разных страниц раздела), и заранее
 *    неизвестно, в каком именно лежит нужный текст. Поэтому обрабатываем placeholder-
 *    подстановкой КАЖДЫЙ footer*.xml файл, который реально есть в архиве.
 *
 * 3. Фото материала хранится на Google Drive (не в Firebase Storage — бесплатный
 *    тариф не позволяет хранить файлы), поэтому при вставке в документ байты
 *    скачиваются напрямую через Google Drive API, тем же access-токеном, которым
 *    готовый файл КП потом загружается обратно на Диск. Это значит: если папка с
 *    фото не расшарена на аккаунт того, кто формирует КП, конкретно эта фотография
 *    просто не вставится (ячейка останется пустой) — остальной документ всё равно
 *    сформируется корректно.
 */

import JSZip from 'jszip';

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ───────────────────────── форматирование ─────────────────────────

function formatMoney(n: number): string {
    return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

function formatQty(n: number | undefined | null): string {
    if (!n) return '';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);
}

function formatDateRu(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

// ───────────────────────── даты подвала ─────────────────────────

function endOfMonth(year: number, monthIndexZeroBased: number): Date {
    return new Date(year, monthIndexZeroBased + 1, 0);
}

/** Округляет дату до БЛИЖАЙШЕГО конца месяца — сравнивает расстояние до конца
 * текущего месяца и до конца предыдущего, берёт то, что ближе (при равенстве —
 * вперёд, до конца текущего). */
function roundToClosestMonthEnd(date: Date): Date {
    const y = date.getFullYear();
    const m = date.getMonth();
    const currentEnd = endOfMonth(y, m);
    const prevEnd = endOfMonth(y, m - 1);
    const diffCurrent = Math.abs(currentEnd.getTime() - date.getTime());
    const diffPrev = Math.abs(date.getTime() - prevEnd.getTime());
    return diffPrev < diffCurrent ? prevEnd : currentEnd;
}

/** {{KP_VALID_UNTIL}} = сегодня + 14 дней, округлено до БЛИЖАЙШЕГО конца месяца. */
export function calcKPValidUntil(base: Date = new Date(), daysAhead = 14): Date {
    const raw = new Date(base);
    raw.setDate(raw.getDate() + daysAhead);
    return roundToClosestMonthEnd(raw);
}

/** {{TRANSFER_VALID_UNTIL}} = сегодня + 14 дней, округлено ВВЕРХ до конца ТОГО
 * месяца, в который эта дата попала (без сравнения "ближе/дальше"). */
export function calcTransferValidUntil(base: Date = new Date(), daysAhead = 14): Date {
    const raw = new Date(base);
    raw.setDate(raw.getDate() + daysAhead);
    return endOfMonth(raw.getFullYear(), raw.getMonth());
}

// ───────────────────────── имя файла ─────────────────────────

/** КП_кирпич_{название проекта}_{название застройщика}_{дата формирования} */
export function buildKPFileName(projectName: string, clientName: string, date: Date = new Date()): string {
    const parts = ['КП', 'кирпич', projectName, clientName, formatDateRu(date)]
        .map(p => (p || '').trim())
        .filter(Boolean);
    return parts.join('_').replace(/[/\\:*?"<>|]/g, '') + '.docx';
}

// ───────────────────────── входные данные ─────────────────────────

export interface KPMaterialInput {
    materialName: string;
    characteristics: string;
    manufacturerName?: string;
    /** Кол-во шт в 1 м² (из справочника материала) — используется и для "в 1 м2 – N шт.", и для расчёта цены за м². */
    qtyPerM2?: number;
    /** Кол-во шт в поддоне (из справочника материала) — используется для "N шт. в поддоне". */
    qtyPerPallet?: number;
    /** ID файла фото на Google Drive (из справочника материала) — если есть, вставляется в ячейку картинкой. */
    photoDriveFileId?: string;
    /** Цена продажи за ед., с НДС. */
    price: number;
    /** Кол-во м² (для материалов, где это применимо). */
    quantityM2?: number;
    /** Итоговое количество (шт, кратно поддону) — то же, что идёт в расчёты закупа/продажи. */
    quantity: number;
    /** Сумма продажи с НДС по позиции. */
    sum: number;
    /** Ставка НДС от продажи этой позиции, % (для подвала берём у первой выбранной позиции). */
    saleVatPercent: number;
}

export interface KPDocxInput {
    clientName: string;
    projectName: string;
    sellerLegalEntity: string;
    sellerLegalEntityAddress: string;
    managerName: string;
    materials: KPMaterialInput[];
    /** Google-токен того, кто формирует КП — нужен, чтобы скачать байты фото с Диска. */
    accessToken: string;
}

// ───────────────────────── работа с XML ─────────────────────────

/** Находит границы <w:tr>...</w:tr>, в которые попадает первое вхождение marker. */
function findRowBounds(xml: string, marker: string): { start: number; end: number } {
    // Используем регулярное выражение для поиска marker, дабы не зависеть от разбиения тегов
    const pattern = marker
        .split('')
        .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('(?:<[^>]+>)*');
    const markerRegex = new RegExp(`\\{\\{(?:<[^>]+>)*${pattern}(?:<[^>]+>)*\\}\\}`, 'i');
    const match = markerRegex.exec(xml);

    if (!match) {
        throw new Error(`В шаблоне КП не найден плейсхолдер ${marker}. Проверьте файл шаблона (public/template_kp.docx).`);
    }
    const markerIdx = match.index;

    const trOpen = '<w:tr';
    const trClose = '</w:tr>';
    let searchFrom = 0;
    while (true) {
        const openIdx = xml.indexOf(trOpen, searchFrom);
        if (openIdx === -1 || openIdx > markerIdx) break;
        const tagEnd = xml.indexOf('>', openIdx) + 1;
        const closeIdx = xml.indexOf(trClose, tagEnd);
        if (closeIdx === -1) break;
        const rowEnd = closeIdx + trClose.length;
        if (markerIdx < rowEnd) {
            return { start: openIdx, end: rowEnd };
        }
        searchFrom = rowEnd;
    }
    throw new Error('Не удалось определить границы строки-образца в таблице шаблона КП — проверьте структуру таблицы.');
}

/** Убирает целиком те параграфы, в которых сидит "опциональный" плейсхолдер,
 * значение которого для этой позиции пустое (чтобы в ячейке не осталась пустая строка). */
function stripEmptyOptionalParagraphs(rowXml: string, replacements: Record<string, string>, optionalKeys: string[]): string {
    return rowXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
        for (const key of optionalKeys) {
            const token = `{{${key}}}`;
            if (paragraph.includes(token) && !replacements[key]) {
                return '';
            }
        }
        return paragraph;
    });
}

/**
 * Замена плейсхолдеров {{KEY}}, устойчивая к разрывам тегов MS Word.
 */
function substitutePlaceholders(xml: string, replacements: Record<string, string>): string {
    let result = xml;
    for (const [key, value] of Object.entries(replacements)) {
        // Экранируем спецсимволы ключа и строим гибкий Regex для поиска {{KEY}},
        // даже если между буквами есть служебные теги Word (<w:r>, <w:t>, <w:proofErr> и т.д.)
        const pattern = key
            .split('')
            .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('(?:<[^>]+>)*');

        const regex = new RegExp(`\\{\\{(?:<[^>]+>)*${pattern}(?:<[^>]+>)*\\}\\}`, 'g');
        result = result.replace(regex, escapeXml(value ?? ''));
    }
    return result;
}

/** Скачивает байты файла с Google Drive через официальный API (требует access-токен
 * того, кто формирует КП — см. комментарий в шапке файла про ограничение доступа).
 * supportsAllDrives=true — без этого параметра файлы, лежащие на "Общих дисках"
 * (Shared Drives) Google Workspace, попросту не видны запросу и возвращают 404,
 * даже если прав доступа формально достаточно; для личного "Мой диск" параметр
 * ни на что не влияет, поэтому оставляем его всегда, а не только опционально. */
async function fetchDriveFileBytes(fileId: string, accessToken: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
    const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Drive API HTTP ${resp.status}`);
    const bytes = await resp.arrayBuffer();
    const mime = resp.headers.get('Content-Type') || 'image/png';
    return { bytes, mime };
}

function extFromMime(mime: string): string {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    return 'png';
}

/**
 * Вставляет фото материала в ячейку вместо {{MATERIAL_PHOTO}} (или просто убирает
 * плейсхолдер, если фото нет или его не удалось скачать). Добавляет байты картинки
 * в архив, релс и при необходимости Content_Types.xml — своя, отдельная связка на
 * каждую строку.
 */
async function embedPhoto(rowXml: string, driveFileId: string | undefined, accessToken: string, index: number, zip: JSZip): Promise<string> {
    const marker = 'MATERIAL_PHOTO';
    const pattern = marker
        .split('')
        .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('(?:<[^>]+>)*');
    const markerRegex = new RegExp(`\\{\\{(?:<[^>]+>)*${pattern}(?:<[^>]+>)*\\}\\}`, 'i');

    if (!markerRegex.test(rowXml)) return rowXml;

    const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    let match: RegExpExecArray | null;
    let targetParagraph: string | null = null;
    while ((match = paraRegex.exec(rowXml))) {
        if (markerRegex.test(match[0])) { targetParagraph = match[0]; break; }
    }
    if (!targetParagraph) return rowXml;

    if (!driveFileId) {
        return rowXml.replace(targetParagraph, '');
    }

    let bytes: ArrayBuffer;
    let ext: string;
    try {
        const result = await fetchDriveFileBytes(driveFileId, accessToken);
        bytes = result.bytes;
        ext = extFromMime(result.mime);
    } catch (error) {
        console.error('Не удалось скачать фото материала с Google Диска, оставляем ячейку пустой (проверьте, расшарен ли файл):', error);
        return rowXml.replace(targetParagraph, '');
    }

    const mediaName = `kpPhoto${index}.${ext}`;
    zip.file(`word/media/${mediaName}`, bytes);

    const relId = `rIdKpPhoto${index}`;
    const relsPath = 'word/_rels/document.xml.rels';
    const relsFile = zip.file(relsPath);
    let relsXml = relsFile
        ? await relsFile.async('text')
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const relEntry = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/>`;
    relsXml = relsXml.replace('</Relationships>', relEntry + '</Relationships>');
    zip.file(relsPath, relsXml);

    const contentTypesPath = '[Content_Types].xml';
    const ctFile = zip.file(contentTypesPath);
    if (ctFile) {
        let ctXml = await ctFile.async('text');
        if (!ctXml.includes(`Extension="${ext}"`)) {
            const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
            ctXml = ctXml.replace('</Types>', `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
            zip.file(contentTypesPath, ctXml);
        }
    }

    const sizeEmu = 800000;
    const docPrId = 9000 + index;
    const drawing =
        `<w:r><w:drawing>` +
        `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
        `<wp:extent cx="${sizeEmu}" cy="${sizeEmu}"/>` +
        `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
        `<wp:docPr id="${docPrId}" name="KPPhoto${index}"/>` +
        `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="KPPhoto${index}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${sizeEmu}" cy="${sizeEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

    const pPrMatch = targetParagraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : '';
    const newParagraph = `<w:p>${pPr}${drawing}</w:p>`;
    return rowXml.replace(targetParagraph, newParagraph);
}

// ───────────────────────── основная функция ─────────────────────────

export async function generateKPDocx(data: KPDocxInput): Promise<Blob> {
    if (data.materials.length === 0) {
        throw new Error('Не выбрано ни одного материала для КП.');
    }

    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
    const response = await fetch(`${baseUrl}template_kp.docx?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error('Не удалось загрузить шаблон КП (template_kp.docx). Убедитесь, что файл лежит в папке public проекта.');
    }
    const templateArrayBuffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(templateArrayBuffer);

    const documentFile = zip.file('word/document.xml');
    if (!documentFile) throw new Error('В шаблоне КП не найден word/document.xml — файл повреждён.');
    let documentXml = await documentFile.async('text');

    const { start, end } = findRowBounds(documentXml, 'ROW_MATERIAL_NAME');
    const sampleRow = documentXml.slice(start, end);
    const before = documentXml.slice(0, start);
    const after = documentXml.slice(end);

    const totalSum = data.materials.reduce((sum, m) => sum + (m.sum || 0), 0);
    const firstVatPercent = data.materials[0]?.saleVatPercent ?? 22;

    const now = new Date();

    let rowsXml = '';
    let photoIndex = 0;
    for (const m of data.materials) {
        const priceMeter = m.qtyPerM2 ? m.price * m.qtyPerM2 : 0;
        const meterQuantityText = m.qtyPerM2 ? `в 1 м2 – ${formatQty(m.qtyPerM2)} шт.` : '';
        const quantityPerPalletText = m.qtyPerPallet ? `${formatQty(m.qtyPerPallet)} шт. в поддоне` : '';
        const manufacturerText = m.manufacturerName ? `Производитель: ${m.manufacturerName}` : '';

        const rowReplacements: Record<string, string> = {
            ROW_MATERIAL_NAME: m.materialName,
            ROW_CHARACTERISTICS: m.characteristics || '',
            METER_QUANTITY: meterQuantityText,
            QUANTITY_PER_PALLET: quantityPerPalletText,
            MAUFACTURER: manufacturerText,
            ROW_PRICE: formatMoney(m.price),
            ROW_PRICE_METER: m.qtyPerM2 ? formatMoney(priceMeter) : '',
            ROW_QUANTITY_METER: m.quantityM2 ? formatQty(m.quantityM2) : '',
            ROW_QUANTITY: formatQty(m.quantity),
            ROW_SUM: formatMoney(m.sum),
        };

        let rowCopy = stripEmptyOptionalParagraphs(sampleRow, rowReplacements, ['METER_QUANTITY', 'QUANTITY_PER_PALLET', 'MAUFACTURER']);
        photoIndex += 1;
        rowCopy = await embedPhoto(rowCopy, m.photoDriveFileId, data.accessToken, photoIndex, zip);
        rowCopy = substitutePlaceholders(rowCopy, rowReplacements);
        rowsXml += rowCopy;
    }

    documentXml = before + rowsXml + after;

    const topLevelReplacements: Record<string, string> = {
        KP_CLIENT_NAME: data.clientName,
        KP_PROJECT_NAME: data.projectName,
        KP_DATE: formatDateRu(now),
        TOTAL_SUM: formatMoney(totalSum),
        KP_VALID_UNTIL: formatDateRu(calcKPValidUntil(now)),
        NDS: `${firstVatPercent}%`,
        TRANSFER_VALID_UNTIL: formatDateRu(calcTransferValidUntil(now)),
        MANAGER_NAME: data.managerName,
        KP_SELLER_LEGAL_ENTITY: data.sellerLegalEntity,
        KP_SELLER_LEGAL_ENTITY_ADDRESS: data.sellerLegalEntityAddress,
    };

    documentXml = substitutePlaceholders(documentXml, topLevelReplacements);
    zip.file('word/document.xml', documentXml);

    const footerPaths = Object.keys(zip.files).filter(p => /^word\/footer\d+\.xml$/.test(p));
    for (const footerPath of footerPaths) {
        const footerFile = zip.file(footerPath);
        if (!footerFile) continue;
        let footerXml = await footerFile.async('text');
        footerXml = substitutePlaceholders(footerXml, topLevelReplacements);
        zip.file(footerPath, footerXml);
    }

    return zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
}