import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, addDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { storage, db, auth } from './firebase';

export interface ProjectDocument {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  storagePath: string;
  downloadURL: string;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: any;
}

export function subscribeProjectDocuments(projectId: string, callback: (docs: ProjectDocument[]) => void) {
  const q = query(
    collection(db, 'projects', projectId, 'documents'),
    orderBy('uploadedAt', 'desc')
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProjectDocument)));
  });
}

function guessMimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    pdf:  'application/pdf',
    doc:  'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:  'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt:  'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt:  'text/plain',
    csv:  'text/csv',
    zip:  'application/zip',
    rar:  'application/x-rar-compressed',
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    webp: 'image/webp',
    svg:  'image/svg+xml',
  };
  return map[ext || ''] || 'application/octet-stream';
}

export function uploadProjectDocument(
  projectId: string, 
  file: File, 
  onProgress?: (progress: number) => void
): Promise<{ id: string; downloadURL: string }> {
  return new Promise((resolve, reject) => {
    const user = auth.currentUser;
    if (!user) {
      reject(new Error('Пользователь не авторизован'));
      return;
    }

    const safeName = file.name
      .normalize('NFC')
      .replace(/[^\w.\-а-яА-ЯёЁ ]+/g, '_');
    const path = `projects/${projectId}/documents/${Date.now()}-${safeName}`;
    const storageRef = ref(storage, path);

    const contentType = file.type && file.type.trim() !== ''
      ? file.type
      : guessMimeFromName(file.name);

    const task = uploadBytesResumable(storageRef, file, {
      contentType,
      customMetadata: {
        originalName: file.name,
        uploadedBy: user.uid,
      },
    });

    task.on(
      'state_changed',
      snap => {
        const p = snap.totalBytes
          ? snap.bytesTransferred / snap.totalBytes
          : 0;
        onProgress?.(p);
      },
      err => {
        console.error('[upload] storage error', err.code, err.message, err);
        reject(err);
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(task.snapshot.ref);
          const docRef = await addDoc(
            collection(db, 'projects', projectId, 'documents'),
            {
              name: file.name,
              size: file.size,
              mimeType: contentType,
              storagePath: path,
              downloadURL,
              uploadedBy: user.uid,
              uploadedByName: user.displayName || user.email || 'Пользователь',
              uploadedAt: serverTimestamp(),
            }
          );
          resolve({ id: docRef.id, downloadURL });
        } catch (e) {
          console.error('[upload] firestore addDoc failed', e);
          reject(e);
        }
      }
    );
  });
}

export async function deleteProjectDocument(projectId: string, docMeta: { id: string; storagePath: string }): Promise<void> {
  await deleteObject(ref(storage, docMeta.storagePath));
  await deleteDoc(doc(db, 'projects', projectId, 'documents', docMeta.id));
}
