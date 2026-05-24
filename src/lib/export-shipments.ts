import * as XLSX from 'xlsx';
import type { Shipment } from '../types';
import { formatDate, formatDateToDisplay } from './utils';

function getDocTypeLabel(docType: Shipment['docType']): string {
  return docType === 'upd' ? 'УПД' : 'Акт/ МХ-3';
}

function getScanLabel(scan: Shipment['scanSentToAccounting']): string {
  if (scan === true || scan === 'yes') return 'Да';
  return 'Нет';
}

function formatPoaNumber(s: Shipment): string {
  const number = s.poaNumber?.trim();
  const date = s.poaDate ? formatDateToDisplay(s.poaDate) : '';
  if (number && date) return `${number} от ${date}`;
  if (number) return number;
  if (date) return `от ${date}`;
  return '';
}

const EXPORT_HEADERS = [
  'Тип документа',
  'Входящий',
  'Исходящий',
  'Отправлен скан в СМУ',
  '№ доверенности',
  '№ а/м',
  'Дата загрузки',
  'Дата выгрузки',
  'ФИО водителя',
  'Материал',
  'Кол-во',
  'Стоимость перевозки',
  'Общая стоимость',
  'Перевозчик',
  'Счет от перевозчика',
  'УПД перевозчика',
] as const;

function shipmentToRow(s: Shipment): (string | number)[] {
  return [
    getDocTypeLabel(s.docType),
    s.incomingUPD || '',
    s.outgoingUPD || '',
    getScanLabel(s.scanSentToAccounting),
    formatPoaNumber(s),
    s.autoNumber || '',
    formatDate(s.loadingDate) || '',
    formatDate(s.unloadingDate) || '',
    s.driverName || '',
    s.materialName || '',
    s.quantity ?? '',
    s.carryingCost ?? '',
    s.totalCarryingCost ?? '',
    s.carrierName || '',
    s.carrierInvoice || '',
    s.carrierUPD || '',
  ];
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80) || 'проект';
}

/** Скачивает .xlsx со всеми строками и колонками таблицы отгрузок */
export function exportShipmentsToExcel(shipments: Shipment[], projectName: string): void {
  if (shipments.length === 0) return;

  const rows = shipments.map(shipmentToRow);
  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS.slice(), ...rows]);

  const colWidths = EXPORT_HEADERS.map((header, colIndex) => {
    const maxLen = Math.max(
      header.length,
      ...rows.map((row) => String(row[colIndex] ?? '').length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Отгрузки');

  const fileName = `Отгрузки_${sanitizeFileName(projectName)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
