/**
 * googleDriveFolders.ts
 *
 * Документы по проекту заказчик хранит на Google Drive, а не в самой CRM —
 * здесь только создание новой папки под проект и проверка ссылки, которую
 * вставили вручную (если папка уже была создана раньше самим пользователем).
 */

// Родительская папка на Google Drive, внутри которой создаются папки проектов.
// Значение по умолчанию — боевая папка. Для локальной разработки (npm run dev) её можно
// подменить своей тестовой папкой через VITE_DRIVE_PARENT_FOLDER_ID в .env.development.local
// (см. env.example) — тогда тестовые файлы попадают на ваш Диск, а не на боевой.
const PARENT_FOLDER_ID: string =
    import.meta.env?.VITE_DRIVE_PARENT_FOLDER_ID || '1OwX873GZKqc8jeSxiPGzDGfOudDYH8Id';

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

/** Ищет подпапку с данным именем внутри указанной папки. Возвращает null, если не нашлась. */
export async function findSubfolder(parentFolderId: string, name: string, accessToken: string): Promise<DriveFolderResult | null> {
    const escapedName = name.replace(/'/g, "\\'");
    const q = `name='${escapedName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Не удалось найти подпапку на Google Drive: ${err}`);
    }
    const data = await response.json();
    const file = data.files?.[0];
    return file ? { id: file.id, link: file.webViewLink } : null;
}

/** Создаёт подпапку с данным именем внутри указанной папки. */
export async function createSubfolder(parentFolderId: string, name: string, accessToken: string): Promise<DriveFolderResult> {
    const metadata = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
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
        throw new Error(`Не удалось создать подпапку на Google Drive: ${err}`);
    }
    const result = await response.json();
    return { id: result.id as string, link: result.webViewLink as string };
}

/** Находит подпапку с данным именем внутри указанной папки, а если её нет — создаёт. */
export async function findOrCreateSubfolder(parentFolderId: string, name: string, accessToken: string): Promise<DriveFolderResult> {
    const existing = await findSubfolder(parentFolderId, name, accessToken);
    if (existing) return existing;
    return createSubfolder(parentFolderId, name, accessToken);
}

/** Достаёт ID папки из ссылки на папку Google Drive (в т.ч. вида .../drive/u/0/folders/ID?usp=sharing). */
export function extractDriveFolderId(link: string): string {
    const match = (link || '').match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
}

/**
 * Возвращает папку документов проекта:
 *  1. если привязаны и ID, и ссылка — отдаёт их;
 *  2. если привязана только ССЫЛКА — именно так сохраняется ссылка, вставленная вручную в
 *     «Информации о проекте» (ID при этом не записывается), — достаёт ID из ссылки и отдаёт ту же
 *     папку. Раньше такая ссылка игнорировалась: создавалась новая папка по шаблону имени, и её
 *     ссылка затирала ту, что ввёл пользователь;
 *  3. если есть только ID — собирает ссылку по нему;
 *  4. только если не привязано ничего — создаёт новую по стандартной формуле имени.
 * ВАЖНО: эта функция ничего не пишет в Firestore — если она создала новую папку,
 * сохранить driveDocsFolderId/Link в сам проект должен вызывающий код.
 */
export async function ensureProjectDocsFolder(
    project: { driveDocsFolderId?: string; driveDocsFolderLink?: string; createdAt?: any; name: string; leadManagerName?: string },
    accessToken: string
): Promise<DriveFolderResult> {
    if (project.driveDocsFolderId && project.driveDocsFolderLink) {
        return { id: project.driveDocsFolderId, link: project.driveDocsFolderLink };
    }
    const idFromLink = extractDriveFolderId(project.driveDocsFolderLink || '');
    if (idFromLink) {
        return { id: idFromLink, link: project.driveDocsFolderLink as string };
    }
    if (project.driveDocsFolderId) {
        return { id: project.driveDocsFolderId, link: `https://drive.google.com/drive/folders/${project.driveDocsFolderId}` };
    }
    const dateYMD = formatDateYMD(project.createdAt);
    const folderName = buildProjectFolderName(dateYMD, project.name, project.leadManagerName || '');
    return createProjectDriveFolder(folderName, accessToken);
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