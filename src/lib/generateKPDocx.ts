/**
 * generateKPDocx.ts
 *
 * Генерация коммерческого предложения. Два шаблона:
 * — template_kp.docx — под материалы вида товара "кирпич" (структура таблицы и
 *   часть плейсхолдеров заточены именно под него: расчёт по м², по поддонам);
 * — template_kp_other.docx — универсальный, для любых остальных материалов
 *   (меньше плейсхолдеров — нет "кол-во поддонов"/"цена за м²", зато есть явная
 *   единица измерения {{ROW_UNIT}}).
 * Выбор между ними делает вызывающий код (MaterialsTab.tsx) по тому же принципу,
 * что и раньше решалось "подходит/не подходит" — если среди отмеченных материалов
 * есть хотя бы один "кирпич", печатаем кирпичным шаблоном, иначе — универсальным.
 *
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
 *
 * 4. Колонка с фото в таблице убирается ЦЕЛИКОМ (не просто пустые ячейки), если ни
 *    у одного из выбранных материалов нет фото — см. removePhotoColumnIfNoPhotos.
 *    Освободившаяся ширина отдаётся колонке "Наименование материалов".
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

/** Значение реквизита одной строкой: перевод строки внутри обычного текста Word
 * (<w:t>) не является переносом, поэтому многострочное поле (например "Счёт")
 * склеиваем в одну строку через пробел. */
function singleLine(value?: string): string {
    return (value || '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

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

// ───────────────────────── шаблоны ─────────────────────────

/** Фраза, которая печатается ТОЛЬКО в КП в валюте (плейсхолдер {{CURRENCY_NOTE}} в
 * шаблоне). В рублёвом КП значение пустое — абзац с плейсхолдером убирается целиком. */
const CURRENCY_PAYMENT_NOTE = 'Оплата в рублях по курсу ЦБ на дату платежа.';

export type KPTemplateType = 'brick' | 'other';

const TEMPLATE_FILE_BY_TYPE: Record<KPTemplateType, string> = {
    brick: 'template_kp.docx',
    other: 'template_kp_other.docx',
};

const FILENAME_LABEL_BY_TYPE: Record<KPTemplateType, string> = {
    brick: 'кирпич',
    other: 'материалы',
};

// ───────────────────────── имя файла ─────────────────────────

/** КП_{кирпич|материалы}_{название проекта}_{название застройщика}_{дата формирования} */
export function buildKPFileName(projectName: string, clientName: string, templateType: KPTemplateType = 'brick', date: Date = new Date()): string {
    const parts = ['КП', FILENAME_LABEL_BY_TYPE[templateType], projectName, clientName, formatDateRu(date)]
        .map(p => (p || '').trim())
        .filter(Boolean);
    return parts.join('_').replace(/[/\\:*?"<>|]/g, '') + '.docx';
}

// ───────────────────────── входные данные ─────────────────────────

export interface KPMaterialInput {
    materialName: string;
    characteristics: string;
    manufacturerName?: string;
    /** Единица измерения (шт/кг/л/м² и т.п.) — для универсального шаблона ({{ROW_UNIT}});
     * кирпичный шаблон такого плейсхолдера не содержит, поле там просто игнорируется. */
    unit?: string;
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
    /** Название валюты (из справочника «Валюты»), если КП печатается в валюте. Тогда
     * price/sum у материалов УЖЕ должны быть в этой валюте (их подставляет вызывающий
     * код — см. MaterialsTab.tsx), а в шаблоне {{CURRENCY}} заменяется на это название,
     * и печатается фраза {{CURRENCY_NOTE}}. Пусто/не задано — обычный рублёвый КП:
     * {{CURRENCY}} → "руб.", {{CURRENCY_NOTE}} убирается. */
    currencyName?: string;
    /** Какой шаблон использовать — определяется вызывающим кодом (см. MaterialsTab.tsx):
     * "brick", если среди выбранных материалов есть хотя бы один вида товара "кирпич",
     * иначе "other". По умолчанию "brick" — для обратной совместимости вызовов, где
     * этот параметр ещё не передаётся. */
    templateType?: KPTemplateType;
    clientName: string;
    projectName: string;
    sellerLegalEntity: string;
    sellerLegalEntityAddress: string;
    /** Остальные реквизиты юр. лица для продажи (из карточки компании в справочнике).
     * Необязательные: если у компании не заполнены — подставляется пустая строка. */
    sellerLegalEntityInnKpp?: string;
    sellerLegalEntityOgrnOkpo?: string;
    sellerLegalEntityBankDetails?: string;
    sellerLegalEntityDirector?: string;
    sellerLegalEntityDirectorPhone?: string;
    managerName: string;
    materials: KPMaterialInput[];
    /** Google-токен того, кто формирует КП — нужен, чтобы скачать байты фото с Диска. */
    accessToken: string;
}

// ───────────────────────── работа с XML: строки/ячейки ─────────────────────────

/** Строит "гибкую" регулярку для {{MARKER}}, устойчивую к разрывам тегов Word
 * между буквами (между символами маркера могут затесаться служебные теги). */
function buildPlaceholderRegex(marker: string): RegExp {
    const pattern = marker
        .split('')
        .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('(?:<[^>]+>)*');
    return new RegExp(`\\{\\{(?:<[^>]+>)*${pattern}(?:<[^>]+>)*\\}\\}`, 'i');
}

/** Находит границы <w:tr>...</w:tr>, в которые попадает первое вхождение marker. */
function findRowBounds(xml: string, marker: string): { start: number; end: number } {
    const markerRegex = buildPlaceholderRegex(marker);
    const match = markerRegex.exec(xml);

    if (!match) {
        throw new Error(`В шаблоне КП не найден плейсхолдер ${marker}. Проверьте файл шаблона.`);
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

/** Находит границы <w:tbl>...</w:tbl>, целиком содержащей заданный диапазон
 * (используется, чтобы найти всю таблицу материалов вокруг строки-образца). */
function findTableBounds(xml: string, innerStart: number, innerEnd: number): { start: number; end: number } {
    const tblOpen = '<w:tbl>';
    const tblClose = '</w:tbl>';
    let searchFrom = 0;
    while (true) {
        const openIdx = xml.indexOf(tblOpen, searchFrom);
        if (openIdx === -1 || openIdx > innerStart) break;
        const closeIdx = xml.indexOf(tblClose, openIdx);
        if (closeIdx === -1) break;
        const tblEnd = closeIdx + tblClose.length;
        if (innerEnd <= tblEnd) return { start: openIdx, end: tblEnd };
        searchFrom = tblEnd;
    }
    throw new Error('Не удалось определить границы таблицы материалов в шаблоне КП.');
}

/** Границы ВСЕХ строк <w:tr>...</w:tr> внутри переданного фрагмента XML, по порядку. */
function getRowBoundsList(xml: string): Array<{ start: number; end: number }> {
    const trOpen = '<w:tr';
    const trClose = '</w:tr>';
    const bounds: Array<{ start: number; end: number }> = [];
    let searchFrom = 0;
    while (true) {
        const openIdx = xml.indexOf(trOpen, searchFrom);
        if (openIdx === -1) break;
        const tagEnd = xml.indexOf('>', openIdx) + 1;
        const closeIdx = xml.indexOf(trClose, tagEnd);
        if (closeIdx === -1) break;
        const rowEnd = closeIdx + trClose.length;
        bounds.push({ start: openIdx, end: rowEnd });
        searchFrom = rowEnd;
    }
    return bounds;
}

/** Границы ВСЕХ ячеек <w:tc>...</w:tc> внутри переданной строки, по порядку. */
function getCellBoundsList(rowXml: string): Array<{ start: number; end: number }> {
    const tcOpen = '<w:tc';
    const tcClose = '</w:tc>';
    const bounds: Array<{ start: number; end: number }> = [];
    let searchFrom = 0;
    while (true) {
        const openIdx = rowXml.indexOf(tcOpen, searchFrom);
        if (openIdx === -1) break;
        const tagEnd = rowXml.indexOf('>', openIdx) + 1;
        const closeIdx = rowXml.indexOf(tcClose, tagEnd);
        if (closeIdx === -1) break;
        const cellEnd = closeIdx + tcClose.length;
        bounds.push({ start: openIdx, end: cellEnd });
        searchFrom = cellEnd;
    }
    return bounds;
}

/** Индекс (0-based) ячейки, в которую попадает markerIndex, внутри ОДНОЙ строки. */
function findCellIndexAtPosition(rowXml: string, markerIndex: number): number | null {
    const bounds = getCellBoundsList(rowXml);
    for (let i = 0; i < bounds.length; i++) {
        if (markerIndex < bounds[i].end) return i;
    }
    return null;
}

/** Убирает ячейку по индексу из строки, возвращает новую строку (без изменений,
 * если индекс не найден — защитный случай на нестандартную структуру таблицы). */
function removeCellByIndex(rowXml: string, colIndex: number): string {
    const bounds = getCellBoundsList(rowXml);
    if (colIndex < 0 || colIndex >= bounds.length) return rowXml;
    const { start, end } = bounds[colIndex];
    return rowXml.slice(0, start) + rowXml.slice(end);
}

/** Увеличивает ширину ячейки (её <w:tcW w:w="...">) по индексу на addDxa твипов. */
function widenCellByIndex(rowXml: string, colIndex: number, addDxa: number): string {
    const bounds = getCellBoundsList(rowXml);
    if (colIndex < 0 || colIndex >= bounds.length) return rowXml;
    const { start, end } = bounds[colIndex];
    const cellXml = rowXml.slice(start, end);
    const newCellXml = cellXml.replace(
        /(<w:tcW\b[^>]*\bw:w=")(\d+)(")/,
        (_m, p1, p2, p3) => `${p1}${parseInt(p2, 10) + addDxa}${p3}`
    );
    return rowXml.slice(0, start) + newCellXml + rowXml.slice(end);
}

/** Убирает <w:gridCol> по индексу из <w:tblGrid> этой таблицы, возвращает новую XML
 * таблицы и реально убранную ширину (0, если колонка не найдена или ширина не задана). */
function removeGridColByIndex(tableXml: string, colIndex: number): { xml: string; removedWidth: number } {
    const gridMatch = tableXml.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
    if (!gridMatch) return { xml: tableXml, removedWidth: 0 };
    const cols = gridMatch[1].match(/<w:gridCol\b[^>]*\/>/g) || [];
    if (colIndex < 0 || colIndex >= cols.length) return { xml: tableXml, removedWidth: 0 };
    const wMatch = cols[colIndex].match(/w:w="(\d+)"/);
    const removedWidth = wMatch ? parseInt(wMatch[1], 10) : 0;
    const newCols = cols.filter((_, i) => i !== colIndex).join('');
    const newGridXml = `<w:tblGrid>${newCols}</w:tblGrid>`;
    return { xml: tableXml.replace(gridMatch[0], newGridXml), removedWidth };
}

/** Увеличивает ширину <w:gridCol> по индексу в <w:tblGrid> этой таблицы на addDxa. */
function widenGridColByIndex(tableXml: string, colIndex: number, addDxa: number): string {
    const gridMatch = tableXml.match(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/);
    if (!gridMatch) return tableXml;
    const cols = gridMatch[1].match(/<w:gridCol\b[^>]*\/>/g) || [];
    if (colIndex < 0 || colIndex >= cols.length) return tableXml;
    const newCols = cols.map((col, i) => {
        if (i !== colIndex) return col;
        return col.replace(/(w:w=")(\d+)(")/, (_m, p1, p2, p3) => `${p1}${parseInt(p2, 10) + addDxa}${p3}`);
    }).join('');
    const newGridXml = `<w:tblGrid>${newCols}</w:tblGrid>`;
    return tableXml.replace(gridMatch[0], newGridXml);
}

/**
 * Если ни у одного из выбранных материалов нет фото — убирает колонку с фото
 * ЦЕЛИКОМ из таблицы материалов: из определения ширин колонок (tblGrid), из
 * заголовка таблицы, из строки-образца и из итоговой строки — то есть из КАЖДОЙ
 * строки таблицы разом, а не только из той, что размножается на материалы.
 * Освободившуюся ширину отдаёт первой колонке ("Наименование материалов") — это
 * и есть "таблица перестраивается пошире" из требования.
 *
 * Если в шаблоне колонки с фото нет вообще (плейсхолдера {{MATERIAL_PHOTO}} не
 * нашлось в строке-образце) — ничего не делает, разбираться нечего.
 */
function removePhotoColumnIfNoPhotos(documentXml: string, sampleRowStart: number, sampleRowEnd: number): string {
    const sampleRowXml = documentXml.slice(sampleRowStart, sampleRowEnd);
    const photoMatch = buildPlaceholderRegex('MATERIAL_PHOTO').exec(sampleRowXml);
    if (!photoMatch) return documentXml;

    const colIndex = findCellIndexAtPosition(sampleRowXml, photoMatch.index);
    if (colIndex === null || colIndex === 0) return documentXml;

    const table = findTableBounds(documentXml, sampleRowStart, sampleRowEnd);
    let tableXml = documentXml.slice(table.start, table.end);

    const { xml: gridRemovedXml, removedWidth } = removeGridColByIndex(tableXml, colIndex);
    tableXml = gridRemovedXml;

    // Идём по строкам с конца — так вырезание ячейки в одной строке не сдвигает
    // ещё не обработанные индексы предыдущих строк.
    const rows = getRowBoundsList(tableXml);
    for (let i = rows.length - 1; i >= 0; i--) {
        const { start, end } = rows[i];
        let rowXml = tableXml.slice(start, end);
        rowXml = removeCellByIndex(rowXml, colIndex);
        if (removedWidth > 0) rowXml = widenCellByIndex(rowXml, 0, removedWidth);
        tableXml = tableXml.slice(0, start) + rowXml + tableXml.slice(end);
    }

    if (removedWidth > 0) {
        tableXml = widenGridColByIndex(tableXml, 0, removedWidth);
    }

    return documentXml.slice(0, table.start) + tableXml + documentXml.slice(table.end);
}

/**
 * Убирает целиком те параграфы, в которых сидит "опциональный" плейсхолдер,
 * значение которого для этой позиции пустое (чтобы в ячейке не осталась пустая
 * строка). Поиск — ТОЙ ЖЕ гибкой регуляркой, что и везде в этом файле (см.
 * buildPlaceholderRegex), а не буквальным поиском подстроки "{{KEY}}" — Word
 * нередко разбивает текст внутри фигурных скобок служебными тегами форматирования
 * (например, если плейсхолдер хоть немного переформатировали в самом шаблоне),
 * и буквальный поиск такое совпадение просто не находит — тогда пустая строка не
 * убирается, а сам плейсхолдер к тому же остаётся видимым как есть (не подставляется).
 */
function stripEmptyOptionalParagraphs(rowXml: string, replacements: Record<string, string>, optionalKeys: string[]): string {
    return rowXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
        for (const key of optionalKeys) {
            if (buildPlaceholderRegex(key).test(paragraph) && !replacements[key]) {
                return '';
            }
        }
        return paragraph;
    });
}

/**
 * Замена плейсхолдеров {{KEY}}, устойчивая к разрывам тегов MS Word. Ключи,
 * которых в конкретном шаблоне нет (например, {{ROW_UNIT}} в кирпичном шаблоне,
 * или {{QUANTITY_PER_PALLET}} в универсальном), просто не находят совпадений —
 * безопасно передавать один и тот же набор замен для обоих шаблонов.
 */
function substitutePlaceholders(xml: string, replacements: Record<string, string>): string {
    let result = xml;
    for (const [key, value] of Object.entries(replacements)) {
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

/** Реальные размеры PNG — ширина/высота лежат прямо в заголовке чанка IHDR
 * по фиксированному смещению, сразу после 8-байтовой сигнатуры PNG. */
function getPngDimensions(view: DataView): { width: number; height: number } | null {
    if (view.byteLength < 24) return null;
    if (view.getUint32(0) !== 0x89504e47) return null; // сигнатура "\x89PNG"
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
}

/** Реальные размеры JPEG — нужно пройтись по служебным маркерам файла до
 * сегмента SOFn (Start Of Frame), где и записаны истинные ширина/высота. */
function getJpegDimensions(view: DataView): { width: number; height: number } | null {
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    const len = view.byteLength;
    while (offset < len - 1) {
        if (view.getUint8(offset) !== 0xff) { offset++; continue; }
        const marker = view.getUint8(offset + 1);
        offset += 2;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 1 >= len) break;
        const segLen = view.getUint16(offset);
        const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
            if (offset + 7 >= len) break;
            const height = view.getUint16(offset + 3);
            const width = view.getUint16(offset + 5);
            return width > 0 && height > 0 ? { width, height } : null;
        }
        offset += segLen;
    }
    return null;
}

/** Определяет реальные пиксельные размеры картинки — по ним дальше вписываем её
 * в ячейку таблицы с сохранением пропорций, а не насильно квадратом. Для форматов,
 * которые не разбираем (gif/webp), возвращаем null — тогда просто используем
 * разумный запасной размер по умолчанию. */
function getImageDimensions(bytes: ArrayBuffer, mime: string): { width: number; height: number } | null {
    try {
        const view = new DataView(bytes);
        if (mime.includes('png')) return getPngDimensions(view);
        if (mime.includes('jpeg') || mime.includes('jpg')) return getJpegDimensions(view);
    } catch {
        return null;
    }
    return null;
}

/**
 * Определяет реальную ширину ячейки с {{MATERIAL_PHOTO}} прямо из разметки шаблона
 * (<w:tcW w:w="..." w:type="dxa"/> внутри охватывающей <w:tc>) — так итоговый размер
 * фото автоматически подстраивается под колонку конкретного шаблона, а не живёт
 * отдельным, никак не связанным с таблицей числом. 1 twip (dxa) = 635 EMU.
 * Возвращает null, если ширина не задана явно в твипах (например, автоширина/проценты),
 * либо если колонки с фото в этом шаблоне вообще нет (см. removePhotoColumnIfNoPhotos) —
 * тогда используется запасной фиксированный размер.
 */
function findPhotoCellWidthEmu(rowXml: string, markerIndex: number): number | null {
    const tcOpen = '<w:tc';
    const tcClose = '</w:tc>';
    let searchFrom = 0;
    while (true) {
        const openIdx = rowXml.indexOf(tcOpen, searchFrom);
        if (openIdx === -1 || openIdx > markerIndex) break;
        const tagEnd = rowXml.indexOf('>', openIdx) + 1;
        const closeIdx = rowXml.indexOf(tcClose, tagEnd);
        if (closeIdx === -1) break;
        const cellEnd = closeIdx + tcClose.length;
        if (markerIndex < cellEnd) {
            const cellXml = rowXml.slice(openIdx, cellEnd);
            const tcWTag = cellXml.match(/<w:tcW\b[^>]*\/>/);
            if (tcWTag) {
                const wMatch = tcWTag[0].match(/w:w="(\d+)"/);
                const typeMatch = tcWTag[0].match(/w:type="(\w+)"/);
                if (wMatch && (!typeMatch || typeMatch[1] === 'dxa')) {
                    return parseInt(wMatch[1], 10) * 635;
                }
            }
            return null;
        }
        searchFrom = cellEnd;
    }
    return null;
}

function extFromMime(mime: string): string {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    return 'png';
}

/**
 * Вставляет фото материала в ячейку вместо {{MATERIAL_PHOTO}} (или просто убирает
 * плейсхолдер, если фото нет или его не удалось скачать). Если колонки с фото в
 * этой строке вообще нет (её убрали в removePhotoColumnIfNoPhotos) — ничего не
 * делает вовсе: маркер просто не находится, функция тихо возвращает строку как есть.
 */
async function embedPhoto(rowXml: string, driveFileId: string | undefined, accessToken: string, index: number, zip: JSZip, maxWidthEmu: number): Promise<string> {
    const markerRegex = buildPlaceholderRegex('MATERIAL_PHOTO');

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

    // Ширина — реальная ширина ячейки из шаблона (см. findPhotoCellWidthEmu), чтобы
    // фото автоматически подстраивалось под колонку конкретного шаблона. Высоту
    // отдельно не подгоняем под строку (в docx высота строки обычно и так растёт
    // под содержимое) — только ограничиваем разумным потолком, чтобы случайно очень
    // "вытянутое" по вертикали фото не раздуло строку до абсурдных размеров.
    const MAX_H_EMU_CEILING = 1400000;
    const dims = getImageDimensions(bytes, ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
    let cx = maxWidthEmu;
    let cy = MAX_H_EMU_CEILING;
    if (dims) {
        const scale = Math.min(maxWidthEmu / dims.width, MAX_H_EMU_CEILING / dims.height);
        cx = Math.max(1, Math.round(dims.width * scale));
        cy = Math.max(1, Math.round(dims.height * scale));
    }

    const docPrId = 9000 + index;
    const drawing =
        `<w:r><w:drawing>` +
        `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
        `<wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
        `<wp:docPr id="${docPrId}" name="KPPhoto${index}"/>` +
        `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="KPPhoto${index}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
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

    const templateType: KPTemplateType = data.templateType ?? 'brick';
    const templateFile = TEMPLATE_FILE_BY_TYPE[templateType];

    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
    const response = await fetch(`${baseUrl}${templateFile}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Не удалось загрузить шаблон КП (${templateFile}). Убедитесь, что файл лежит в папке public проекта.`);
    }
    const templateArrayBuffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(templateArrayBuffer);

    const documentFile = zip.file('word/document.xml');
    if (!documentFile) throw new Error('В шаблоне КП не найден word/document.xml — файл повреждён.');
    let documentXml = await documentFile.async('text');

    // Если ни у одного выбранного материала нет фото — убираем колонку с фото
    // целиком из таблицы (заголовок + строка-образец + итоговая строка разом),
    // остальные колонки (в первую очередь "Наименование материалов") расширяются
    // на освободившееся место. См. removePhotoColumnIfNoPhotos.
    const hasAnyPhoto = data.materials.some(m => !!m.photoDriveFileId);
    if (!hasAnyPhoto) {
        const probe = findRowBounds(documentXml, 'ROW_MATERIAL_NAME');
        documentXml = removePhotoColumnIfNoPhotos(documentXml, probe.start, probe.end);
    }

    // Строку-образец ищем заново (а не переиспользуем найденную для probe выше) —
    // после возможного удаления колонки позиции внутри documentXml сдвинулись.
    const { start, end } = findRowBounds(documentXml, 'ROW_MATERIAL_NAME');
    const sampleRow = documentXml.slice(start, end);
    const before = documentXml.slice(0, start);
    const after = documentXml.slice(end);

    // Ширину ячейки под фото определяем ОДИН раз из образца строки (структура
    // ячеек одинакова для всех размноженных копий) — а не пересчитываем на
    // каждую позицию заново. Если колонки с фото в этой строке больше нет (или
    // не было изначально в этом шаблоне) — photoMarkerMatch будет null, и дальше
    // embedPhoto молча ничего не сделает для каждой позиции (см. её комментарий).
    const photoMarkerMatch = buildPlaceholderRegex('MATERIAL_PHOTO').exec(sampleRow);
    const photoCellWidthEmu = photoMarkerMatch ? findPhotoCellWidthEmu(sampleRow, photoMarkerMatch.index) : null;
    // Небольшой отступ от найденной ширины ячейки, чтобы фото не упиралось точно
    // в границу колонки (с учётом внутренних полей ячейки в Word по умолчанию).
    const photoMaxWidthEmu = photoCellWidthEmu ? Math.max(200000, photoCellWidthEmu - 100000) : 900000;

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
            ROW_UNIT: m.unit || '',
            ROW_PRICE: formatMoney(m.price),
            ROW_PRICE_METER: m.qtyPerM2 ? formatMoney(priceMeter) : '',
            ROW_QUANTITY_METER: m.quantityM2 ? formatQty(m.quantityM2) : '',
            ROW_QUANTITY: formatQty(m.quantity),
            ROW_SUM: formatMoney(m.sum),
        };

        let rowCopy = stripEmptyOptionalParagraphs(sampleRow, rowReplacements, ['ROW_CHARACTERISTICS', 'METER_QUANTITY', 'QUANTITY_PER_PALLET', 'MAUFACTURER']);
        photoIndex += 1;
        rowCopy = await embedPhoto(rowCopy, m.photoDriveFileId, data.accessToken, photoIndex, zip, photoMaxWidthEmu);
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
        KP_SELLER_LEGAL_ENTITY_INN_KPP: singleLine(data.sellerLegalEntityInnKpp),
        KP_SELLER_LEGAL_ENTITY_OGRN_OKPO: singleLine(data.sellerLegalEntityOgrnOkpo),
        KP_SELLER_LEGAL_ENTITY_BANK_DETAILS: singleLine(data.sellerLegalEntityBankDetails),
        KP_SELLER_LEGAL_ENTITY_DIRECTOR: singleLine(data.sellerLegalEntityDirector),
        KP_SELLER_LEGAL_ENTITY_DIRECTOR_PHONE: singleLine(data.sellerLegalEntityDirectorPhone),
        CURRENCY: data.currencyName || 'руб.',
        CURRENCY_NOTE: data.currencyName ? CURRENCY_PAYMENT_NOTE : '',
    };

    // Фраза про курс есть только в валютном КП — в рублёвом абзац с {{CURRENCY_NOTE}}
    // убираем целиком (не оставляем пустую строку).
    documentXml = stripEmptyOptionalParagraphs(documentXml, topLevelReplacements, ['CURRENCY_NOTE']);
    documentXml = substitutePlaceholders(documentXml, topLevelReplacements);
    zip.file('word/document.xml', documentXml);

    const footerPaths = Object.keys(zip.files).filter(p => /^word\/footer\d+\.xml$/.test(p));
    for (const footerPath of footerPaths) {
        const footerFile = zip.file(footerPath);
        if (!footerFile) continue;
        let footerXml = await footerFile.async('text');
        footerXml = stripEmptyOptionalParagraphs(footerXml, topLevelReplacements, ['CURRENCY_NOTE']);
        footerXml = substitutePlaceholders(footerXml, topLevelReplacements);
        zip.file(footerPath, footerXml);
    }

    return zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
}