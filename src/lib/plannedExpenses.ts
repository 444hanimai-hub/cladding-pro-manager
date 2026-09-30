/**
 * plannedExpenses.ts
 *
 * Плановые расходы больше нельзя завести вручную (см. форму расхода в FinanceTab —
 * там нет ни поля "Тип расхода", ни возможности его сменить) — они целиком и
 * полностью управляются автоматически, при каждом сохранении/удалении материала
 * проекта (см. вызовы syncPlannedExpensesForMaterials в MaterialsTab.tsx).
 *
 * На каждый материал (позицию сметы, ProjectMaterial) заводится 4 плановых расхода —
 * закуп, транспорт, услуга дизайнера, услуга ГП — плюс ОДНА общую запись налога на
 * весь проект (не по материалам отдельно: НДС считается взаимозачётом закупа и
 * продажи суммарно, разбивать её по материалам было бы искусственно).
 *
 * КЛЮЧЕВОЙ ПРИЁМ: id плановых расходов ДЕТЕРМИНИРОВАННЫЙ (id материала зашит прямо
 * в id расхода) — а не случайный, генерируемый заново при каждой пересборке. Это
 * значит, что при повторной пересборке (человек отредактировал материал — суммы
 * планов должны обновиться "на месте") запись просто перезаписывается тем же id,
 * а НЕ создаётся заново со случайным id. Это критично, потому что фактические
 * расходы хранят ссылку на плановый расход именно через его id (plannedExpenseId) —
 * если бы id менялся при каждой пересборке, эта ссылка обрывалась бы на ровном месте.
 */

import type { Expense, ProjectMaterial } from '../types';
import { calcMaterial } from './materialFinance';

export const EXPENSE_CATEGORY_PURCHASE = 'Закуп материала';
export const EXPENSE_CATEGORY_TAX = 'Налог';
export const EXPENSE_CATEGORY_TRANSPORT = 'Транспорт';
export const EXPENSE_CATEGORY_DESIGNER = 'Услуга дизайнера';
export const EXPENSE_CATEGORY_GC = 'Услуга генподрядчика';

/** Регистронезависимое сравнение названий видов расхода — та же логика, что и для
 * вида товара "Кирпич" в MaterialsTab.tsx: значение вводится через справочник
 * человеком, "налог"/"Налог" не должны считаться разными категориями. */
export function isSameExpenseCategory(a?: string, b?: string): boolean {
    return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

type AutoPlannedKind = 'purchase' | 'transport' | 'designer' | 'gc';
const AUTO_PLANNED_KINDS: AutoPlannedKind[] = ['purchase', 'transport', 'designer', 'gc'];

function buildPlannedExpenseId(kind: AutoPlannedKind, projectMaterialId: string): string {
    return `planned_${kind}_${projectMaterialId}`;
}

/** Единственная на весь проект плановая запись налога (не по материалам отдельно). */
export const PLANNED_TAX_EXPENSE_ID = 'planned_tax_project';

/** true, если это id одной из автоматически управляемых плановых записей —
 * такие записи при пересборке всегда полностью заменяются свежими, никогда не
 * трогаются и не создаются человеком через форму. */
function isAutoManagedPlannedId(id: string): boolean {
    if (id === PLANNED_TAX_EXPENSE_ID) return true;
    return AUTO_PLANNED_KINDS.some(kind => id.startsWith(`planned_${kind}_`));
}

/**
 * Пересобирает автоматические плановые расходы с нуля из ТЕКУЩЕГО состава
 * материалов проекта (materials — уже обновлённый массив, ПОСЛЕ добавления,
 * редактирования или удаления материала). Все фактические расходы и любые
 * посторонние записи (не из этого набора) остаются нетронутыми — заменяются
 * только сами плановые записи с "автоматическими" id.
 *
 * Вызывать после КАЖДОГО изменения состава/цифр материалов проекта — как при
 * добавлении/редактировании (материал появился или его суммы поменялись —
 * планы должны обновиться), так и при удалении (материала больше нет — его
 * планы пропадают, а общий налог по проекту пересчитывается без него).
 */
export function syncPlannedExpensesForMaterials(
    expenses: Expense[],
    materials: ProjectMaterial[]
): Expense[] {
    const kept = expenses.filter(e => !((e.type || 'actual') === 'planned' && isAutoManagedPlannedId(e.id)));

    const generated: Expense[] = [];
    let totalTax = 0;

    // Плановая запись с нулевой (или отрицательной — на всякий случай) суммой не
    // создаётся вообще — незачем засорять расходы пустыми строками. Раз генерация
    // идёт "с нуля" при каждой пересборке (см. kept выше), такая запись просто не
    // появится в новом массиве, даже если раньше существовала с ненулевой суммой.
    const pushIfPositive = (expense: Expense) => {
        if (expense.amount > 0) generated.push(expense);
    };

    for (const m of materials) {
        const calc = calcMaterial(m);
        totalTax += calc.vatPayable;

        pushIfPositive({
            id: buildPlannedExpenseId('purchase', m.id),
            date: '',
            category: EXPENSE_CATEGORY_PURCHASE,
            type: 'planned',
            materialId: m.id,
            amount: calc.purchaseSum,
        });
        pushIfPositive({
            id: buildPlannedExpenseId('transport', m.id),
            date: '',
            category: EXPENSE_CATEGORY_TRANSPORT,
            type: 'planned',
            materialId: m.id,
            amount: m.transportAmount || 0,
        });
        pushIfPositive({
            id: buildPlannedExpenseId('designer', m.id),
            date: '',
            category: EXPENSE_CATEGORY_DESIGNER,
            type: 'planned',
            materialId: m.id,
            amount: calc.designerSum,
        });
        pushIfPositive({
            id: buildPlannedExpenseId('gc', m.id),
            date: '',
            category: EXPENSE_CATEGORY_GC,
            type: 'planned',
            materialId: m.id,
            amount: calc.gcSum,
        });
    }

    pushIfPositive({
        id: PLANNED_TAX_EXPENSE_ID,
        date: '',
        category: EXPENSE_CATEGORY_TAX,
        type: 'planned',
        amount: totalTax,
    });

    return [...kept, ...generated];
}

/** Материалы (ProjectMaterial.id), по которым уже есть хотя бы один ФАКТИЧЕСКИЙ
 * расход — используется, чтобы решить, можно ли удалить материал без предупреждения
 * (см. MaterialsTab.tsx: только плановые — можно тихо; есть фактический — блокируем). */
export function getMaterialIdsWithActualExpenses(expenses: Expense[]): Set<string> {
    const set = new Set<string>();
    for (const e of expenses) {
        if ((e.type || 'actual') === 'actual' && e.materialId) set.add(e.materialId);
    }
    return set;
}