/**
 * googleDriveFiles.ts
 *
 * Универсальная загрузка/удаление обычного файла на Google Drive — в отличие
 * от generateTrustDeedDocx.ts (который заточен именно под генерацию и загрузку
 * docx-документа доверенности), здесь просто "положить файл, который дал
 * пользователь, в такую-то папку" — используется, например, для документов,
 * подтверждающих расход.
 */

export interface DriveFileUploadResult {
    id: string;
    link: string;
}

/** Загружает произвольный файл в указанную папку на Google Drive. */
export async function uploadFileToDrive(
    file: File | Blob,
    filename: string,
    folderId: string,
    accessToken: string
): Promise<DriveFileUploadResult> {
    const metadata = {
        name: filename,
        parents: [folderId],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form,
        }
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Ошибка загрузки файла в Google Drive: ${err}`);
    }

    const result = await response.json();
    return { id: result.id as string, link: result.webViewLink as string };
}

/** Удаляет файл с Google Drive по его ID. 404 (уже удалён вручную) не считаем ошибкой. */
export async function deleteDriveFile(fileId: string, accessToken: string): Promise<void> {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404) {
        const err = await response.text();
        throw new Error(`Не удалось удалить файл на Google Drive: ${err}`);
    }
}

/**
 * Строит имя файла-подтверждения расхода по шаблону "дата_вид_расхода_сумма[_N].расширение".
 * Расширение сохраняется от оригинального файла, который загрузил пользователь
 * (конвертация в единый формат — отдельная, гораздо более тяжёлая задача).
 * index > 1 добавляет порядковый суффикс — нужно, когда к одному расходу
 * прикрепляют несколько файлов подряд, чтобы имена не совпадали.
 */
export function buildReceiptFileName(dateYMD: string, category: string, amount: number, originalFileName: string, index: number): string {
    const extMatch = originalFileName.match(/\.[a-zA-Z0-9]+$/);
    const ext = extMatch ? extMatch[0] : '';
    const base = [dateYMD, category, String(Math.round(amount))]
        .map(p => (p || '').trim())
        .filter(Boolean)
        .join('_');
    const suffix = index > 1 ? `_${index}` : '';
    return (base + suffix + ext).replace(/[/\\:*?"<>|]/g, '');
}