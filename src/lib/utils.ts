import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { STATUS_COLOR } from './statuses';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Число с разделителем разрядов пробелом: 12 400 000 */
export function formatAmountGrouped(amount: number): string {
  if (!amount) return '';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
      .format(amount)
      .replace(/\u00a0/g, ' ');
}

export function parseGroupedAmount(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits);
}

export function formatCurrency(amount: number, short: boolean = false) {
  if (short) {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(1).replace('.0', '')} млн\u00a0₽`;
    }
    if (amount >= 1000) {
      return `${(amount / 1000).toFixed(0)} тыс\u00a0₽`;
    }
  }
  return new Intl.NumberFormat('ru-RU', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount).replace(/\s/g, '\u00a0') + '\u00a0₽';
}

export function formatDate(date: any) {
  if (!date) return '';
  let d: Date;
  if (typeof date === 'string') d = new Date(date);
  else if (date.toDate && typeof date.toDate === 'function') d = date.toDate();
  else if (date instanceof Date) d = date;
  else return '';

  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '.');
}

export function formatFullDate(date: any) {
  if (!date) return '';
  let d: Date;
  if (typeof date === 'string') d = new Date(date);
  else if (date.toDate && typeof date.toDate === 'function') d = date.toDate();
  else if (date instanceof Date) d = date;
  else return '';

  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).replace(' г.', '');
}

export function formatDateForInput(date: any) {
  if (!date) return '';
  if (typeof date === 'string') return date;
  if (date.toDate && typeof date.toDate === 'function') return date.toDate().toISOString().split('T')[0];
  if (date instanceof Date) return date.toISOString().split('T')[0];
  return '';
}

export function formatDateToDisplay(date: any) {
  if (!date) return '';

  if (typeof date !== 'string') {
    return formatDate(date);
  }

  if (date.includes('.')) return date;

  const [y, m, d] = date.split('-');
  if (!d || !m || !y) {
    return formatDate(date);
  }

  return `${d}.${m}.${y}`;
}

/** Цвет заливки при 100% отгрузки */
export const SHIPPING_PROGRESS_COMPLETE_COLOR = STATUS_COLOR.done;

export type ShippingProgressInfo = {
  shippedTotal: number;
  materialsTotal: number;
  remaining: number;
  percent: number;
  barPercent: number;
  isComplete: boolean;
};

/** Процент отгрузки: считаем quantity из доверенностей привязанных к отгрузкам */
export function getShippingProgress(
    project: {
      materials?: Array<{ quantity?: number }>;
      shipments?: Array<{ poaNumber?: string; trustDeedId?: string; quantity?: number }>;
    },
    trustDeeds?: Array<{ number?: string; id?: string; quantity?: number }>
): ShippingProgressInfo {
  const materialsTotal = (project.materials ?? []).reduce(
      (acc, m) => acc + (Number(m.quantity) || 0),
      0
  );

  let shippedTotal: number;
  if (trustDeeds && trustDeeds.length > 0) {
    shippedTotal = (project.shipments ?? []).reduce((acc, s) => {
      const deed = s.poaNumber
          ? trustDeeds.find(d => d.number === s.poaNumber)
          : s.trustDeedId
              ? trustDeeds.find(d => d.id === s.trustDeedId)
              : null;
      return acc + (Number(deed?.quantity) || Number(s.quantity) || 0);
    }, 0);
  } else {
    shippedTotal = (project.shipments ?? []).reduce(
        (acc, s) => acc + (Number(s.quantity) || 0),
        0
    );
  }

  const remaining = materialsTotal - shippedTotal;
  const percent = materialsTotal > 0 ? Math.round((shippedTotal * 100) / materialsTotal) : 0;
  const barPercent = Math.min(Math.max(percent, 0), 100);
  const isComplete = materialsTotal > 0 && remaining <= 0;

  return { shippedTotal, materialsTotal, remaining, percent, barPercent, isComplete };
}

export function formatShippingQuantity(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

export function formatShippingProgressLabel(info: ShippingProgressInfo): string {
  return `${info.percent}% (осталось ${formatShippingQuantity(info.remaining)} из ${formatShippingQuantity(info.materialsTotal)})`;
}

function normalizeMaterialKey(name: string): string {
  return name.trim().toLowerCase();
}

export function getMaterialPlannedQuantity(
    materials: Array<{ materialName?: string; quantity?: number }> | undefined,
    materialName: string
): number {
  const key = normalizeMaterialKey(materialName);
  if (!key) return 0;
  return (materials ?? [])
      .filter((m) => normalizeMaterialKey(m.materialName || '') === key)
      .reduce((acc, m) => acc + (Number(m.quantity) || 0), 0);
}

export function getMaterialShippedQuantity(
    shipments: Array<{ id?: string; materialName?: string; quantity?: number }> | undefined,
    materialName: string,
    options?: { excludeShipmentId?: string; formQuantity?: number }
): number {
  const key = normalizeMaterialKey(materialName);
  const formQty = Number(options?.formQuantity) || 0;
  if (!key) return formQty;

  const fromOthers = (shipments ?? [])
      .filter((s) => {
        if (options?.excludeShipmentId && s.id === options.excludeShipmentId) return false;
        return normalizeMaterialKey(s.materialName || '') === key;
      })
      .reduce((acc, s) => acc + (Number(s.quantity) || 0), 0);

  return fromOthers + formQty;
}

export type ShipmentQuantityValidation = {
  ok: boolean;
  message?: string;
  planned: number;
  shipped: number;
};

export function validateShipmentMaterialQuantity(params: {
  materials?: Array<{ materialName?: string; quantity?: number }>;
  shipments?: Array<{ id?: string; materialName?: string; quantity?: number }>;
  materialName: string;
  quantity: number;
  editingShipmentId?: string | null;
}): ShipmentQuantityValidation {
  const materialName = params.materialName?.trim() || '';
  const quantity = Number(params.quantity) || 0;
  const planned = getMaterialPlannedQuantity(params.materials, materialName);
  const shipped = getMaterialShippedQuantity(params.shipments, materialName, {
    excludeShipmentId: params.editingShipmentId ?? undefined,
    formQuantity: quantity,
  });

  if (!materialName) {
    return { ok: true, planned, shipped };
  }

  if (shipped > planned) {
    return {
      ok: false,
      planned,
      shipped,
      message: `По материалу «${materialName}» отгружено ${formatShippingQuantity(shipped)} — больше, чем в материалах проекта (${formatShippingQuantity(planned)}). Уменьшите количество.`,
    };
  }

  return { ok: true, planned, shipped };
}

import { auth } from './firebase';

export function getInitials(name: string) {
  if (!name || name.trim() === '' || name === '—') return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export function getUserColor(seed: string | null | undefined): string {
  if (!seed) return '#7A8A9A';
  const s = seed.trim();
  if (s === '' || s === 'all' || s === 'unassigned' || s === 'system' || s === 'none' || s === 'new') {
    return '#7A8A9A';
  }

  const colors = [
    '#B14A2E',
    '#C68A2E',
    '#6B7A2C',
    '#2D7A4F',
    '#0F7570',
    '#2C5FA8',
    '#5238A0',
    '#9B2D7A',
    '#7A5237',
    '#3D505F',
  ];

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}