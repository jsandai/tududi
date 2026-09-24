import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    ArrowRightIcon,
    LinkIcon,
    LockClosedIcon,
    PlusIcon,
    TrashIcon,
} from '@heroicons/react/24/outline';
import { Task, TaskRelation, TaskRelationType } from '../../../entities/Task';
import {
    createTaskRelation,
    fetchRelationTaskOptions,
    fetchTaskRelations,
    removeTaskRelation,
} from '../../../utils/tasksService';
import { useToast } from '../../Shared/ToastContext';

interface TaskRelationsCardProps {
    task: Task;
}

const RELATION_TYPES: TaskRelationType[] = [
    'blocks',
    'blocked_by',
    'related_to',
    'duplicates',
    'duplicated_by',
];

const TaskRelationsCard: React.FC<TaskRelationsCardProps> = ({ task }) => {
    const { t } = useTranslation();
    const { showErrorToast } = useToast();
    const [relations, setRelations] = useState<TaskRelation[]>([]);
    const [taskOptions, setTaskOptions] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedTaskUid, setSelectedTaskUid] = useState('');
    const [selectedType, setSelectedType] =
        useState<TaskRelationType>('related_to');

    // The details view swaps task.uid without unmounting. A uid is not enough
    // to tell one visit from another, because leaving a task and coming back
    // reuses it, so each visit and each load carry their own number: a visit
    // for work that must belong to the task on screen, a load for discarding
    // an earlier response that arrives after a later one.
    const visitRef = useRef(0);
    const loadSeqRef = useRef(0);

    const loadRelations = async () => {
        if (!task.uid) return;
        const uid = task.uid;
        const seq = (loadSeqRef.current += 1);
        setLoading(true);
        try {
            const loaded = await fetchTaskRelations(uid);
            if (loadSeqRef.current !== seq) return;
            setRelations(loaded);
        } catch (error) {
            if (loadSeqRef.current !== seq) return;
            console.error('Failed to load task relations:', error);
            showErrorToast(t('taskRelations.loadError'));
        } finally {
            if (loadSeqRef.current === seq) setLoading(false);
        }
    };

    useEffect(() => {
        visitRef.current += 1;
        setRelations([]);
        setTaskOptions([]);
        // saving belongs to the task being shown. A write left in flight on
        // the previous task will not clear it, so clear it here instead.
        setSaving(false);
        closePicker();
        void loadRelations();
    }, [task.uid]);

    const closePicker = () => {
        setIsAdding(false);
        setSearch('');
        setSelectedTaskUid('');
        setSelectedType('related_to');
    };

    const openPicker = () => setIsAdding(true);

    // Candidates come from the server so the picker is not limited to a window
    // of recent tasks, and they are refetched per task, so a list filtered for
    // the previous task is never reused.
    useEffect(() => {
        if (!isAdding || !task.uid) return;
        const uid = task.uid;
        const visit = visitRef.current;
        let cancelled = false;

        const timer = setTimeout(async () => {
            setLoadingOptions(true);
            try {
                const options = await fetchRelationTaskOptions(search);
                if (cancelled || visitRef.current !== visit) return;
                setTaskOptions(
                    options.filter((option) => option.uid !== uid)
                );
            } catch (error) {
                if (cancelled) return;
                console.error('Failed to load relation task options:', error);
                showErrorToast(t('taskRelations.optionsError'));
            } finally {
                if (!cancelled) setLoadingOptions(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isAdding, search, task.uid]);

    const filteredOptions = taskOptions;

    const handleCreate = async () => {
        if (!task.uid || !selectedTaskUid) return;
        const uid = task.uid;
        const visit = visitRef.current;
        setSaving(true);
        try {
            await createTaskRelation(uid, selectedTaskUid, selectedType);
            // A write started on one visit can land after navigating away.
            // Reloading here would reload the task this handler was built for,
            // not the one on screen.
            if (visitRef.current !== visit) return;
            closePicker();
            await loadRelations();
        } catch (error) {
            if (visitRef.current !== visit) return;
            console.error('Failed to create task relation:', error);
            // Show why the server refused: a cycle, or a pair already stored.
            showErrorToast(
                error instanceof Error && error.message
                    ? error.message
                    : t('taskRelations.createError')
            );
        } finally {
            if (visitRef.current === visit) setSaving(false);
        }
    };

    const handleRemove = async (relationUid: string) => {
        if (!task.uid) return;
        const uid = task.uid;
        const visit = visitRef.current;
        try {
            await removeTaskRelation(uid, relationUid);
            if (visitRef.current !== visit) return;
            setRelations((current) =>
                current.filter((relation) => relation.uid !== relationUid)
            );
        } catch (error) {
            if (visitRef.current !== visit) return;
            console.error('Failed to remove task relation:', error);
            showErrorToast(t('taskRelations.removeError'));
        }
    };

    const relationLabel = (type: TaskRelationType) =>
        t(`taskRelations.types.${type}`);

    return (
        <section className="rounded-lg shadow-sm bg-white dark:bg-gray-900 border-2 border-gray-50 dark:border-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-3">
                <div className="flex items-center gap-2">
                    <LinkIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {t('taskRelations.title')}
                    </h2>
                </div>
                {!isAdding && (
                    <button
                        type="button"
                        onClick={openPicker}
                        className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                        <PlusIcon className="h-4 w-4" />
                        {t('taskRelations.add')}
                    </button>
                )}
            </div>

            {isAdding && (
                <div className="space-y-3 border-b border-gray-100 dark:border-gray-800 p-4">
                    <select
                        aria-label={t('taskRelations.selectType')}
                        value={selectedType}
                        onChange={(event) =>
                            setSelectedType(
                                event.target.value as TaskRelationType
                            )
                        }
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                        {RELATION_TYPES.map((type) => (
                            <option key={type} value={type}>
                                {relationLabel(type)}
                            </option>
                        ))}
                    </select>
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t('taskRelations.searchTasks')}
                        className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <div className="max-h-44 overflow-y-auto rounded-md border border-gray-100 dark:border-gray-700">
                        {loadingOptions ? (
                            <p className="px-3 py-4 text-center text-sm text-gray-500">
                                {t('common.loading')}
                            </p>
                        ) : filteredOptions.length === 0 ? (
                            <p className="px-3 py-4 text-center text-sm text-gray-500">
                                {t('taskRelations.noTasks')}
                            </p>
                        ) : (
                            filteredOptions.map((option) => (
                                <button
                                    key={option.uid}
                                    type="button"
                                    onClick={() =>
                                        setSelectedTaskUid(option.uid || '')
                                    }
                                    className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                                        selectedTaskUid === option.uid
                                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                                    }`}
                                >
                                    {option.original_name || option.name}
                                </button>
                            ))
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={closePicker}
                            className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            disabled={!selectedTaskUid || saving}
                            onClick={handleCreate}
                            className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving
                                ? t('taskRelations.saving')
                                : t('common.create')}
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="px-4 py-6 text-center text-sm text-gray-500">
                    {t('common.loading')}
                </p>
            ) : relations.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    {t('taskRelations.empty')}
                </p>
            ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {relations.map((relation) => (
                        <div
                            key={relation.uid}
                            className="flex items-center gap-3 px-4 py-3"
                        >
                            {relation.type === 'blocked_by' ? (
                                <LockClosedIcon className="h-4 w-4 flex-shrink-0 text-amber-500" />
                            ) : (
                                <LinkIcon className="h-4 w-4 flex-shrink-0 text-gray-400" />
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {relationLabel(relation.type)}
                                </p>
                                <Link
                                    to={`/task/${relation.related_task.uid}`}
                                    className="inline-flex max-w-full items-center gap-1 text-sm text-gray-900 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
                                >
                                    <span className="truncate">
                                        {relation.related_task.name}
                                    </span>
                                    <ArrowRightIcon className="h-3.5 w-3.5 flex-shrink-0" />
                                </Link>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleRemove(relation.uid)}
                                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                title={t('taskRelations.remove')}
                            >
                                <TrashIcon className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};

export default TaskRelationsCard;
