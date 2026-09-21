/**
 * googleDriveFolders.ts
 *
 * Документы по проекту заказчик хранит на Google Drive, а не в самой CRM —
 * здесь только создание новой папки под проект и проверка ссылки, которую
 * вставили вручную (если папка уже была создана раньше самим пользователем).
 */

// Родительская папка на Google Drive, внутри которой создаются папки проектов.
const PARENT_FOLDER_ID = '1T2Yl4Slt1yr_Q6gbO-dICtShh0ReF4Q8';

export interface DriveFolderResult {
    id: string;
    link: string;
}

/**
 * Создаёт новую папку на Google Drive внутри родительской папки и возвращает её ID и ссылку.
 */
export async function createProjectDriveFolder(name: string, accessToken: string): Promise<DriveFolderResult> {
    const metadata = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [PARENT_FOLDER_ID],
    };

    const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Не удалось создать папку на Google Drive: ${err}`);
    }

    const result = await response.json();
    return { id: result.id as string, link: result.webViewLink as string };
}

/** Простая проверка, что введённая вручную ссылка похожа на ссылку на папку Google Drive. */
export function isValidDriveFolderLink(url: string): boolean {
    return /^https:\/\/drive\.google\.com\/drive\/folders\/[a-zA-Z0-9_-]+/.test(url.trim());
}

/**
 * Приводит дату (Firestore Timestamp / Date / строку) к виду ГГГГ.ММ.ДД —
 * именно в таком порядке, чтобы папки проектов на Google Drive сортировались
 * по названию в хронологическом порядке (в отличие от ДД.ММ.ГГГГ, где
 * сортировка по алфавиту "ломает" хронологию).
 */
export function formatDateYMD(dateVal: any): string {
    if (!dateVal) return '';
    const date = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
    if (isNaN(date.getTime())) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}

/**
 * Формирует имя новой папки проекта по формуле: ГГГГ.ММ.ДД_Название проекта_Менеджер.
 * dateYMD — дата, уже отформатированная через formatDateYMD (см. выше).
 */
export function buildProjectFolderName(dateYMD: string, projectName: string, managerName: string): string {
    const parts = [dateYMD, projectName, managerName].map(p => (p || '').trim()).filter(Boolean);
    return parts.join('_').replace(/[/\\:*?"<>|]/g, '');
}