import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { STATUS_COLOR } from './statuses';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  
  // If it's not a string, use existing formatDate logic to get DD.MM.YYYY
  if (typeof date !== 'string') {
    return formatDate(date);
  }

  // If it's already in DD.MM.YYYY format
  if (date.includes('.')) return date;

  // Try to parse YYYY-MM-DD
  const [y, m, d] = date.split('-');
  if (!d || !m || !y) {
    // If it's some other string format, try general parsing
    return formatDate(date);
  }
  
  return `${d}.${m}.${y}`;
}

/** Цвет заливки при 100% отгрузки — как «Завершён» в воронке на дашборде */
export const SHIPPING_PROGRESS_COMPLETE_COLOR = STATUS_COLOR.done;

export type ShippingProgressInfo = {
  shippedTotal: number;
  materialsTotal: number;
  remaining: number;
  percent: number;
  barPercent: number;
  isComplete: boolean;
};

/** Процент отгрузки: сумма quantity по отгрузкам / сумма quantity по материалам × 100 */
export function getShippingProgress(project: {
  materials?: Array<{ quantity?: number }>;
  shipments?: Array<{ quantity?: number }>;
}): ShippingProgressInfo {
  const materialsTotal = (project.materials ?? []).reduce(
    (acc, m) => acc + (Number(m.quantity) || 0),
    0
  );
  const shippedTotal = (project.shipments ?? []).reduce(
    (acc, s) => acc + (Number(s.quantity) || 0),
    0
  );
  const remaining = materialsTotal - shippedTotal;
  const percent =
    materialsTotal > 0 ? Math.round((shippedTotal * 100) / materialsTotal) : 0;
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

/** Сумма quantity в материалах проекта по названию материала */
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

/** Сумма quantity в отгрузках по материалу; при редактировании — без текущей записи + quantity с формы */
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

/**
 * Возвращает стабильный цвет для аватара пользователя.
 * Принимает любой строковый сид (предпочтительно — displayName,
 * см. UserAvatar.tsx про выбор сида).
 *
 * Палитра — 10 максимально различимых тонов, спокойных по насыщенности,
 * подходящих к бежево-охровой теме CRM. Все цвета подобраны так, чтобы:
 *   — белый текст инициалов читался (контраст >= 4.5:1, WCAG AA),
 *   — соседние оттенки имели разные H (hue), а не только разную яркость,
 *   — не было пар «почти одинаковых» (старые фуксия/пурпур/розовый и
 *     четыре оттенка оливкового убраны).
 *
 * Для сентинельных значений возвращается приглушённый серо-голубой
 * — «не назначен».
 */
export function getUserColor(seed: string | null | undefined): string {
  if (!seed) return '#7A8A9A';
  const s = seed.trim();
  if (s === '' || s === 'all' || s === 'unassigned' || s === 'system' || s === 'none' || s === 'new') {
    return '#7A8A9A';
  }

  // 10 цветов, разнесённых по цветовому кругу примерно на 36° друг от друга.
  // Порядок выстроен так, чтобы соседи по индексу гарантированно
  // отличались (если у двух людей хэши случайно дадут смежные индексы —
  // цвета всё равно будут читаемо разными).
  const colors = [
    '#B14A2E', // 1. Кирпично-красный
    '#C68A2E', // 2. Горчично-охровый
    '#6B7A2C', // 3. Оливковый
    '#2D7A4F', // 4. Изумрудно-зелёный
    '#0F7570', // 5. Тёмно-бирюзовый
    '#2C5FA8', // 6. Королевский синий
    '#5238A0', // 7. Индиго
    '#9B2D7A', // 8. Маджента
    '#7A5237', // 9. Кофейно-коричневый
    '#3D505F', // 10. Сине-графитовый
  ];

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}
