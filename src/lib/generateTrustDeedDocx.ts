/**
 * generateTrustDeedDocx.ts
 *
 * Берёт шаблон доверенности (template_dov.docx), в котором переменные значения
 * обозначены плейсхолдерами вида {{NUMBER}}, {{DRIVER_NAME}} и т.п.,
 * заменяет их реальными данными прямо в XML и либо загружает результат
 * в Google Drive, либо отдаёт на скачивание.
 *
 * Реквизиты организации (юр. лица проекта — "Юр. лицо для продажи") подставляются
 * плейсхолдерами COMPANY_NAME, COMPANY_ADDRESS, COMPANY_INN_KPP, COMPANY_OGRN_OKPO,
 * COMPANY_BANK_DETAILS, COMPANY_DIRECTOR, COMPANY_DIRECTOR_SHORT ("Фамилия И.О.") и
 * COMPANY_DIRECTOR_PHONE. Файл самодостаточный: от генератора КП не зависит.
 */

import JSZip from 'jszip';

export interface TrustDeedDocxData {
  number: string;
  issueDate: string;
  expiryDate: string;
  driverName: string;
  driverPosition?: string;
  driverPassportSeries: string;
  driverPassportNumber: string;
  driverPassportIssuedBy: string;
  driverPassportIssuedDate: string;
  supplierName: string;
  accountNumber: string;
  accountDate: string;
  materialName: string;
  materialUnit: string;
  quantity: string;
  quantityText: string;
  headName?: string;
  chiefAccountantName?: string;
  organization?: string;
  bankAccount?: string;
  bankName?: string;

  // ── Реквизиты юр. лица проекта (из карточки компании в справочнике) ──
  // Все необязательные: если не заполнены — на месте плейсхолдера будет пусто.
  companyName?: string;
  companyAddress?: string;
  companyInnKpp?: string;
  companyOgrnOkpo?: string;
  /** Расчётный счёт, банк, к/с, БИК — одной строкой (многострочное поле склеивается). */
  companyBankDetails?: string;
  /** ФИО генерального директора целиком ("Фамилия Имя Отчество"); сокращённая форма
   * "Фамилия И.О." для плейсхолдера COMPANY_DIRECTOR_SHORT вычисляется автоматически. */
  companyDirector?: string;
  companyDirectorPhone?: string;
}

// ID папки в Google Drive куда сохраняются все доверенности.
// Значение по умолчанию — боевая папка. Для локальной разработки её можно подменить своей
// тестовой через VITE_DRIVE_TRUST_DEEDS_FOLDER_ID в .env.development.local (см. env.example).
const DRIVE_FOLDER_ID: string =
    import.meta.env?.VITE_DRIVE_TRUST_DEEDS_FOLDER_ID || '1Qhy4yjDhq5dcGW4A-Ir4SMjE8C3MNapL';

function escapeXml(s: string): string {
  return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

/**
 * Значение реквизита одной строкой. Перевод строки внутри обычного текста Word не является
 * переносом, поэтому если в карточке компании в многострочном поле (например, "Счёт") нажали
 * Enter — переводы строк заменяем на пробел. У однострочных значений ничего не меняется.
 */
function singleLine(value?: string): string {
  return (value || '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

/**
 * Заменяет все вхождения плейсхолдера {{KEY}} на значение в XML документа.
 *
 * Поиск устойчив к разрывам: Word нередко разбивает набранный плейсхолдер служебными
 * тегами (<w:proofErr>, смена форматирования и т.п.) — тогда простой поиск строки
 * "{{KEY}}" его не находит. Поэтому между любыми двумя символами допускаем XML-теги
 * (та же логика, что и в КП). Если плейсхолдер лежит целым куском — работает как раньше.
 * Значение подставляем функцией, а не строкой — иначе символы вроде "$&" в значении
 * (например, в названии компании) трактовались бы как спецпоследовательности замены.
 */
function replacePlaceholder(xml: string, key: string, value: string): string {
  const pattern = key
      .split('')
      .map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('(?:<[^>]+>)*');
  const regex = new RegExp(`\\{\\{(?:<[^>]+>)*${pattern}(?:<[^>]+>)*\\}\\}`, 'g');
  return xml.replace(regex, () => value);
}

/**
 * Сокращает ФИО до формы для подписи: "Семенова Диляра Файзиевна" → "Семенова Д.Ф.".
 * Ожидается запись "Фамилия Имя Отчество" в именительном падеже. Без отчества получится
 * "Фамилия И."; одно слово возвращается как есть. Двойные имена/фамилии через дефис
 * обрабатываются ("Анна-Мария" → "А.-М."). Уже сокращённая запись ("Семенова Д.Ф.",
 * "Семенова Д. Ф.") остаётся как есть, без потери инициалов.
 * Не склоняет по падежам и не понимает отчества из двух слов ("Ахмед оглы") — для таких
 * случаев нужно отдельное поле с готовой записью.
 */
export function shortenPersonName(fullName?: string): string {
  const tokens = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0];
  const [surname, ...rest] = tokens;
  const initials = rest
      .map(token => {
        // уже инициал(ы) с точкой ("Д." или "Д.Ф.") — оставляем как есть
        if (token.includes('.')) return token;
        return token
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + '.')
            .join('-');
      })
      .join('');
  return `${surname} ${initials}`;
}

/**
 * Собирает значение для плейсхолдера {{ACCOUNT_REF}} из отдельных полей БД.
 * Статичный текст ("Счету №", "от", "г.") зашит в код, переменные части —
 * номер счёта и дата счёта — подставляются из данных.
 *
 * Пример: accountNumber="19", accountDate="03.03.2025" → "Счету №19 от 03.03.2025 г."
 */
function buildAccountRef(accountNumber: string, accountDate: string): string {
  return `Счету №${accountNumber} от ${accountDate} г.`;
}

export async function generateTrustDeedDocx(data: TrustDeedDocxData): Promise<Blob> {
  // Принудительно обходим кэш: cache: 'no-store' запрещает браузеру использовать кэш для
  // этого запроса, а параметр ?v=... — дополнительная защита на случай промежуточного
  // кэширующего слоя (CDN/прокси хостинга), который может игнорировать заголовки fetch.
  const templateUrl = `${import.meta.env.BASE_URL}template_dov.docx?v=${Date.now()}`;
  const response = await fetch(templateUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Не удалось загрузить шаблон: ${templateUrl}`);
  const templateArrayBuffer = await response.arrayBuffer();

  const zip = await JSZip.loadAsync(templateArrayBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('document.xml не найден в шаблоне');

  let xml = await docFile.async('string');

  const accountRef = buildAccountRef(
      escapeXml(data.accountNumber),
      escapeXml(data.accountDate)
  );

  const pidFormatted = data.driverPassportIssuedDate
      ? (data.driverPassportIssuedDate.endsWith('г.')
          ? data.driverPassportIssuedDate
          : data.driverPassportIssuedDate + 'г.')
      : '';

  const replacements: Record<string, string> = {
    NUMBER: escapeXml(data.number),
    ISSUE_DATE: escapeXml(data.issueDate),
    EXPIRY_DATE: escapeXml(data.expiryDate),
    DRIVER_NAME: escapeXml(data.driverName),
    SUPPLIER_NAME: escapeXml(data.supplierName),
    PASSPORT_SERIES: escapeXml(data.driverPassportSeries),
    PASSPORT_NUMBER: escapeXml(data.driverPassportNumber),
    PASSPORT_ISSUED_BY: escapeXml(data.driverPassportIssuedBy),
    PASSPORT_ISSUED_DATE: escapeXml(pidFormatted),
    ACCOUNT_REF: accountRef,
    MATERIAL_NAME: escapeXml(data.materialName),
    MATERIAL_UNIT: escapeXml(data.materialUnit),
    QUANTITY: escapeXml(data.quantityText || data.quantity),

    // Реквизиты юр. лица проекта. Многострочные значения (поле "Счёт") склеиваем в одну
    // строку — перевод строки внутри обычного текста Word не является переносом.
    COMPANY_NAME: escapeXml(singleLine(data.companyName)),
    COMPANY_ADDRESS: escapeXml(singleLine(data.companyAddress)),
    COMPANY_INN_KPP: escapeXml(singleLine(data.companyInnKpp)),
    COMPANY_OGRN_OKPO: escapeXml(singleLine(data.companyOgrnOkpo)),
    COMPANY_BANK_DETAILS: escapeXml(singleLine(data.companyBankDetails)),
    COMPANY_DIRECTOR: escapeXml(singleLine(data.companyDirector)),
    COMPANY_DIRECTOR_SHORT: escapeXml(shortenPersonName(singleLine(data.companyDirector))),
    COMPANY_DIRECTOR_PHONE: escapeXml(singleLine(data.companyDirectorPhone)),
  };

  for (const [key, value] of Object.entries(replacements)) {
    xml = replacePlaceholder(xml, key, value);
  }

  zip.file('word/document.xml', xml);

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export interface DriveUploadResult {
  link: string;
  fileId: string;
}

/**
 * Проверяет, существует ли файл с данным ID на Google Drive прямо сейчас (не был ли
 * удалён/перемещён в корзину вручную). Нужна, чтобы не спрашивать пользователя
 * "заменить существующий файл?", когда файла на самом деле уже нет — иначе вопрос
 * выглядит как ошибка (мы бы полагались только на сохранённый в Firestore driveFileId,
 * который в этом случае "осиротел" и не отражает реальное состояние Диска).
 */
export async function driveFileExists(fileId: string, accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,trashed`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) return false; // 404 и т.п. — считаем, что файла нет
    const data = await response.json();
    // Файл, перемещённый в корзину, для наших целей тоже считаем отсутствующим —
    // пользователь явно не ожидает, что мы будем "заменять" то, что он удалил.
    return !data.trashed;
  } catch {
    return false;
  }
}

/**
 * Загружает docx в Google Drive в папку доверенностей.
 *
 * Если передан existingFileId — ОБНОВЛЯЕТ содержимое уже существующего файла
 * (PATCH), а не создаёт новый: так при повторной печати одной и той же
 * доверенности на Drive не накапливаются дубликаты. Вызывающий код должен
 * сохранить fileId из результата (в поле TrustDeed.driveFileId), чтобы в
 * следующий раз снова передать его сюда.
 *
 * Если existingFileId не передан — создаёт новый файл (POST), как раньше.
 * Если по существующему fileId Drive отвечает 404 (файл удалили вручную) —
 * автоматически создаёт новый файл заново, чтобы печать не ломалась.
 *
 * Возвращает ссылку на документ и его fileId; открывает документ в новой вкладке.
 */
export async function uploadTrustDeedToDrive(
    blob: Blob,
    filename: string,
    accessToken: string,
    existingFileId?: string
): Promise<DriveUploadResult> {
  const metadata: Record<string, unknown> = {
    name: filename,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  // parents имеет смысл только при создании — при обновлении (PATCH) Drive API v3
  // игнорирует это поле в теле запроса (для переноса между папками нужны отдельные
  // query-параметры addParents/removeParents, которые нам здесь не требуются).
  if (!existingFileId) {
    metadata.parents = [DRIVE_FOLDER_ID];
  }

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,webViewLink`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';

  const response = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) {
    // Файл, на который мы ссылались, кто-то удалил вручную с Google Drive —
    // не ломаем печать, а создаём новый файл заново.
    if (existingFileId && response.status === 404) {
      return uploadTrustDeedToDrive(blob, filename, accessToken, undefined);
    }
    const err = await response.text();
    throw new Error(`Ошибка загрузки в Google Drive: ${err}`);
  }

  const result = await response.json();
  const link = result.webViewLink as string;
  const fileId = result.id as string;

  // Открываем документ в новой вкладке
  window.open(link, '_blank');

  return { link, fileId };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}