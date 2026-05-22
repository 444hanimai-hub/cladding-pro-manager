import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
