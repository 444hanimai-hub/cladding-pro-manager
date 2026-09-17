/**
 * generateTrustDeedDocx.ts
 *
 * Берёт шаблон доверенности (template_dov.docx), в котором переменные значения
 * обозначены плейсхолдерами вида {{NUMBER}}, {{DRIVER_NAME}} и т.п.,
 * заменяет их реальными данными прямо в XML и либо загружает результат
 * в Google Drive, либо отдаёт на скачивание.
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
}

// ID папки в Google Drive куда сохраняются все доверенности
const DRIVE_FOLDER_ID = '13JZCVB9HPU_30InOBVCqbVxcZpk3nscW';

function escapeXml(s: string): string {
  return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

/**
 * Заменяет все вхождения плейсхолдера {{KEY}} на значение в XML документа.
 * Плейсхолдер в шаблоне лежит одним целым текстовым узлом <w:t>, поэтому
 * достаточно простой строковой замены — без учёта форматирования/разбитых runs.
 */
function replacePlaceholder(xml: string, key: string, value: string): string {
  const placeholder = `{{${key}}}`;
  return xml.split(placeholder).join(value);
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

/**
 * Загружает docx в Google Drive в папку доверенностей.
 * Возвращает ссылку на документ в Google Drive и открывает её в новой вкладке.
 */
export async function uploadTrustDeedToDrive(
    blob: Blob,
    filename: string,
    accessToken: string
): Promise<string> {
  const metadata = {
    name: filename,
    parents: [DRIVE_FOLDER_ID],
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ошибка загрузки в Google Drive: ${err}`);
  }

  const result = await response.json();
  const link = result.webViewLink as string;

  // Открываем документ в новой вкладке
  window.open(link, '_blank');

  return link;
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