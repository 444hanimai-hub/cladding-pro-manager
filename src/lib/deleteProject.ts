/**
 * deleteProject.ts
 *
 * Полное удаление проекта ИЗ СИСТЕМЫ (из Firestore). Ничего во внешних сервисах не
 * трогаем: документы на Google Диске и события в Google Календаре остаются как есть.
 *
 * Почему нельзя просто deleteDoc(projects/{id}):
 *  — в Firestore подколлекции НЕ удаляются вместе с родительским документом, они
 *    остались бы в базе мусором (tasks, events и старая documents);
 *  — доверенности лежат в отдельной коллекции верхнего уровня trust_deeds (связь через
 *    projectId) и держат "замки" номеров trust_deed_numbers — если их не убрать, эти
 *    номера останутся занятыми навсегда. Для этого используем ту же функцию, что и при
 *    ручном удалении доверенности (deleteTrustDeedWithNumber) — номера освобождаются
 *    так же, как и там.
 *
 * ПОРЯДОК важен: сам документ проекта удаляем ПОСЛЕДНИМ. Если что-то сорвётся посередине
 * (связь, права), проект останется в списке, и удаление можно просто повторить — оно
 * дочистит оставшееся. Если бы проект удалялся первым, при сбое осталась бы невидимая
 * в интерфейсе "осиротевшая" часть данных, которую уже никто не доудалит.
 *
 * Права: удалять проект по правилам Firestore может только администратор (isAdmin()).
 */

import { collection, deleteDoc, doc, getDocs, query, where, writeBatch, type Firestore } from 'firebase/firestore';
import { deleteTrustDeedWithNumber } from './trustDeedNumbering';

/** Подколлекции проекта, которые нужно вычистить вручную (в Firestore они сами не удаляются). */
const PROJECT_SUBCOLLECTIONS = ['tasks', 'events', 'documents'] as const;

/** Лимит одной пачки записи в Firestore — 500 операций; берём с запасом. */
const BATCH_SIZE = 400;

async function deleteSubcollection(db: Firestore, projectId: string, name: string): Promise<void> {
    const snap = await getDocs(collection(db, 'projects', projectId, name));
    for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
        await batch.commit();
    }
}

export async function deleteProjectCompletely(db: Firestore, projectId: string): Promise<void> {
    // 1. Доверенности проекта вместе с "замками" номеров.
    const deedsSnap = await getDocs(query(collection(db, 'trust_deeds'), where('projectId', '==', projectId)));
    for (const deed of deedsSnap.docs) {
        const number = String(deed.data().number ?? '').trim();
        if (number) {
            await deleteTrustDeedWithNumber(db, deed.id, number);
        } else {
            // У доверенности нет номера (нет и "замка") — просто удаляем сам документ.
            await deleteDoc(deed.ref);
        }
    }

    // 2. Подколлекции проекта.
    for (const name of PROJECT_SUBCOLLECTIONS) {
        await deleteSubcollection(db, projectId, name);
    }

    // 3. Сам проект — последним (материалы, отгрузки, финансовые операции лежат внутри него).
    await deleteDoc(doc(db, 'projects', projectId));
}