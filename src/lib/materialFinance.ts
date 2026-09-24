/**
 * materialFinance.ts
 *
 * Все формулы расчёта позиции сметы (материал проекта) — закуп, продажа,
 * услуги (дизайнер/ГенПодрядчик/транспорт), маржа и НДС к уплате.
 *
 * Единая точка правды: таблица во вкладке «Материалы», правая панель с
 * деталями и модалка добавления/редактирования используют РОВНО эти функции,
 * чтобы цифры нигде не могли разъехаться между собой.
 *
 * Все ставки НДС хранятся и вводятся как целое число (22), а не дробь (0,22) —
 * так зафиксировано в ТЗ, поэтому формула выделения налога из суммы:
 *   НДС = Сумма × ставка ÷ (100 + ставка)
 *
 * % накрутки нигде не хранится как отдельное поле — он всегда пересчитывается
 * из purchasePrice/salePrice по требованию (для отображения), а связь
 * "% накрутки ↔ цена продажи" на форме реализована как двусторонний пересчёт
 * по потере фокуса поля (см. компонент формы), а не при каждом нажатии клавиши.
 */

import type { ProjectMaterial } from '../types';

/** Выделяет сумму НДС из суммы, уже включающей налог по данной ставке. */
export function extractVat(sumWithVat: number, vatPercent: number): number {
    if (!sumWithVat || !vatPercent) return 0;
    return (sumWithVat * vatPercent) / (100 + vatPercent);
}

/**
 * % накрутки = (цена продажи − цена закупа) × 100 / цена закупа.
 * null, если цена закупа ИЛИ цена продажи ещё не заданы — поле должно
 * оставаться пустым, пока пользователь не введёт обе цены (иначе при пустой
 * цене продажи формула считала бы её нулём и показывала бы ложные "-100%").
 */
export function getMarkupPercent(purchasePrice: number, salePrice: number): number | null {
    if (!purchasePrice || !salePrice) return null;
    return ((salePrice - purchasePrice) * 100) / purchasePrice;
}

/** Цена продажи из % накрутки: цена закупа × (1 + %/100). */
export function priceFromMarkup(purchasePrice: number, markupPercent: number): number {
    return purchasePrice * (1 + markupPercent / 100);
}

export interface MaterialCalc {
    // Закуп
    purchaseSum: number;
    purchaseVatAmount: number;
    // Продажа
    markupPercent: number | null;
    saleSum: number;
    saleVatAmount: number;
    // Услуги
    designerSum: number;
    designerVatAmount: number;
    gcSum: number;
    gcVatAmount: number;
    transportVatAmount: number;
    // Итоги
    marginExVat: number;
    marginExVatPercent: number | null;
    vatPayable: number;
    marginIncVat: number;
    marginIncVatPercent: number | null;
}

/**
 * Полный расчёт по одной позиции сметы — используется и в таблице, и в
 * правой панели, и в модалке (там же, где считаются промежуточные суммы
 * "серых" readonly-полей формы).
 */
export function calcMaterial(m: Pick<ProjectMaterial,
    'quantity' | 'purchasePrice' | 'purchaseVatPercent' |
    'salePrice' | 'saleVatPercent' |
    'designerPercent' | 'designerVatPercent' |
    'gcPercent' | 'gcVatPercent' |
    'transportAmount' | 'transportVatPercent'>): MaterialCalc {
    const quantity = m.quantity || 0;
    const purchasePrice = m.purchasePrice || 0;
    const salePrice = m.salePrice || 0;

    const purchaseSum = quantity * purchasePrice;
    const purchaseVatAmount = extractVat(purchaseSum, m.purchaseVatPercent);

    const markupPercent = getMarkupPercent(purchasePrice, salePrice);

    const saleSum = quantity * salePrice;
    const saleVatAmount = extractVat(saleSum, m.saleVatPercent);

    const designerSum = ((m.designerPercent || 0) / 100) * saleSum;
    const designerVatAmount = extractVat(designerSum, m.designerVatPercent);

    const gcSum = ((m.gcPercent || 0) / 100) * saleSum;
    const gcVatAmount = extractVat(gcSum, m.gcVatPercent);

    const transportAmount = m.transportAmount || 0;
    const transportVatAmount = extractVat(transportAmount, m.transportVatPercent);

    // Маржа без учёта НДС: НДС к уплате в этой строке ещё не участвует
    // (см. пояснение заказчика: "без учёта" = его не учитывали в расчёте этого поля,
    // а не "очищено от НДС").
    const marginExVat = saleSum - purchaseSum - designerSum - gcSum - transportAmount;
    const marginExVatPercent = saleSum ? (marginExVat * 100) / saleSum : null;

    const vatPayable = saleVatAmount - purchaseVatAmount - designerVatAmount - gcVatAmount - transportVatAmount;

    const marginIncVat = marginExVat - vatPayable;
    const marginIncVatPercent = saleSum ? (marginIncVat * 100) / saleSum : null;

    return {
        purchaseSum,
        purchaseVatAmount,
        markupPercent,
        saleSum,
        saleVatAmount,
        designerSum,
        designerVatAmount,
        gcSum,
        gcVatAmount,
        transportVatAmount,
        marginExVat,
        marginExVatPercent,
        vatPayable,
        marginIncVat,
        marginIncVatPercent,
    };
}

export interface ProjectMaterialsTotals {
    purchaseSum: number;
    saleSum: number;
    marginIncVat: number;
    marginIncVatPercent: number | null;
    vatPayable: number;
}

/**
 * Итоги по проекту (строка "Итого по проекту" в таблице материалов):
 * маржа — сумма маржи "с учётом НДС" по каждой позиции (подтверждено заказчиком),
 * процент маржи — средневзвешенный по сумме продаж (не среднее арифметическое по строкам),
 * налог к уплате — просто сумма НДС к уплате по каждой позиции.
 */
export function calcProjectMaterialsTotals(materials: ProjectMaterial[]): ProjectMaterialsTotals {
    let purchaseSum = 0;
    let saleSum = 0;
    let marginIncVat = 0;
    let vatPayable = 0;

    for (const m of materials) {
        const calc = calcMaterial(m);
        purchaseSum += calc.purchaseSum;
        saleSum += calc.saleSum;
        marginIncVat += calc.marginIncVat;
        vatPayable += calc.vatPayable;
    }

    const marginIncVatPercent = saleSum ? (marginIncVat * 100) / saleSum : null;

    return { purchaseSum, saleSum, marginIncVat, marginIncVatPercent, vatPayable };
}

/** Значения по умолчанию для новой позиции сметы. */
export const DEFAULT_VAT_PERCENT = 22;

export function createEmptyProjectMaterial(): Omit<ProjectMaterial, 'id'> {
    return {
        materialName: '',
        quantity: 0,
        unitName: '',
        supplierName: '',
        purchasePrice: 0,
        purchaseVatPercent: DEFAULT_VAT_PERCENT,
        salePrice: 0,
        saleVatPercent: DEFAULT_VAT_PERCENT,
        designerPercent: 0,
        designerVatPercent: DEFAULT_VAT_PERCENT,
        gcPercent: 0,
        gcVatPercent: DEFAULT_VAT_PERCENT,
        transportAmount: 0,
        transportVatPercent: DEFAULT_VAT_PERCENT,
    };
}