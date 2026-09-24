const request = require('supertest');
const app = require('../../app');
const { Task } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');

describe('Task relation routes', () => {
    let user;
    let agent;

    beforeEach(async () => {
        user = await createTestUser({
            email: `task_relation_routes_${Date.now()}@example.com`,
        });
        agent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
    });

    async function createTask(name) {
        return await Task.create({ user_id: user.id, name });
    }

    it('creates, lists, and removes a relation', async () => {
        const blocker = await createTask('Blocker');
        const blocked = await createTask('Blocked');

        const created = await agent
            .post(`/api/task/${blocked.uid}/relations`)
            .send({ related_task_uid: blocker.uid, type: 'blocked_by' });
        expect(created.status).toBe(201);
        expect(created.body.type).toBe('blocked_by');

        const listed = await agent.get(`/api/task/${blocked.uid}/relations`);
        expect(listed.status).toBe(200);
        expect(listed.body.relations).toHaveLength(1);
        expect(listed.body.relations[0].related_task.uid).toBe(blocker.uid);

        const removed = await agent.delete(
            `/api/task/${blocked.uid}/relations/${created.body.uid}`
        );
        expect(removed.status).toBe(200);
        expect(
            (await agent.get(`/api/task/${blocked.uid}/relations`)).body
                .relations
        ).toEqual([]);
    });

    it('does not reveal an inaccessible related task', async () => {
        const ownTask = await createTask('Own task');
        const otherUser = await createTestUser({
            email: `task_relation_routes_other_${Date.now()}@example.com`,
        });
        const hiddenTask = await Task.create({
            user_id: otherUser.id,
            name: 'Hidden task',
        });

        const response = await agent
            .post(`/api/task/${ownTask.uid}/relations`)
            .send({ related_task_uid: hiddenTask.uid, type: 'blocks' });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Task not found.');
    });

    it('returns a clear cycle error', async () => {
        const first = await createTask('First');
        const second = await createTask('Second');
        await agent
            .post(`/api/task/${first.uid}/relations`)
            .send({ related_task_uid: second.uid, type: 'blocks' });

        const response = await agent
            .post(`/api/task/${second.uid}/relations`)
            .send({ related_task_uid: first.uid, type: 'blocks' });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe(
            'This blocking relation would create a cycle.'
        );
    });
});
