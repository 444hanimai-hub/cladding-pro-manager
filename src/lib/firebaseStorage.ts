/**
 * firebaseStorage.ts
 *
 * Firebase Storage используется только для фото материалов в справочнике —
 * узкий, некрупный случай (немного файлов, привязаны к справочнику, а не к
 * растущему потоку документов по проектам, которые мы специально перевели на
 * Google Drive). Для этого случая Storage проще: не нужен Google-токен ни на
 * загрузку в справочнике, ни на чтение байтов при генерации КП.
 */
import { storage } from './firebase';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

/** Загружает фото материала в Storage и возвращает постоянную ссылку на скачивание. */
export async function uploadMaterialPhoto(file: File, materialId: string): Promise<string> {
    const safeName = file.name.replace(/[^\w.\-]/g, '_');
    const path = `materials/${materialId}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
}

/** Удаляет фото материала из Storage по его ссылке. Отсутствие файла (уже удалён) не считаем ошибкой. */
export async function deleteMaterialPhoto(photoUrl: string): Promise<void> {
    try {
        const storageRef = ref(storage, photoUrl);
        await deleteObject(storageRef);
    } catch (error: any) {
        if (error?.code !== 'storage/object-not-found') {
            throw error;
        }
    }
}