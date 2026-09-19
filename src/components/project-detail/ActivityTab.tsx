import React, { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, Clock, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { createCalendarEvent, isCalendarAuthError } from '../../services/googleCalendarService';
import { verifyCalendarAccess } from '../../services/googleCalendarService';
import { Project, ProjectTask } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import { TimeInput } from '../ui/TimeInput';

const TASK_CARD_CLASS =
    'rounded-2xl border bg-surface border-line shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden';
const TASK_LABEL_CLASS =
    'text-[10px] font-bold uppercase tracking-widest text-[#8A8574] block mb-1.5';

function parseTaskDate(dateVal: ProjectTask['date'] | unknown): Date | null {
    if (dateVal == null || dateVal === '') return null;
    if (
        typeof dateVal === 'object' &&
        'toDate' in dateVal &&
        typeof (dateVal as { toDate: () => Date }).toDate === 'function'
    ) {
        return (dateVal as { toDate: () => Date }).toDate();
    }
    const d = new Date(String(dateVal));
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Метка времени для сортировки: дата + время; без даты — в конец списка */
function getTaskSortTimestamp(task: ProjectTask): number {
    const d = parseTaskDate(task.date);
    if (!d) return Number.MAX_SAFE_INTEGER;
    const time = task.time?.trim();
    if (time && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
        const [h, m] = time.split(':').map(Number);
        d.setHours(h, m, 0, 0);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d.getTime();
}

function compareTasksBySchedule(a: ProjectTask, b: ProjectTask): number {
    const dateDiff = getTaskSortTimestamp(a) - getTaskSortTimestamp(b);
    if (dateDiff !== 0) return dateDiff;
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.id.localeCompare(b.id);
}

function sortTasksForDisplay(list: ProjectTask[]): ProjectTask[] {
    return [...list].sort(compareTasksBySchedule);
}

function CalendarReconnectBanner({
                                     onConnect,
                                     detail,
                                     isConnecting,
                                 }: {
    onConnect: () => void | Promise<void>;
    detail?: string | null;
    isConnecting?: boolean;
}) {
    return (
        <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">Синхронизация с Google Календарём отключена</p>
                <p className="text-[12px] text-ink-3 mt-1 leading-snug">
                    {detail ||
                        'Подключите календарь — задачи с датой будут автоматически появляться в Google Calendar.'}
                </p>
            </div>
            <button
                type="button"
                onClick={onConnect}
                disabled={isConnecting}
                className="shrink-0 h-9 px-4 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
                {isConnecting ? 'Подключение…' : 'Подключить Google Календарь'}
            </button>
        </div>
    );
}

function ActivityTab({ tasks, projectId, canEdit, project, accessToken, onConnectCalendar, onClearCalendarToken }: { tasks: ProjectTask[], projectId: string, canEdit: boolean, project: Project | null, accessToken?: string | null, onConnectCalendar?: () => Promise<boolean>, onClearCalendarToken?: () => void }) {
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskDate, setNewTaskDate] = useState('');
    const [newTaskTime, setNewTaskTime] = useState('');

    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editingTaskData, setEditingTaskData] = useState<Partial<ProjectTask>>({});
    const [calendarSyncError, setCalendarSyncError] = useState<string | null>(null);
    const [calendarNeedsReconnect, setCalendarNeedsReconnect] = useState(() => !accessToken);
    const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
    const [completedTasksExpanded, setCompletedTasksExpanded] = useState(false);

    const handleConnectCalendar = async () => {
        if (!onConnectCalendar || isConnectingCalendar) return;
        setIsConnectingCalendar(true);
        try {
            const ok = await onConnectCalendar();
            if (ok) {
                setCalendarNeedsReconnect(false);
                setCalendarSyncError(null);
            }
        } finally {
            setIsConnectingCalendar(false);
        }
    };

    const markCalendarDisconnected = (detail: string, calError?: unknown) => {
        setCalendarNeedsReconnect(true);
        setCalendarSyncError(detail);
        if (!calError || isCalendarAuthError(calError)) onClearCalendarToken?.();
    };

    useEffect(() => {
        if (!accessToken) {
            setCalendarNeedsReconnect(true);
            return;
        }

        let cancelled = false;
        verifyCalendarAccess(accessToken).then(({ valid, unauthorized }) => {
            if (cancelled) return;
            if (!valid) {
                setCalendarNeedsReconnect(true);
                if (unauthorized) {
                    setCalendarSyncError('Доступ к Google Календарю недействителен. Подключите календарь снова.');
                    onClearCalendarToken?.();
                } else {
                    setCalendarSyncError('Не удалось проверить календарь. Проверьте интернет.');
                }
            } else {
                setCalendarNeedsReconnect(false);
                setCalendarSyncError(null);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [accessToken, onClearCalendarToken]);

    const showCalendarBanner = calendarNeedsReconnect && Boolean(onConnectCalendar);

    const handleUpdateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingTaskId || !canEdit) return;
        setCalendarSyncError(null);
        try {
            await updateDoc(doc(db, 'projects', projectId, 'tasks', editingTaskId), {
                ...editingTaskData,
                updatedAt: serverTimestamp()
            });

            if (accessToken && project && editingTaskData.date) {
                try {
                    await createCalendarEvent(accessToken, project, {
                        ...editingTaskData,
                        id: editingTaskId
                    });
                } catch (calError: unknown) {
                    const message = calError instanceof Error ? calError.message : 'Ошибка календаря';
                    markCalendarDisconnected(
                        isCalendarAuthError(calError)
                            ? 'Доступ к Google Календарю истёк. Подключите календарь снова.'
                            : `Не удалось обновить календарь: ${message}`,
                        calError
                    );
                    console.error('Calendar sync error:', calError);
                }
            }

            setEditingTaskId(null);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks/${editingTaskId}`);
        }
    };

    const toggleTask = async (task: ProjectTask) => {
        if (!canEdit) return;
        try {
            await updateDoc(doc(db, 'projects', projectId, 'tasks', task.id), {
                completed: !task.completed
            });
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks/${task.id}`);
        }
    };

    const deleteTask = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!canEdit) return;
        try {
            await deleteDoc(doc(db, 'projects', projectId, 'tasks', id));
        } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}/tasks/${id}`);
        }
    };

    const addTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle || !canEdit) return;
        setCalendarSyncError(null);
        try {
            const taskData: Partial<ProjectTask> & { projectId: string; createdAt: ReturnType<typeof serverTimestamp>; order: number } = {
                projectId,
                title: newTaskTitle,
                description: '',
                date: newTaskDate || undefined,
                time: newTaskTime || undefined,
                completed: false,
                type: 'task',
                createdAt: serverTimestamp(),
                order: tasks.length,
            };

            await addDoc(collection(db, 'projects', projectId, 'tasks'), taskData);

            if (accessToken && project && newTaskDate) {
                try {
                    await createCalendarEvent(accessToken, project, taskData);
                    setCalendarNeedsReconnect(false);
                    setCalendarSyncError(null);
                } catch (calError: unknown) {
                    const message = calError instanceof Error ? calError.message : 'Ошибка календаря';
                    console.error('Calendar sync failed', calError);
                    markCalendarDisconnected(
                        isCalendarAuthError(calError)
                            ? 'Задача сохранена в CRM, но доступ к Google Календарю истёк. Подключите календарь снова.'
                            : `Задача сохранена в CRM, но не попала в календарь: ${message}`,
                        calError
                    );
                }
            } else if (newTaskDate && !accessToken) {
                markCalendarDisconnected(
                    'Задача сохранена в CRM. Подключите Google Календарь, чтобы она попала в календарь.'
                );
            }

            setNewTaskTitle('');
            setNewTaskDate('');
            setNewTaskTime('');
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${projectId}/tasks`);
        }
    };

    const activeTasks = useMemo(
        () => sortTasksForDisplay(tasks.filter((t) => !t.completed)),
        [tasks]
    );

    const completedTasks = useMemo(
        () => sortTasksForDisplay(tasks.filter((t) => t.completed)),
        [tasks]
    );

    const renderTaskList = (list: ProjectTask[], emptyLabel: string) => (
        <div className="divide-y divide-[#E5E0D6]">
            {list.map((task) => (
                <TaskItem
                    key={task.id}
                    task={task}
                    canEdit={canEdit}
                    onToggle={toggleTask}
                    onDelete={deleteTask}
                    onBeginEdit={(t) => {
                        setEditingTaskId(t.id);
                        setEditingTaskData({ title: t.title, date: t.date, time: t.time });
                    }}
                    isEditing={editingTaskId === task.id}
                    editingData={editingTaskData}
                    onEditDataChange={setEditingTaskData}
                    onSaveEdit={handleUpdateTask}
                    onCancelEdit={() => setEditingTaskId(null)}
                />
            ))}
            {list.length === 0 && (
                <div className="px-4 py-10 text-center text-[11px] text-ink-3">
                    {emptyLabel}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            {showCalendarBanner && onConnectCalendar && (
                <CalendarReconnectBanner
                    onConnect={handleConnectCalendar}
                    detail={calendarSyncError}
                    isConnecting={isConnectingCalendar}
                />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
                {/* Форма добавления — 2/5 */}
                <div className={cn(TASK_CARD_CLASS, 'p-5 lg:col-span-2')}>
                    <h3 className="text-[15px] font-serif font-medium text-ink mb-4">Добавить задачу</h3>

                    <form onSubmit={addTask} className="space-y-4">
                        <div>
                            <label className={TASK_LABEL_CLASS}>Что нужно сделать?</label>
                            <textarea
                                value={newTaskTitle}
                                onChange={(e) => setNewTaskTitle(e.target.value)}
                                placeholder="Напр. Отправить КП заказчику"
                                rows={3}
                                disabled={!canEdit}
                                className="w-full min-h-[88px] bg-[#F5F2E9] border border-transparent rounded-lg px-3.5 py-3 text-[13px] font-medium text-ink placeholder:text-ink-4 focus:border-ochre/50 focus:outline-none transition-colors resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={TASK_LABEL_CLASS}>Дата</label>
                                <DatePicker
                                    value={newTaskDate}
                                    onChange={setNewTaskDate}
                                    placeholder="дд.мм.гггг"
                                    variant="compact"
                                />
                            </div>
                            <div>
                                <label className={TASK_LABEL_CLASS}>Время</label>
                                <TimeInput
                                    value={newTaskTime}
                                    onChange={setNewTaskTime}
                                    placeholder="--:--"
                                    variant="compact"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={!newTaskTitle.trim() || !canEdit}
                            className="w-full h-10 rounded-lg text-[12.5px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5 active:scale-[0.99]"
                        >
                            <Plus size={15} strokeWidth={2.5} />
                            Добавить задачу
                        </button>

                        <p className="text-[11px] leading-relaxed text-[#8A8574]">
                            Часть задач подгружается автоматически при создании проекта — даты можно проставить позже.
                        </p>
                    </form>
                </div>

                {/* Списки задач — 3/5 */}
                <div className="flex flex-col gap-4 min-w-0 lg:col-span-3">
                    <div className={TASK_CARD_CLASS}>
                        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[#E5E0D6]">
                            <span className="text-[14px] font-serif font-medium text-ink">Задачи</span>
                            <span className="text-[12px] text-ink-3 tabular-nums">· {activeTasks.length}</span>
                        </div>
                        {renderTaskList(activeTasks, 'Нет активных задач')}
                    </div>

                    {completedTasks.length > 0 && (
                        <div className={TASK_CARD_CLASS}>
                            <button
                                type="button"
                                onClick={() => setCompletedTasksExpanded((v) => !v)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-[#E5E0D6] text-left hover:bg-[#F5F2E9]/60 transition-colors"
                            >
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-[14px] font-serif font-medium text-ink">Завершенные задачи</span>
                                    <span className="text-[12px] text-ink-3 tabular-nums">· {completedTasks.length}</span>
                                </div>
                                <ChevronDown
                                    size={16}
                                    className={cn(
                                        'text-ink-3 shrink-0 transition-transform duration-200',
                                        completedTasksExpanded && 'rotate-180'
                                    )}
                                />
                            </button>
                            {completedTasksExpanded && renderTaskList(completedTasks, '')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function TaskItem({
                      task,
                      canEdit,
                      onToggle,
                      onDelete,
                      onBeginEdit,
                      isEditing,
                      editingData,
                      onEditDataChange,
                      onSaveEdit,
                      onCancelEdit
                  }: {
    task: ProjectTask,
    canEdit: boolean,
    onToggle: (t: ProjectTask) => Promise<void> | void,
    onDelete: (e: React.MouseEvent, id: string) => Promise<void> | void,
    onBeginEdit?: (t: ProjectTask) => void,
    isEditing?: boolean,
    editingData?: Partial<ProjectTask>,
    onEditDataChange?: (d: Partial<ProjectTask>) => void,
    onSaveEdit?: (e: React.FormEvent) => Promise<void> | void,
    onCancelEdit?: () => void,
    key?: string | number
}) {
    const d = parseTaskDate(task.date);
    const day = d ? d.toLocaleDateString('ru-RU', { day: '2-digit' }) : '';
    const month = d
        ? d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '').toUpperCase()
        : '';
    const timeLabel = task.time || (d ? '—' : '');

    if (isEditing && onEditDataChange && onSaveEdit && onCancelEdit) {
        return (
            <div className="px-4 py-4 space-y-3 bg-[#FBF8F2]">
        <textarea
            value={editingData?.title || ''}
            onChange={(e) => onEditDataChange({ ...editingData, title: e.target.value })}
            rows={2}
            className="w-full bg-[#F5F2E9] border border-transparent rounded-lg px-3.5 py-2.5 text-[13px] font-medium text-ink focus:border-ochre/50 focus:outline-none resize-none"
        />
                <div className="grid grid-cols-2 gap-3">
                    <DatePicker
                        value={editingData?.date || ''}
                        onChange={(v) => onEditDataChange({ ...editingData, date: v })}
                        variant="compact"
                    />
                    <TimeInput
                        value={editingData?.time || ''}
                        onChange={(v) => onEditDataChange({ ...editingData, time: v })}
                        variant="compact"
                    />
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={onSaveEdit}
                        className="flex-1 h-9 rounded-lg text-[11px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] transition-colors"
                    >
                        Сохранить
                    </button>
                    <button
                        type="button"
                        onClick={onCancelEdit}
                        className="px-4 h-9 rounded-lg text-[11px] font-semibold bg-surface-2 text-ink-3 hover:text-ink transition-colors"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            id={`task-${task.id}`}
            className={cn(
                'px-4 py-3.5 flex items-center gap-3 group transition-colors',
                task.completed ? 'bg-[#FAFAF7]/60' : 'hover:bg-[#F5F2E9]/50'
            )}
        >
            <button
                type="button"
                onClick={() => onToggle(task)}
                disabled={!canEdit}
                className={cn(
                    'w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-all shrink-0',
                    task.completed
                        ? 'bg-[#4fb47c] border-[#4fb47c]'
                        : 'border-[#C8C0AE] bg-white hover:border-[#A67C3C]'
                )}
            >
                {task.completed && <Check size={11} className="text-white stroke-[3px]" />}
            </button>

            <div className="w-[52px] flex flex-col items-center shrink-0 text-center leading-none">
                {task.date ? (
                    <>
            <span
                className={cn(
                    'text-[15px] font-semibold tabular-nums',
                    task.completed ? 'text-ink-3' : 'text-ink'
                )}
            >
              {day}
            </span>
                        <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-ink-3 mt-0.5">
              {month}
            </span>
                        {timeLabel && (
                            <span className="text-[10px] text-ink-3 mt-1 tabular-nums">{timeLabel}</span>
                        )}
                    </>
                ) : (
                    <Clock size={15} className="text-ink-4/50 mt-1" strokeWidth={1.75} />
                )}
            </div>

            <div className="flex-1 min-w-0 py-0.5">
                <p
                    className={cn(
                        'text-[13px] font-medium leading-snug',
                        task.completed ? 'text-ink-3 line-through' : 'text-ink'
                    )}
                >
                    {task.title}
                </p>
                {!task.date && (
                    <p className="text-[10px] text-ink-3 mt-0.5">без даты</p>
                )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
                {canEdit && onBeginEdit && (
                    <button
                        type="button"
                        onClick={() => onBeginEdit(task)}
                        className="p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-black/[0.04] transition-colors"
                        title="Редактировать"
                    >
                        <Pencil size={13} strokeWidth={1.75} />
                    </button>
                )}
                {canEdit && (
                    <button
                        type="button"
                        onClick={(e) => onDelete(e, task.id)}
                        className="p-1.5 rounded-md text-ink-3 hover:text-terracotta hover:bg-terracotta/5 transition-colors"
                        title="Удалить"
                    >
                        <Trash2 size={13} strokeWidth={1.75} />
                    </button>
                )}
            </div>
        </div>
    );
}



export default ActivityTab;