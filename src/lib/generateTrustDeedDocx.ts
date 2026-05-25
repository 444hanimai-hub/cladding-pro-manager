/**
 * generateTrustDeedDocx.ts
 *
 * Берёт оригинальный шаблон доверенности (template_dov.docx),
 * заменяет данные прямо в XML и отдаёт Blob для скачивания.
 *
 * Зависимость: jszip (npm install jszip)
 * Положи template_dov.docx в папку public/ проекта.
 */

import JSZip from 'jszip';

export interface TrustDeedDocxData {
  number: string;
  issueDate: string;            // DD.MM.YYYY
  expiryDate: string;           // DD.MM.YYYY
  driverName: string;
  driverPosition?: string;
  driverPassportSeries: string;
  driverPassportNumber: string;
  driverPassportIssuedBy: string;
  driverPassportIssuedDate: string; // DD.MM.YYYY
  supplierName: string;
  accountNumber: string;
  accountDate: string;          // DD.MM.YYYY
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

  // Корешок: даты и водитель
  xml = replaceWt(xml, TPL.issueDate, data.issueDate);
  xml = replaceWt(xml, TPL.expiryDate, data.expiryDate);
  xml = replaceWt(xml, TPL.driverName, drv);

  // Поставщик в корешке (2 run-а: 'ООО "' + 'Инностек"')
  xml = xml.split(`<w:t>${TPL.stubSupplierPart1}</w:t>`).join('<w:t></w:t>');
  xml = xml.split(`<w:t xml:space="preserve">${TPL.stubSupplierPart1}</w:t>`).join('<w:t xml:space="preserve"></w:t>');
  xml = xml.split(`<w:t>${TPL.stubSupplierPart2}</w:t>`).join(`<w:t>${sup}</w:t>`);
  xml = xml.split(`<w:t xml:space="preserve">${TPL.stubSupplierPart2}</w:t>`).join(`<w:t xml:space="preserve">${sup}</w:t>`);

  // Номер доверенности (первое <w:t>1</w:t>)
  xml = xml.replace('<w:t>1</w:t>', `<w:t>${escapeXml(data.number)}</w:t>`);

  // Паспорт
  xml = replaceWt(xml, TPL.passportSeries, escapeXml(data.driverPassportSeries));
  xml = replaceWt(xml, TPL.passportNumber, escapeXml(data.driverPassportNumber));
  xml = replaceWt(xml, TPL.passportIssuedBy, pib);
  xml = xml.split(TPL.passportIssuedBy).join(pib);
  xml = replaceWt(xml, TPL.passportIssuedDate, pidFormatted);

  // Поставщик (основная часть)
  xml = xml.split(`<w:t>${TPL.supplierFull}</w:t>`).join(`<w:t>${sup}</w:t>`);
  xml = xml.split(`<w:t xml:space="preserve">${TPL.supplierFull}</w:t>`).join(`<w:t xml:space="preserve">${sup}</w:t>`);

  // Счёт
  xml = replaceWt(xml, TPL.accountRef, accRef);

  // Материал, единица, количество
  xml = replaceWt(xml, TPL.materialName, mat);
  xml = replaceWt(xml, TPL.unit, escapeXml(data.materialUnit));
  xml = replaceWt(xml, TPL.quantity, escapeXml(data.quantityText || data.quantity));

  zip.file('word/document.xml', xml);

  return await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
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
