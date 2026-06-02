/**
 * generateTrustDeedDocx.ts
 *
 * Берёт оригинальный шаблон доверенности (template_dov.docx),
 * заменяет данные прямо в XML и либо загружает в Google Drive,
 * либо скачивает на компьютер.
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

const TPL = {
  issueDate:           '13.01.2026',
  expiryDate:          '20.01.2026',
  driverName:          'Порфирьев Михаил Петрович',
  stubSupplierPart1:   'ООО &quot;',
  stubSupplierPart2:   'Инностек&quot;',
  passportSeries:      '7317',
  passportNumber:      '209410',
  passportIssuedBy:    'Отделом УФМС России по Ульяновской области в Заволжском районе г.Ульяновска',
  passportIssuedDate:  '29.05.2017г.',
  supplierFull:        'ООО &quot;Инностек&quot;',
  accountRef:          'Счету №19 от 03.03.2025 г.',
  materialName:        'Пеностекольный щебень Innostek «RoofPro» биг-бэг (2 стропы) 1,3 м3',
  unit:                'Шт.',
  quantity:            '56',
};

// ID папки в Google Drive куда сохраняются все доверенности
const DRIVE_FOLDER_ID = '13JZCVB9HPU_30InOBVCqbVxcZpk3nscW';

function replaceWt(xml: string, oldText: string, newText: string): string {
  xml = xml.split(`<w:t>${oldText}</w:t>`).join(`<w:t>${newText}</w:t>`);
  xml = xml.split(`<w:t xml:space="preserve">${oldText}</w:t>`).join(`<w:t xml:space="preserve">${newText}</w:t>`);
  return xml;
}

function escapeXml(s: string): string {
  return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

export async function generateTrustDeedDocx(data: TrustDeedDocxData): Promise<Blob> {
  const templateUrl = `${import.meta.env.BASE_URL}template_dov.docx`;
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error(`Не удалось загрузить шаблон: ${templateUrl}`);
  const templateArrayBuffer = await response.arrayBuffer();

  const zip = await JSZip.loadAsync(templateArrayBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('document.xml не найден в шаблоне');

  let xml = await docFile.async('string');

  const sup = escapeXml(data.supplierName);
  const drv = escapeXml(data.driverName);
  const pib = escapeXml(data.driverPassportIssuedBy);
  const mat = escapeXml(data.materialName);
  const accRef = `Счету №${escapeXml(data.accountNumber)} от ${escapeXml(data.accountDate)} г.`;
  const pidFormatted = data.driverPassportIssuedDate
      ? (data.driverPassportIssuedDate.endsWith('г.') ? data.driverPassportIssuedDate : data.driverPassportIssuedDate + 'г.')
      : '';

  xml = replaceWt(xml, TPL.issueDate, data.issueDate);
  xml = replaceWt(xml, TPL.expiryDate, data.expiryDate);
  xml = replaceWt(xml, TPL.driverName, drv);

  xml = xml.split(`<w:t>${TPL.stubSupplierPart1}</w:t>`).join('<w:t></w:t>');
  xml = xml.split(`<w:t xml:space="preserve">${TPL.stubSupplierPart1}</w:t>`).join('<w:t xml:space="preserve"></w:t>');
  xml = xml.split(`<w:t>${TPL.stubSupplierPart2}</w:t>`).join(`<w:t>${sup}</w:t>`);
  xml = xml.split(`<w:t xml:space="preserve">${TPL.stubSupplierPart2}</w:t>`).join(`<w:t xml:space="preserve">${sup}</w:t>`);

  xml = xml.replace('<w:t>1</w:t>', `<w:t>${escapeXml(data.number)}</w:t>`);

  xml = replaceWt(xml, TPL.passportSeries, escapeXml(data.driverPassportSeries));
  xml = replaceWt(xml, TPL.passportNumber, escapeXml(data.driverPassportNumber));
  xml = replaceWt(xml, TPL.passportIssuedBy, pib);
  xml = xml.split(TPL.passportIssuedBy).join(pib);
  xml = replaceWt(xml, TPL.passportIssuedDate, pidFormatted);

  xml = xml.split(`<w:t>${TPL.supplierFull}</w:t>`).join(`<w:t>${sup}</w:t>`);
  xml = xml.split(`<w:t xml:space="preserve">${TPL.supplierFull}</w:t>`).join(`<w:t xml:space="preserve">${sup}</w:t>`);

  xml = replaceWt(xml, TPL.accountRef, accRef);
  xml = replaceWt(xml, TPL.materialName, mat);
  xml = replaceWt(xml, TPL.unit, escapeXml(data.materialUnit));
  xml = replaceWt(xml, TPL.quantity, escapeXml(data.quantityText || data.quantity));

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
