/**
 * materialCurrency.ts
 *
 * Расчёты "валютных" полей материала для режима "КП в валюте". Это ИНФОРМАЦИОННЫЕ
 * цифры только для печатной формы КП — вся смета (закуп, продажа, услуги, маржа,
 * налоги, плановые/фактические расходы) считается в рублях по lib/materialFinance.ts
 * и валютой никак не затрагивается. Поэтому логика лежит в отдельном файле, а не
 * внутри calcMaterial — чтобы случайно не смешать валюту с рублёвой математикой.
 *
 * Что хранится в материале (см. types.ts): цена закупа в валюте (необязательная —
 * закупить могут в рублях) и цена ПРОДАЖИ в валюте (обязательная при включённом
 * режиме). Цена продажи в валюте может быть подставлена автоматически (см.
 * autoSalePriceCurrency) и затем исправлена вручную — правка вручную % накрутки
 * НЕ меняет, поэтому это поле хранится, а не вычисляется на лету.
 *
 * Суммы в валюте — производные, на лету, не хранятся: кол-во × цена.
 */

import type { ProjectMaterial } from '../types';
import { priceFromMarkup } from './materialFinance';

export interface MaterialCurrencyCalc {
    /** Кол-во × цена закупа в валюте; null, пока цена закупа в валюте не введена. */
    purchaseSumCurrency: number | null;
    /** Кол-во × цена продажи в валюте; null, пока цена продажи в валюте не заполнена. */
    saleSumCurrency: number | null;
}

export function calcMaterialCurrency(
    m: Pick<ProjectMaterial, 'quantity' | 'purchasePriceCurrency' | 'salePriceCurrency'>
): MaterialCurrencyCalc {
    const quantity = m.quantity || 0;
    const purchasePrice = m.purchasePriceCurrency || 0;
    const salePrice = m.salePriceCurrency || 0;
    return {
        purchaseSumCurrency: purchasePrice ? quantity * purchasePrice : null,
        saleSumCurrency: salePrice ? quantity * salePrice : null,
    };
}

/**
 * Автоматическая цена продажи в валюте: цена закупа в валюте с накруткой — та же
 * формула, что и в рублях (priceFromMarkup: цена × (1 + %накрутки/100)), округлена
 * до копеек/центов. Считается ТОЛЬКО если выполнены оба условия: цена закупа в
 * валюте заполнена И % накрутки определён (markupPercent !== null). Иначе null —
 * тогда цена продажи в валюте не подставляется, её вводят вручную.
 */
export function autoSalePriceCurrency(
    purchasePriceCurrency: number | undefined,
    markupPercent: number | null
): number | null {
    if (!purchasePriceCurrency || markupPercent === null) return null;
    return Math.round(priceFromMarkup(purchasePriceCurrency, markupPercent) * 100) / 100;
}