const { Op } = require('sequelize');
const { Task, TaskRelation } = require('../../../../models');
const { createTestUser } = require('../../../helpers/testUtils');
const relationService = require('../../../../modules/tasks/relations/service');
const {
    computeSuggestedTasks,
} = require('../../../../modules/tasks/queries/metrics-computation');
const {
    serializeTasks,
} = require('../../../../modules/tasks/core/serializers');

describe('Task relation service', () => {
    let user;

    beforeEach(async () => {
        user = await createTestUser({
            email: `task_relations_${Date.now()}@example.com`,
        });
    });

    async function createTask(name, status = Task.STATUS.NOT_STARTED) {
        return await Task.create({ user_id: user.id, name, status });
    }

    it('returns directional and inverse relation names', async () => {
        const source = await createTask('Source');
        const target = await createTask('Target');

        await relationService.createRelation(
            user.id,
            source.uid,
            target.uid,
            'blocks'
        );

        const sourceRelations = await relationService.listRelations(
            user.id,
            source.uid
        );
        const targetRelations = await relationService.listRelations(
            user.id,
            target.uid
        );
        expect(sourceRelations[0].type).toBe('blocks');
        expect(sourceRelations[0].related_task.uid).toBe(target.uid);
        expect(targetRelations[0].type).toBe('blocked_by');
        expect(targetRelations[0].related_task.uid).toBe(source.uid);
    });

    it('stores a symmetric relation only once', async () => {
        const first = await createTask('First');
        const second = await createTask('Second');

        await relationService.createRelation(
            user.id,
            first.uid,
            second.uid,
            'related_to'
        );

        await expect(
            relationService.createRelation(
                user.id,
                second.uid,
                first.uid,
                'related_to'
            )
        ).rejects.toMatchObject({ status: 409 });
        expect(await TaskRelation.count()).toBe(1);
    });

    it('rejects a blocking cycle', async () => {
        const first = await createTask('First');
        const second = await createTask('Second');
        const third = await createTask('Third');
        await relationService.createRelation(
            user.id,
            first.uid,
            second.uid,
            'blocks'
        );
        await relationService.createRelation(
            user.id,
            second.uid,
            third.uid,
            'blocks'
        );

        await expect(
            relationService.createRelation(
                user.id,
                third.uid,
                first.uid,
                'blocks'
            )
        ).rejects.toThrow('This blocking relation would create a cycle.');
    });

    it('records a duplicate pair once in either direction', async () => {
        const original = await createTask('Original');
        const copy = await createTask('Copy');

        await relationService.createRelation(
            user.id,
            copy.uid,
            original.uid,
            'duplicates'
        );

        await expect(
            relationService.createRelation(
                user.id,
                original.uid,
                copy.uid,
                'duplicates'
            )
        ).rejects.toMatchObject({ status: 409 });
        expect(await TaskRelation.count()).toBe(1);
    });

    it('allows a blocking chain that rejoins without closing a cycle', async () => {
        const start = await createTask('Start');
        const left = await createTask('Left');
        const right = await createTask('Right');
        const end = await createTask('End');

        await relationService.createRelation(
            user.id,
            start.uid,
            left.uid,
            'blocks'
        );
        await relationService.createRelation(
            user.id,
            start.uid,
            right.uid,
            'blocks'
        );
        await relationService.createRelation(
            user.id,
            left.uid,
            end.uid,
            'blocks'
        );

        await relationService.createRelation(
            user.id,
            right.uid,
            end.uid,
            'blocks'
        );

        expect(await TaskRelation.count()).toBe(4);
    });

    it('requires write access to both tasks', async () => {
        const ownTask = await createTask('Own task');
        const otherUser = await createTestUser({
            email: `task_relations_other_${Date.now()}@example.com`,
        });
        const hiddenTask = await Task.create({
            user_id: otherUser.id,
            name: 'Hidden task',
        });

        await expect(
            relationService.createRelation(
                user.id,
                ownTask.uid,
                hiddenTask.uid,
                'blocks'
            )
        ).rejects.toMatchObject({ status: 404, message: 'Task not found.' });
        await expect(
            relationService.createRelation(
                user.id,
                hiddenTask.uid,
                ownTask.uid,
                'blocks'
            )
        ).rejects.toMatchObject({ status: 404, message: 'Task not found.' });
    });

    it('derives blocked state from the blocker status', async () => {
        const blocker = await createTask('Blocker');
        const blocked = await createTask('Blocked');
        const relation = await relationService.createRelation(
            user.id,
            blocker.uid,
            blocked.uid,
            'blocks'
        );

        await expect(relationService.isTaskBlocked(blocked.id)).resolves.toBe(
            true
        );
        await blocker.update({ status: Task.STATUS.DONE });
        await expect(relationService.isTaskBlocked(blocked.id)).resolves.toBe(
            false
        );
        await blocker.update({ status: Task.STATUS.NOT_STARTED });
        await expect(relationService.isTaskBlocked(blocked.id)).resolves.toBe(
            true
        );
        await blocker.update({ status: Task.STATUS.ARCHIVED });
        await expect(relationService.isTaskBlocked(blocked.id)).resolves.toBe(
            false
        );
        await blocker.update({ status: Task.STATUS.NOT_STARTED });
        await blocker.destroy();
        await expect(relationService.isTaskBlocked(blocked.id)).resolves.toBe(
            false
        );
        expect(await TaskRelation.count({ where: { uid: relation.uid } })).toBe(
            0
        );
    });

    it('excludes blocked tasks from suggestions', async () => {
        const blocker = await createTask('Blocker');
        const blocked = await createTask('Blocked');
        const available = await createTask('Available');
        await createTask('Another available task');
        await relationService.createRelation(
            user.id,
            blocker.uid,
            blocked.uid,
            'blocks'
        );

        const suggestions = await computeSuggestedTasks(
            { user_id: user.id },
            user.id,
            4,
            [],
            [],
            [],
            []
        );

        expect(suggestions.map((task) => task.id)).not.toContain(blocked.id);
        expect(suggestions.map((task) => task.id)).toContain(available.id);
    });

    it('excludes blocked tasks through the actionable predicate', async () => {
        const blocker = await createTask('Blocker');
        const blocked = await createTask('Blocked');
        const available = await createTask('Available');
        await relationService.createRelation(
            user.id,
            blocker.uid,
            blocked.uid,
            'blocks'
        );

        // The predicate is tested where it is defined. Its consumers, the MCP
        // task list today, are covered by their own tests.
        const tasks = await Task.findAll({
            where: {
                user_id: user.id,
                [Op.and]: [relationService.getActionableRelationPredicate()],
            },
        });

        const ids = tasks.map((task) => task.id);
        expect(ids).not.toContain(blocked.id);
        expect(ids).toContain(available.id);
        expect(ids).toContain(blocker.id);
    });

    it('serializes blocked state for tasks and their subtasks', async () => {
        const blocker = await createTask('Blocker');
        const parent = await createTask('Parent');
        const subtask = await Task.create({
            user_id: user.id,
            name: 'Subtask',
            parent_task_id: parent.id,
        });
        await relationService.createRelation(
            user.id,
            blocker.uid,
            parent.uid,
            'blocks'
        );
        await relationService.createRelation(
            user.id,
            blocker.uid,
            String(subtask.id),
            'blocks'
        );
        const loadedParent = await Task.findByPk(parent.id, {
            include: [{ model: Task, as: 'Subtasks' }],
        });

        const [serialized] = await serializeTasks([loadedParent], 'UTC');

        expect(serialized.is_blocked).toBe(true);
        expect(serialized.subtasks[0].is_blocked).toBe(true);
    });
});
