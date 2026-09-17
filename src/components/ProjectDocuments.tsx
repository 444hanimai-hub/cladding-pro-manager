import React, { useEffect, useRef, useState } from 'react';
import { Upload, FileText, Download, Trash2, X, AlertCircle } from 'lucide-react';
import {
  subscribeProjectDocuments,
  uploadProjectDocument,
  deleteProjectDocument,
} from '../lib/documents';
import { auth } from '../lib/firebase';

interface Props {
  projectId: string;
  canEdit?: boolean;
}

interface UploadingEntry {
  id: string;
  name: string;
  progress: number;
  startedAt: number;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDate(ts: any) {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ProjectDocuments({ projectId, canEdit = true }: Props) {
  const [docs, setDocs] = useState<any[]>([]);
  const [uploading, setUploading] = useState<UploadingEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = subscribeProjectDocuments(projectId, setDocs);
    return () => unsub();
  }, [projectId]);

  useEffect(() => {
    return auth.onAuthStateChanged(() => setAuthReady(true));
  }, []);

  // Cleanup stale "phantom" uploads that have been stuck for more than 5 minutes
  useEffect(() => {
    if (uploading.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setUploading(u => u.filter(x => now - x.startedAt < 300_000));
    }, 30_000);
    return () => clearInterval(t);
  }, [uploading.length]);

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    const arr = Array.from(files);
    for (const file of arr) {
      if (file.size > 50 * 1024 * 1024) {
        setError(`Файл «${file.name}» больше 50 МБ — слишком тяжёлый.`);
        continue;
      }

      const id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const entry: UploadingEntry = { id, name: file.name, progress: 0, startedAt: Date.now() };
      setUploading(u => [...u, entry]);

      try {
        await uploadProjectDocument(projectId, file, p => {
          setUploading(u => u.map(x => (x.id === id ? { ...x, progress: p } : x)));
        });
      } catch (e: any) {
        setError(`Не удалось загрузить «${file.name}»: ${e?.code || e?.message || 'неизвестная ошибка'}`);
      } finally {
        setUploading(u => u.filter(x => x.id !== id));
      }
    }
  }

  function handleDownload(d: any) {
    const a = document.createElement('a');
    a.href = d.downloadURL;
    a.download = d.name;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    try {
      await deleteProjectDocument(projectId, confirmDelete);
      setConfirmDelete(null);
    } catch (e: any) {
      setError(`Не удалось удалить файл: ${e.message || e}`);
    }
  }

  const hasDocs = docs.length > 0;
  const isBusy  = uploading.length > 0;

  return (
      <div className="bg-surface border border-line rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="font-display text-[17px] font-medium text-ink">Документы</h3>
          {canEdit && (docs.length > 0 || uploading.length > 0) && (
              <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={!authReady}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Upload size={13} /> Загрузить
              </button>
          )}
          {canEdit && (
              <input
                  ref={inputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,image/*"
                  onChange={e => {
                    if (e.target.files?.length) handleFiles(e.target.files);
                    e.target.value = '';
                  }}
              />
          )}
        </div>

        <div className="px-5 py-4">
          {error && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2 rounded-md bg-[#f1d9cf] text-[#a04930] text-[12px]">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="flex-1">{error}</span>
                <button type="button" onClick={() => setError(null)} className="shrink-0 opacity-70 hover:opacity-100">
                  <X size={12} />
                </button>
              </div>
          )}

          {!hasDocs && !isBusy && (
              canEdit ? (
                  <button
                      type="button"
                      disabled={!authReady}
                      onClick={() => inputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); if (authReady) setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOver(false);
                        if (authReady && e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
                      }}
                      className={`w-full flex flex-col items-center gap-2 py-10 rounded-xl border border-dashed transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          dragOver ? 'border-ochre bg-[var(--ochre-bg)]' : 'border-line bg-surface-2/50 hover:bg-surface-2'
                      }`}
                  >
                    <div className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center text-ink-3">
                      <FileText size={18} />
                    </div>
                    <div className="text-[13px] font-semibold text-ink-2">Документы не загружены</div>
                    <div className="text-[12px] text-ink-3">Договор, ТЗ, смета — всё проекту полезно держать здесь</div>
                    <span className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-ink-2 border border-line bg-surface">
                <Upload size={12} /> Загрузить документ
              </span>
                  </button>
              ) : (
                  <div className="flex flex-col items-center gap-2 py-10">
                    <div className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center text-ink-3">
                      <FileText size={18} />
                    </div>
                    <div className="text-[13px] font-semibold text-ink-2">Документов нет</div>
                  </div>
              )
          )}

          {(hasDocs || isBusy) && (
              <div className="flex flex-col">
                {docs.map((d, i) => (
                    <div
                        key={d.id}
                        className={`flex items-center justify-between gap-3 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-md bg-surface-2 flex items-center justify-center text-ink-3 shrink-0">
                          <FileText size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold text-ink truncate">{d.name}</div>
                          <div className="text-[11px] text-ink-3 truncate">
                            {formatSize(d.size)} · загрузил {d.uploadedByName} {formatDate(d.uploadedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Скачивание доступно всегда */}
                        <button
                            type="button"
                            onClick={() => handleDownload(d)}
                            title="Скачать"
                            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
                        >
                          <Download size={14} />
                        </button>
                        {/* Удаление только при canEdit */}
                        {canEdit && (
                            <button
                                type="button"
                                onClick={() => setConfirmDelete(d)}
                                title="Удалить"
                                className="w-8 h-8 inline-flex items-center justify-center rounded-md text-ink-3 hover:text-[#a04930] hover:bg-surface-2 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                        )}
                      </div>
                    </div>
                ))}

                {canEdit && uploading.map((u, idx) => (
                    <div
                        key={u.id}
                        className={`flex items-center gap-3 py-3 ${docs.length > 0 || idx > 0 ? 'border-t border-line' : ''}`}
                    >
                      <div className="w-9 h-9 rounded-md bg-[var(--ochre-bg)] flex items-center justify-center text-[var(--ochre)] shrink-0">
                        <Upload size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-ink truncate">{u.name}</div>
                        <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
                          <div
                              className="h-full bg-[var(--ochre)] transition-[width] duration-200"
                              style={{ width: `${Math.max(4, Math.round(u.progress * 100))}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-[11px] text-ink-3 tabular-nums shrink-0">
                        {Math.round(u.progress * 100)}%
                      </div>
                    </div>
                ))}
              </div>
          )}
        </div>

        {canEdit && confirmDelete && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
              <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />
              <div
                  className="relative w-full max-w-[480px] bg-surface border border-line rounded-2xl shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)]"
                  onClick={e => e.stopPropagation()}
              >
                <div className="px-6 py-5">
                  <h4 className="font-display text-[18px] font-medium text-ink mb-3">Удалить документ?</h4>
                  <div
                      className="text-[13px] font-semibold text-ink mb-1.5 leading-snug"
                      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                  >
                    «{confirmDelete.name}»
                  </div>
                  <p className="text-[13px] text-ink-2 leading-relaxed">
                    будет удалён без возможности восстановления.
                  </p>
                </div>
                <div className="px-6 py-4 border-t border-line flex justify-end gap-2">
                  <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="px-4 py-2 rounded-md text-[13px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                  >
                    Отмена
                  </button>
                  <button
                      type="button"
                      onClick={handleConfirmDelete}
                      className="px-4 py-2 rounded-md text-[13px] font-semibold bg-[#a04930] text-bg hover:brightness-95 transition-[filter]"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
        )}
      </div>
  );
}