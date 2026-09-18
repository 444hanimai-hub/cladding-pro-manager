/**
 * trustDeedNumbering.ts
 *
 * Гарантирует сквозную (по всей системе, а не по одному проекту) и уникальную
 * нумерацию доверенностей, даже при одновременном создании доверенностей
 * разными пользователями.
 *
 * Как это устроено:
 * - Сама доверенность хранится в коллекции `trust_deeds` с обычным случайным ID
 *   и полем `number` (строка) — номер НЕ используется как ID документа,
 *   чтобы логику уникальности можно было поменять в будущем без переделки
 *   идентификаторов.
 * - Уникальность номера обеспечивает отдельная служебная коллекция
 *   `trust_deed_numbers`, где ID документа = номеру доверенности ("замок").
 *   Firestore не позволяет создать два документа с одинаковым ID в одной
 *   коллекции — это и даёт атомарную гарантию.
 * - Коллекция `counters` (документ `counters/trustDeeds`, поле `lastNumber`)
 *   хранит последний использованный номер — нужна только для того, чтобы
 *   подсказывать в форме "следующий свободный номер". Она НЕ является
 *   источником истины об уникальности — эту роль играет только `trust_deed_numbers`.
 *
 * Всё создание/обновление номера происходит в одной транзакции: либо номер
 * успешно занят и доверенность сохранена, либо (если номер уже занят кем-то
 * другим) ничего не меняется и выбрасывается ошибка NumberTakenError.
 */

import {
    doc,
    collection,
    runTransaction,
    getDoc,
    serverTimestamp,
    writeBatch,
    type Firestore,
    type DocumentData,
} from 'firebase/firestore';

export class NumberTakenError extends Error {
    constructor(public number: string) {
        super(`Номер доверенности "${number}" уже занят`);
        this.name = 'NumberTakenError';
    }
}

const COUNTER_DOC_PATH = ['counters', 'trustDeeds'] as const;
const LOCKS_COLLECTION = 'trust_deed_numbers';
const DEEDS_COLLECTION = 'trust_deeds';

/**
 * Возвращает подсказку для поля "Номер" в форме создания новой доверенности:
 * последний использованный номер + 1 (или "1", если счётчика ещё нет —
 * например, самое первое использование системы).
 *
 * Поле в форме остаётся редактируемым: заказчик может стереть подсказку
 * и ввести любой номер вручную (например, чтобы продолжить свою прежнюю
 * нумерацию, которая велась до перехода на эту систему).
 */
export async function getSuggestedTrustDeedNumber(db: Firestore): Promise<string> {
    try {
        const counterSnap = await getDoc(doc(db, ...COUNTER_DOC_PATH));
        const last = counterSnap.exists() ? Number(counterSnap.data().lastNumber) || 0 : 0;
        return String(last + 1);
    } catch (e) {
        console.error('[trustDeedNumbering] Не удалось получить счётчик номеров:', e);
        return '1';
    }
}

/**
 * Атомарно сохраняет новую доверенность с указанным номером.
 * Бросает NumberTakenError, если номер уже занят другой доверенностью.
 *
 * Возвращает ID созданного документа.
 */
export async function createTrustDeedWithNumber(
    db: Firestore,
    number: string,
    data: DocumentData
): Promise<string> {
    const lockRef = doc(db, LOCKS_COLLECTION, number);
    const counterRef = doc(db, ...COUNTER_DOC_PATH);
    const deedRef = doc(collection(db, DEEDS_COLLECTION));

    await runTransaction(db, async (tx) => {
        // Все чтения — до любых записей (требование транзакций Firestore).
        const lockSnap = await tx.get(lockRef);
        const counterSnap = await tx.get(counterRef);

        if (lockSnap.exists()) {
            throw new NumberTakenError(number);
        }

        tx.set(lockRef, { deedId: deedRef.id, projectId: data.projectId, createdAt: serverTimestamp() });

        const currentLast = counterSnap.exists() ? Number(counterSnap.data().lastNumber) || 0 : 0;
        const numAsInt = parseInt(number, 10) || 0;
        if (numAsInt > currentLast) {
            tx.set(counterRef, { lastNumber: numAsInt }, { merge: true });
        }

        tx.set(deedRef, { ...data, number, createdAt: serverTimestamp() });
    });

    return deedRef.id;
}

/**
 * Атомарно обновляет существующую доверенность. Если номер изменился —
 * освобождает старый "замок" номера и занимает новый (с той же проверкой
 * на уникальность, что и при создании).
 */
export async function updateTrustDeedWithNumber(
    db: Firestore,
    deedId: string,
    previousNumber: string,
    newNumber: string,
    data: DocumentData
): Promise<void> {
    const deedRef = doc(db, DEEDS_COLLECTION, deedId);
    const counterRef = doc(db, ...COUNTER_DOC_PATH);
    const numberChanged = previousNumber !== newNumber;
    const newLockRef = numberChanged ? doc(db, LOCKS_COLLECTION, newNumber) : null;
    const oldLockRef = numberChanged ? doc(db, LOCKS_COLLECTION, previousNumber) : null;

    await runTransaction(db, async (tx) => {
        const newLockSnap = newLockRef ? await tx.get(newLockRef) : null;
        const counterSnap = await tx.get(counterRef);

        if (newLockSnap && newLockSnap.exists()) {
            throw new NumberTakenError(newNumber);
        }

        if (oldLockRef) tx.delete(oldLockRef);
        if (newLockRef) {
            tx.set(newLockRef, { deedId, projectId: data.projectId, createdAt: serverTimestamp() });
        }

        const currentLast = counterSnap.exists() ? Number(counterSnap.data().lastNumber) || 0 : 0;
        const numAsInt = parseInt(newNumber, 10) || 0;
        if (numAsInt > currentLast) {
            tx.set(counterRef, { lastNumber: numAsInt }, { merge: true });
        }

        tx.update(deedRef, { ...data, number: newNumber, updatedAt: serverTimestamp() });
    });
}

/**
 * Удаляет доверенность вместе с её "замком" номера — единым батчем,
 * чтобы номер снова стал доступен для использования.
 */
export async function deleteTrustDeedWithNumber(
    db: Firestore,
    deedId: string,
    number: string
): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(doc(db, DEEDS_COLLECTION, deedId));
    if (number) {
        batch.delete(doc(db, LOCKS_COLLECTION, number));
    }
    await batch.commit();
}