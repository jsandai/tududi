const request = require('supertest');
const app = require('../../app');
const { Task } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');

// The Completed filter means "finished", which covers done and archived alike.
// Resolving 'done' to an exact status match drops every archived task.
describe('Tasks API completed status filter', () => {
    let user, agent;

    beforeEach(async () => {
        user = await createTestUser({
            email: 'completed-filter-test@example.com',
        });

        agent = request.agent(app);
        await agent.post('/api/login').send({
            email: 'completed-filter-test@example.com',
            password: 'password123',
        });

        await Task.create({
            user_id: user.id,
            name: 'Done task',
            status: Task.STATUS.DONE,
        });
        await Task.create({
            user_id: user.id,
            name: 'Archived task',
            status: Task.STATUS.ARCHIVED,
        });
        await Task.create({
            user_id: user.id,
            name: 'Open task',
            status: Task.STATUS.NOT_STARTED,
        });
    });

    const names = (res) => (res.body.tasks || res.body).map((t) => t.name);

    it('includes archived tasks when filtering by done', async () => {
        const res = await agent.get('/api/tasks?type=all&status=done');

        expect(res.status).toBe(200);
        expect(names(res).sort()).toEqual(['Archived task', 'Done task']);
    });

    it('includes archived tasks when filtering by completed', async () => {
        const res = await agent.get('/api/tasks?type=all&status=completed');

        expect(res.status).toBe(200);
        expect(names(res).sort()).toEqual(['Archived task', 'Done task']);
    });

    it('still narrows to a single status for other status values', async () => {
        const res = await agent.get('/api/tasks?type=all&status=not_started');

        expect(res.status).toBe(200);
        expect(names(res)).toEqual(['Open task']);
    });
});
