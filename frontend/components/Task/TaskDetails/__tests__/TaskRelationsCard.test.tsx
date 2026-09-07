import React from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import TaskRelationsCard from '../TaskRelationsCard';
import {
    createTaskRelation,
    fetchRelationTaskOptions,
    fetchTaskRelations,
    removeTaskRelation,
} from '../../../../utils/tasksService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

const mockShowErrorToast = jest.fn();

jest.mock('../../../Shared/ToastContext', () => ({
    useToast: () => ({
        showErrorToast: mockShowErrorToast,
    }),
}));

jest.mock('../../../../utils/tasksService', () => ({
    createTaskRelation: jest.fn(),
    fetchRelationTaskOptions: jest.fn(),
    fetchTaskRelations: jest.fn(),
    removeTaskRelation: jest.fn(),
}));

const mockedCreateTaskRelation = createTaskRelation as jest.MockedFunction<
    typeof createTaskRelation
>;
const mockedFetchRelationTaskOptions =
    fetchRelationTaskOptions as jest.MockedFunction<
        typeof fetchRelationTaskOptions
    >;
const mockedFetchTaskRelations = fetchTaskRelations as jest.MockedFunction<
    typeof fetchTaskRelations
>;
const mockedRemoveTaskRelation = removeTaskRelation as jest.MockedFunction<
    typeof removeTaskRelation
>;

const task = {
    id: 1,
    uid: 'current-task',
    name: 'Current task',
    status: 'not_started' as const,
    completed_at: null,
};

describe('TaskRelationsCard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedFetchTaskRelations.mockResolvedValue([]);
        mockedFetchRelationTaskOptions.mockResolvedValue([]);
        mockedCreateTaskRelation.mockResolvedValue({
            uid: 'relation-2',
            type: 'blocks',
            related_task: {
                id: 2,
                uid: 'other-task',
                name: 'Other task',
                status: 'not_started',
            },
        });
        mockedRemoveTaskRelation.mockResolvedValue();
    });

    it('shows an existing relation and removes it', async () => {
        mockedFetchTaskRelations.mockResolvedValue([
            {
                uid: 'relation-1',
                type: 'blocked_by',
                related_task: {
                    id: 2,
                    uid: 'blocker-task',
                    name: 'Prepare materials',
                    status: 'not_started',
                },
            },
        ]);

        render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        expect(
            await screen.findByText('Prepare materials')
        ).toBeInTheDocument();
        expect(
            screen.getByText('taskRelations.types.blocked_by')
        ).toBeInTheDocument();

        fireEvent.click(screen.getByTitle('taskRelations.remove'));

        await waitFor(() => {
            expect(mockedRemoveTaskRelation).toHaveBeenCalledWith(
                'current-task',
                'relation-1'
            );
        });
        expect(screen.queryByText('Prepare materials')).not.toBeInTheDocument();
    });

    it('creates a selected relation through the picker', async () => {
        mockedFetchRelationTaskOptions.mockResolvedValue([
            task,
            {
                id: 2,
                uid: 'other-task',
                name: 'Ship release',
                status: 'not_started',
                completed_at: null,
            },
        ]);

        render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        fireEvent.change(screen.getByLabelText('taskRelations.selectType'), {
            target: { value: 'blocks' },
        });
        fireEvent.click(await screen.findByText('Ship release'));
        fireEvent.click(screen.getByText('common.create'));

        await waitFor(() => {
            expect(mockedCreateTaskRelation).toHaveBeenCalledWith(
                'current-task',
                'other-task',
                'blocks'
            );
        });
    });

    it('reports why the server refused a relation', async () => {
        mockedFetchRelationTaskOptions.mockResolvedValue([
            {
                id: 2,
                uid: 'other-task',
                name: 'Ship release',
                status: 'not_started',
                completed_at: null,
            },
        ]);
        mockedCreateTaskRelation.mockRejectedValue(
            new Error('This blocking relation would create a cycle.')
        );

        render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        fireEvent.click(await screen.findByText('Ship release'));
        fireEvent.click(screen.getByText('common.create'));

        await waitFor(() => {
            expect(mockShowErrorToast).toHaveBeenCalledWith(
                'This blocking relation would create a cycle.'
            );
        });
    });

    it('drops the pending selection when the picker is cancelled', async () => {
        mockedFetchRelationTaskOptions.mockResolvedValue([
            {
                id: 2,
                uid: 'other-task',
                name: 'Ship release',
                status: 'not_started',
                completed_at: null,
            },
        ]);

        render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        fireEvent.click(await screen.findByText('Ship release'));
        expect(screen.getByText('common.create')).not.toBeDisabled();

        fireEvent.click(screen.getByText('common.cancel'));
        fireEvent.click(screen.getByText('taskRelations.add'));

        expect(await screen.findByText('common.create')).toBeDisabled();
    });

    it('refetches candidates for the task it is now showing', async () => {
        mockedFetchRelationTaskOptions.mockResolvedValue([
            {
                id: 2,
                uid: 'other-task',
                name: 'Ship release',
                status: 'not_started',
                completed_at: null,
            },
        ]);

        const { rerender } = render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        await screen.findByText('Ship release');

        const secondTask = { ...task, id: 2, uid: 'other-task' };
        rerender(
            <MemoryRouter>
                <TaskRelationsCard task={secondTask} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));

        // The candidate list belongs to the task on screen, so the task itself
        // is never offered as its own relation target.
        await waitFor(() => {
            expect(screen.queryByText('Ship release')).not.toBeInTheDocument();
        });
    });

    it('ignores a relation response for a task it has navigated away from', async () => {
        let resolveFirst: (value: never[]) => void = () => {};
        mockedFetchTaskRelations.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveFirst = resolve as (value: never[]) => void;
                }) as ReturnType<typeof fetchTaskRelations>
        );
        mockedFetchTaskRelations.mockResolvedValueOnce([
            {
                uid: 'relation-2',
                type: 'blocks',
                related_task: {
                    id: 3,
                    uid: 'third-task',
                    name: 'Second task relation',
                    status: 'not_started',
                },
            },
        ]);

        const { rerender } = render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        const secondTask = { ...task, id: 2, uid: 'other-task' };
        rerender(
            <MemoryRouter>
                <TaskRelationsCard task={secondTask} />
            </MemoryRouter>
        );

        expect(
            await screen.findByText('Second task relation')
        ).toBeInTheDocument();

        // The first task's response lands late and must not replace what the
        // second task loaded. Flushing inside act settles the state update the
        // late response would make, so the assertion is not just early.
        await act(async () => {
            resolveFirst([]);
            await Promise.resolve();
        });

        expect(screen.getByText('Second task relation')).toBeInTheDocument();
    });

    it('does not reload the previous task after a create finishes late', async () => {
        mockedFetchRelationTaskOptions.mockResolvedValue([
            {
                id: 3,
                uid: 'third-task',
                name: 'Ship release',
                status: 'not_started',
                completed_at: null,
            },
        ]);

        let finishCreate: () => void = () => {};
        mockedCreateTaskRelation.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishCreate = () =>
                        resolve({
                            uid: 'relation-3',
                            type: 'blocks',
                            related_task: {
                                id: 3,
                                uid: 'third-task',
                                name: 'Ship release',
                                status: 'not_started',
                            },
                        });
                }) as ReturnType<typeof createTaskRelation>
        );

        const { rerender } = render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        fireEvent.click(await screen.findByText('Ship release'));
        fireEvent.click(screen.getByText('common.create'));

        const secondTask = { ...task, id: 2, uid: 'other-task' };
        mockedFetchTaskRelations.mockResolvedValue([
            {
                uid: 'relation-4',
                type: 'blocks',
                related_task: {
                    id: 4,
                    uid: 'fourth-task',
                    name: 'Second task relation',
                    status: 'not_started',
                },
            },
        ]);
        rerender(
            <MemoryRouter>
                <TaskRelationsCard task={secondTask} />
            </MemoryRouter>
        );
        await screen.findByText('Second task relation');

        const callsBefore = mockedFetchTaskRelations.mock.calls.length;

        // The create resolves against the task that has been left behind, so
        // its continuation must not reload that task over the current one.
        await act(async () => {
            finishCreate();
            await Promise.resolve();
        });

        const reloadedUids = mockedFetchTaskRelations.mock.calls
            .slice(callsBefore)
            .map(([uid]) => uid);
        expect(reloadedUids).not.toContain('current-task');
        expect(screen.getByText('Second task relation')).toBeInTheDocument();
    });

    it('can still create on the next task when a create is left in flight', async () => {
        mockedFetchRelationTaskOptions.mockResolvedValue([
            {
                id: 3,
                uid: 'third-task',
                name: 'Ship release',
                status: 'not_started',
                completed_at: null,
            },
        ]);
        // Never settles, standing in for a create the user navigates away from.
        mockedCreateTaskRelation.mockImplementationOnce(
            () => new Promise(() => {}) as ReturnType<typeof createTaskRelation>
        );

        const { rerender } = render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        fireEvent.click(await screen.findByText('Ship release'));
        fireEvent.click(screen.getByText('common.create'));

        const secondTask = { ...task, id: 2, uid: 'other-task' };
        rerender(
            <MemoryRouter>
                <TaskRelationsCard task={secondTask} />
            </MemoryRouter>
        );

        await screen.findByText('taskRelations.empty');
        fireEvent.click(screen.getByText('taskRelations.add'));
        fireEvent.click(await screen.findByText('Ship release'));

        // The abandoned create must not leave this task's Create disabled.
        expect(screen.getByText('common.create')).not.toBeDisabled();
    });

    it('ignores an earlier response after leaving a task and returning to it', async () => {
        let resolveFirstVisit: (value: never[]) => void = () => {};
        // First visit to A: still pending when the user leaves.
        mockedFetchTaskRelations.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveFirstVisit = resolve as (value: never[]) => void;
                }) as ReturnType<typeof fetchTaskRelations>
        );
        // Visit to B.
        mockedFetchTaskRelations.mockResolvedValueOnce([]);
        // Second visit to A, which is the one on screen at the end.
        mockedFetchTaskRelations.mockResolvedValueOnce([
            {
                uid: 'relation-5',
                type: 'blocks',
                related_task: {
                    id: 5,
                    uid: 'fifth-task',
                    name: 'Second visit relation',
                    status: 'not_started',
                },
            },
        ]);

        const secondTask = { ...task, id: 2, uid: 'other-task' };
        const { rerender } = render(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );
        rerender(
            <MemoryRouter>
                <TaskRelationsCard task={secondTask} />
            </MemoryRouter>
        );
        rerender(
            <MemoryRouter>
                <TaskRelationsCard task={task} />
            </MemoryRouter>
        );

        expect(
            await screen.findByText('Second visit relation')
        ).toBeInTheDocument();

        // Same uid as the visit on screen, but an older request: a uid alone
        // cannot tell the two apart.
        await act(async () => {
            resolveFirstVisit([]);
            await Promise.resolve();
        });

        expect(screen.getByText('Second visit relation')).toBeInTheDocument();
    });
});
