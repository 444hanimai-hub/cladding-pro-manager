import React, { useState, useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import {
    MapPin,
    Briefcase,
    Calendar,
    Flag,
    ChevronDown,
    Circle,
    Check,
    CheckCircle2,
    Pencil,
    FolderOpen,
    ExternalLink,
    Loader2,
} from 'lucide-react';
import { ProjectStatus, STATUS_LABEL, STATUS_COLOR, STATUS_LIST } from '../../lib/statuses';
import { cn, formatDateForInput, formatDateToDisplay } from '../../lib/utils';
import { todayLocalISO } from '../../lib/dates';
import { OperationType, handleFirestoreError } from '../../lib/firestore-errors';
import { SELLER_LEGAL_ENTITY_COMPANY_TYPE } from '../shared/DashboardFilters';
import { createProjectDriveFolder, isValidDriveFolderLink, buildProjectFolderName, formatDateYMD } from '../../lib/googleDriveFolders';
import { Project, AppUser, StakeholderGroup } from '../../types';
import { DatePicker } from '../ui/DatePicker';
import { PortalDropdown } from '../ui/PortalDropdown';
import CompanySelect from '../CompanySelect';
import UserAvatar from '../UserAvatar';
import StatusPill from '../StatusPill';
import EditField from './shared/EditField';
import StakeholderCard from './shared/StakeholderCard';
import StakeholderEditForm from './shared/StakeholderEditForm';

function PersonalInfoTab({ project, canEdit, users, accessToken, onConnectCalendar }: { project: Project, canEdit: boolean, users: AppUser[], accessToken?: string | null, onConnectCalendar?: () => Promise<boolean> }) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedProject, setEditedProject] = useState(() => ({
        ...project,
        createdAt: formatDateForInput(project.createdAt || (project as any).creationDate),
        deadline: formatDateForInput(project.deadline),
        actualCompletionDate: formatDateForInput(project.actualCompletionDate || project.completed)
    }));
    const [editingRole, setEditingRole] = useState<string | null>(null);

    const [managerDropdownOpen, setManagerDropdownOpen] = useState(false);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
    const statusTriggerRef = React.useRef<HTMLButtonElement>(null);
    const managerTriggerRef = React.useRef<HTMLButtonElement>(null);

    const getAsString = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        return formatDateForInput(val);
    };

    useEffect(() => {
        if (!isEditing) {
            setEditedProject({
                ...project,
                createdAt: formatDateForInput(project.createdAt || (project as any).creationDate),
                deadline: formatDateForInput(project.deadline),
                actualCompletionDate: formatDateForInput(project.actualCompletionDate || project.completed)
            });
        }
    }, [project, isEditing]);

    const handleSave = async () => {
        if (!canEdit) return;
        try {
            const { id, ...data } = editedProject;
            const leadManager = users.find(u => u.uid === editedProject.leadManagerId);
            const newLeadManagerName = leadManager?.displayName || '';
            const actualCompStr = getAsString(editedProject.actualCompletionDate);
            const finalCompletionDate = (actualCompStr && actualCompStr.trim() !== "") ? new Date(actualCompStr) : null;
            const createdStr = getAsString(editedProject.createdAt);
            const deadlineStr = getAsString(editedProject.deadline);
            const updateData: any = {
                ...data,
                createdAt: (createdStr && createdStr.trim() !== "") ? new Date(createdStr) : null,
                creationDate: (createdStr && createdStr.trim() !== "") ? new Date(createdStr) : null,
                deadline: (deadlineStr && deadlineStr.trim() !== "") ? new Date(deadlineStr) : null,
                actualCompletionDate: finalCompletionDate,
                completed: finalCompletionDate,
                leadManagerName: newLeadManagerName,
                updatedAt: serverTimestamp(),
                status: editedProject.status
            };
            await updateDoc(doc(db, 'projects', project.id), updateData);
            setEditedProject(prev => ({ ...prev, leadManagerName: newLeadManagerName }));
            setIsEditing(false);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const rawStatus = editedProject.status as any;
    const currentStatus: ProjectStatus =
        rawStatus === 'lead' || rawStatus === 'active' ? 'in_progress' :
            rawStatus === 'completed' ? 'done' :
                rawStatus === 'cancelled' ? 'canceled' :
                    (rawStatus as ProjectStatus) || 'in_progress';

    const handleStatusChange = (next: ProjectStatus) => {
        const prev = currentStatus;
        let newActualCompletion = editedProject.actualCompletionDate;

        // При переключении на "Завершён" или "Отменён" — проставляем сегодняшнюю локальную дату,
        // если поле ещё не заполнено.
        if ((next === 'done' || next === 'canceled') && (!newActualCompletion || getAsString(newActualCompletion).trim() === '')) {
            newActualCompletion = todayLocalISO();
        }

        // При смене статуса с «Завершён» или «Отменён» на любой другой («В работе» или др.) — поле «Дата фактического завершения» нужно очищать автоматически
        if ((prev === 'done' || prev === 'canceled') && next !== 'done' && next !== 'canceled') {
            newActualCompletion = '';
        }

        setEditedProject(prevProj => ({
            ...prevProj,
            status: next,
            actualCompletionDate: newActualCompletion
        }));
    };

    const s = project.stakeholders || {};

    return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5">
            {/* Левая колонка: Основная информация + Документы */}
            <div className="flex flex-col gap-5">
                {/* Основная информация */}
                <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
                    <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
                        <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Основная информация</h3>
                        {canEdit && (
                            <button
                                type="button"
                                onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                            >
                                {isEditing
                                    ? <><Check size={12} /> Готово</>
                                    : <><Pencil size={12} /> Редактировать</>}
                            </button>
                        )}
                    </div>

                    <div className="px-5 py-1 divide-y divide-line">
                        <EditField label="Наименование проекта" value={editedProject.name} isEditing={isEditing} onChange={(v) => setEditedProject({...editedProject, name: v})} icon={<Briefcase />} placeholder="не указано" />
                        <EditField label="Адрес объекта" value={editedProject.address} isEditing={isEditing} onChange={(v) => setEditedProject({...editedProject, address: v})} icon={<MapPin />} placeholder="не указан" />

                        {/* Статус */}
                        <div className="grid items-start gap-3.5 py-3.5 relative" style={{ gridTemplateColumns: '32px 1fr' }}>
                            <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink-3 shrink-0">
                                {isEditing ? (
                                    <Circle size={14} className="text-ink-3" />
                                ) : (
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[currentStatus] }} />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Статус</p>
                                <div className="max-w-[220px]">
                                    {isEditing ? (
                                        <div className="relative">
                                            <button
                                                ref={statusTriggerRef}
                                                type="button"
                                                onClick={() => setStatusDropdownOpen(o => !o)}
                                                className="w-full flex items-center justify-between gap-2 bg-surface border border-line rounded-md px-3 py-2.5 text-[13px] text-ink hover:bg-surface-2 focus:border-ochre focus:outline-none transition-colors"
                                            >
                        <span className="inline-flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[currentStatus] }} />
                            {STATUS_LABEL[currentStatus]}
                        </span>
                                                <ChevronDown size={14} className="text-ink-3 shrink-0" />
                                            </button>
                                            <PortalDropdown
                                                anchorRef={statusTriggerRef}
                                                open={statusDropdownOpen}
                                                onClose={() => setStatusDropdownOpen(false)}
                                            >
                                                {STATUS_LIST.map(s => (
                                                    <button
                                                        key={s}
                                                        type="button"
                                                        onClick={() => {
                                                            handleStatusChange(s);
                                                            setStatusDropdownOpen(false);
                                                        }}
                                                        className={cn(
                                                            "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                                                            s === currentStatus
                                                                ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold"
                                                                : "text-ink hover:bg-surface-2"
                                                        )}
                                                    >
                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[s] }} />
                                                        <span className="truncate">{STATUS_LABEL[s]}</span>
                                                    </button>
                                                ))}
                                            </PortalDropdown>
                                        </div>
                                    ) : (
                                        <StatusPill status={currentStatus} />
                                    )}
                                </div>
                            </div>
                        </div>

                        <EditField
                            label="Дата создания"
                            value={isEditing ? formatDateForInput(editedProject.createdAt) : formatDateToDisplay(editedProject.createdAt)}
                            isEditing={isEditing}
                            type="date"
                            onChange={(v) => setEditedProject({...editedProject, createdAt: v})}
                            icon={<Calendar />}
                            placeholder="не указана"
                        />
                        <EditField label="Срок проекта" value={isEditing ? formatDateForInput(editedProject.deadline) : formatDateToDisplay(editedProject.deadline)} isEditing={isEditing} type="date" onChange={(v) => setEditedProject({...editedProject, deadline: v})} icon={<Flag />} placeholder="не указан" />

                        {(currentStatus === 'done' || (editedProject.actualCompletionDate && getAsString(editedProject.actualCompletionDate).trim() !== "")) && (
                            <EditField
                                label="Дата фактического завершения"
                                value={isEditing ? formatDateForInput(editedProject.actualCompletionDate) : formatDateToDisplay(editedProject.actualCompletionDate)}
                                isEditing={isEditing}
                                type="date"
                                onChange={(v) => setEditedProject({...editedProject, actualCompletionDate: v})}
                                icon={<CheckCircle2 />}
                                placeholder="не указана"
                            />
                        )}

                        {/* Ведущий менеджер */}
                        <div className="grid items-start gap-3.5 py-3.5 relative" style={{ gridTemplateColumns: '32px 1fr' }}>
                            {editedProject.leadManagerId && editedProject.leadManagerName ? (
                                <UserAvatar
                                    uid={editedProject.leadManagerId}
                                    name={editedProject.leadManagerName}
                                    size="sm"
                                />
                            ) : (
                                <UserAvatar
                                    uid=""
                                    name=""
                                    size="sm"
                                />
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Ведущий менеджер</p>
                                <div className="max-w-[260px]">
                                    {isEditing ? (
                                        <div className="relative">
                                            <button
                                                ref={managerTriggerRef}
                                                type="button"
                                                onClick={() => setManagerDropdownOpen(o => !o)}
                                                className="w-full flex items-center justify-between gap-2 bg-surface border border-line rounded-md px-3 py-2.5 text-[13px] text-ink hover:bg-surface-2 focus:border-ochre focus:outline-none transition-colors"
                                            >
                        <span className={editedProject.leadManagerId ? "" : "text-ink-4"}>
                          {users.find(u => u.uid === editedProject.leadManagerId)?.displayName || 'Не назначен'}
                        </span>
                                                <ChevronDown size={14} className="text-ink-3 shrink-0" />
                                            </button>
                                            <PortalDropdown
                                                anchorRef={managerTriggerRef}
                                                open={managerDropdownOpen}
                                                onClose={() => setManagerDropdownOpen(false)}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setEditedProject({ ...editedProject, leadManagerId: '', leadManagerName: '' });
                                                        setManagerDropdownOpen(false);
                                                    }}
                                                    className={cn(
                                                        "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                                                        !editedProject.leadManagerId
                                                            ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold"
                                                            : "text-ink hover:bg-surface-2"
                                                    )}
                                                >
                                                    <UserAvatar uid="" name="" size="xs" />
                                                    <span className="truncate">Не назначен</span>
                                                </button>
                                                {users.map(u => (
                                                    <button
                                                        key={u.uid}
                                                        type="button"
                                                        onClick={() => {
                                                            setEditedProject({ ...editedProject, leadManagerId: u.uid, leadManagerName: u.displayName });
                                                            setManagerDropdownOpen(false);
                                                        }}
                                                        className={cn(
                                                            "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors",
                                                            u.uid === editedProject.leadManagerId
                                                                ? "bg-[var(--ochre-bg)] text-[var(--ochre)] font-semibold"
                                                                : "text-ink hover:bg-surface-2"
                                                        )}
                                                    >
                                                        <UserAvatar
                                                            uid={u.uid}
                                                            name={u.displayName}
                                                            photoURL={u.photoURL}
                                                            size="xs"
                                                        />
                                                        <span className="truncate">{u.displayName}</span>
                                                    </button>
                                                ))}
                                            </PortalDropdown>
                                        </div>
                                    ) : (
                                        editedProject.leadManagerName
                                            ? <p className="text-[14px] font-medium text-ink leading-snug">{editedProject.leadManagerName}</p>
                                            : <p className="text-[14px] italic text-ink-4 leading-snug">не назначен</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Юр. лицо для продажи */}
                        <div className="grid items-start gap-3.5 py-3.5" style={{ gridTemplateColumns: '32px 1fr' }}>
                            <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink-3 shrink-0">
                                <Briefcase size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Юр. лицо для продажи</p>
                                <div className="max-w-[280px]">
                                    {isEditing ? (
                                        <CompanySelect
                                            value={editedProject.sellerLegalEntityName || ''}
                                            onChange={(name, id) => setEditedProject({
                                                ...editedProject,
                                                sellerLegalEntityName: name,
                                                sellerLegalEntityId: id || ''
                                            })}
                                            placeholder="Выбрать юр. лицо..."
                                            companyType={SELLER_LEGAL_ENTITY_COMPANY_TYPE}
                                        />
                                    ) : (
                                        editedProject.sellerLegalEntityName
                                            ? <p className="text-[14px] font-medium text-ink leading-snug">{editedProject.sellerLegalEntityName}</p>
                                            : <p className="text-[14px] italic text-ink-4 leading-snug">не указано</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Документы */}
                <ProjectDriveFolder project={project} canEdit={canEdit} accessToken={accessToken} onConnectCalendar={onConnectCalendar} />
            </div>

            {/* Правая колонка: Участники проекта */}
            <div className="flex flex-col gap-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 px-1">Участники проекта</p>
                <StakeholderCard title="Заказчик" data={s.client} onEdit={() => setEditingRole('client')} canEdit={canEdit} />
                <StakeholderCard title="Генподрядчик" data={s.generalContractor} onEdit={() => setEditingRole('generalContractor')} canEdit={canEdit} />
                <StakeholderCard title="Подрядчик" data={s.subcontractor} onEdit={() => setEditingRole('subcontractor')} canEdit={canEdit} />
                <StakeholderCard title="Архитектор" data={s.architect} onEdit={() => setEditingRole('architect')} canEdit={canEdit} />
            </div>

            <AnimatePresence>
                {editingRole && (
                    <StakeholderEditForm
                        projectId={project.id}
                        role={editingRole}
                        currentData={s[editingRole as keyof typeof s] as StakeholderGroup | undefined}
                        onClose={() => setEditingRole(null)}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}


/**
 * Блок «Документы» — вместо загрузки файлов в саму CRM здесь только ссылка на
 * папку проекта на Google Drive (заказчик хранит документы там). Два способа
 * привязать папку: вставить готовую ссылку вручную (если уже собирали документы
 * до создания проекта в системе) или создать новую папку одним кликом.
 */
function ProjectDriveFolder({ project, canEdit, accessToken, onConnectCalendar }: {
    project: Project;
    canEdit: boolean;
    accessToken?: string | null;
    onConnectCalendar?: () => Promise<boolean>;
}) {
    const [isEditingLink, setIsEditingLink] = useState(!project.driveDocsFolderLink);
    const [linkInput, setLinkInput] = useState(project.driveDocsFolderLink || '');
    const [linkError, setLinkError] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    useEffect(() => {
        setLinkInput(project.driveDocsFolderLink || '');
        setIsEditingLink(!project.driveDocsFolderLink);
    }, [project.driveDocsFolderLink]);

    const saveFolderLink = async (folderId: string | null, folderLink: string) => {
        try {
            await updateDoc(doc(db, 'projects', project.id), {
                driveDocsFolderId: folderId || null,
                driveDocsFolderLink: folderLink,
                updatedAt: serverTimestamp(),
            });
            setIsEditingLink(false);
        } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `projects/${project.id}`);
        }
    };

    const handleSaveManualLink = async () => {
        const trimmed = linkInput.trim();
        if (!trimmed) {
            setLinkError('Вставьте ссылку на папку.');
            return;
        }
        if (!isValidDriveFolderLink(trimmed)) {
            setLinkError('Похоже, это не ссылка на папку Google Drive.');
            return;
        }
        setLinkError(null);
        await saveFolderLink(null, trimmed);
    };

    const handleCreateFolder = async () => {
        if (!accessToken) return;
        setIsCreating(true);
        try {
            const dateYMD = formatDateYMD(project.createdAt || (project as any).creationDate);
            const folderName = buildProjectFolderName(dateYMD, project.name, project.leadManagerName || '');
            const { id, link } = await createProjectDriveFolder(folderName, accessToken);
            await saveFolderLink(id, link);
        } catch (error) {
            console.error('Не удалось создать папку на Google Drive:', error);
            alert('Не удалось создать папку на Google Drive. Попробуйте ещё раз или вставьте ссылку на уже существующую папку вручную.');
        } finally {
            setIsCreating(false);
        }
    };

    const handleConnectGoogle = async () => {
        if (!onConnectCalendar || isConnecting) return;
        setIsConnecting(true);
        try {
            await onConnectCalendar();
        } finally {
            setIsConnecting(false);
        }
    };

    return (
        <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)]">
            <div className="px-5 py-4 flex items-center justify-between gap-3 border-b border-line">
                <h3 className="font-display text-[17px] font-medium text-ink leading-tight">Документы</h3>
                {canEdit && !isEditingLink && project.driveDocsFolderLink && (
                    <button
                        type="button"
                        onClick={() => setIsEditingLink(true)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-ink-2 border border-line bg-surface hover:bg-surface-2 transition-colors"
                    >
                        <Pencil size={12} /> Изменить
                    </button>
                )}
            </div>

            <div className="px-5 py-4">
                {!isEditingLink && project.driveDocsFolderLink ? (
                    <a
                        href={project.driveDocsFolderLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-line bg-surface-2 hover:bg-surface-2/70 transition-colors text-[13px] font-semibold text-ink"
                    >
                        <FolderOpen size={16} className="text-ochre shrink-0" />
                        Открыть папку с документами
                        <ExternalLink size={12} className="text-ink-3 shrink-0" />
                    </a>
                ) : canEdit ? (
                    <div className="space-y-3">
                        {!accessToken && onConnectCalendar && (
                            <div className="rounded-xl border border-ochre/35 bg-[#FBF5E8] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <p className="text-[12px] text-ink-3 leading-snug">
                                    Чтобы создать папку автоматически, подключите Google.
                                </p>
                                <button
                                    type="button"
                                    onClick={handleConnectGoogle}
                                    disabled={isConnecting}
                                    className="shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold bg-[#A67C3C] text-white hover:bg-[#956f35] disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    {isConnecting ? 'Подключение…' : 'Подключить Google'}
                                </button>
                            </div>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="flex-1">
                                <input
                                    value={linkInput}
                                    onChange={e => { setLinkInput(e.target.value); setLinkError(null); }}
                                    placeholder="Вставьте ссылку на папку Google Drive..."
                                    className="w-full bg-surface border border-line rounded-md px-3 h-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4"
                                />
                                {linkError && <p className="text-[11px] text-terracotta mt-1">{linkError}</p>}
                            </div>
                            <button
                                type="button"
                                onClick={handleSaveManualLink}
                                className="shrink-0 h-9 px-4 rounded-md text-[12.5px] font-semibold bg-ink text-bg hover:bg-ink/90 transition-colors"
                            >
                                Сохранить
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="h-px flex-1 bg-line" />
                            <span className="text-[10.5px] uppercase tracking-wide text-ink-4">или</span>
                            <div className="h-px flex-1 bg-line" />
                        </div>
                        <button
                            type="button"
                            onClick={handleCreateFolder}
                            disabled={!accessToken || isCreating}
                            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-md text-[12.5px] font-semibold border border-line bg-surface hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isCreating ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                            {isCreating ? 'Создаём папку…' : 'Создать папку на Google Диске'}
                        </button>
                    </div>
                ) : (
                    <p className="text-[13px] italic text-ink-4">Папка с документами ещё не привязана</p>
                )}
            </div>
        </div>
    );
}

export default PersonalInfoTab;