const request = require('supertest');
const app = require('../../app');
const { Task } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');

// The relation picker asks the server to narrow the candidate list, so it is
// not limited to whichever tasks happen to come back in the first page.
describe('Tasks API search filter', () => {
    let user, agent;

    beforeEach(async () => {
        user = await createTestUser({
            email: `tasks_search_${Date.now()}@example.com`,
        });
        agent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
    });

    async function createTask(name) {
        return await Task.create({ user_id: user.id, name });
    }

    it('returns only the tasks whose name matches', async () => {
        await createTask('Order the cabinets');
        await createTask('Measure the cabinet run');
        await createTask('Book the electrician');

        const res = await agent.get(
            '/api/tasks?type=all&status=all&search=cabinet'
        );

        expect(res.status).toBe(200);
        expect(res.body.tasks.map((t) => t.name).sort()).toEqual([
            'Measure the cabinet run',
            'Order the cabinets',
        ]);
    });

    it('matches regardless of case', async () => {
        await createTask('Order the Cabinets');

        const res = await agent.get(
            '/api/tasks?type=all&status=all&search=CABINETS'
        );

        expect(res.body.tasks.map((t) => t.name)).toEqual([
            'Order the Cabinets',
        ]);
    });

    it('reaches a task that a single page would not have returned', async () => {
        // Created first, so the newest-first default ordering pushes it well
        // past the first page.
        await createTask('Needle in the haystack');
        for (let i = 0; i < 30; i += 1) {
            await createTask(`Filler task ${i}`);
        }

        const unfiltered = await agent.get(
            '/api/tasks?type=all&status=all&limit=5'
        );
        expect(unfiltered.body.tasks.map((t) => t.name)).not.toContain(
            'Needle in the haystack'
        );

        const filtered = await agent.get(
            '/api/tasks?type=all&status=all&limit=5&search=Needle'
        );
        expect(filtered.body.tasks.map((t) => t.name)).toEqual([
            'Needle in the haystack',
        ]);
    });

    it('is ignored when blank, so the list is unchanged', async () => {
        await createTask('Order the cabinets');
        await createTask('Book the electrician');

        const res = await agent.get(
            '/api/tasks?type=all&status=all&search=%20%20'
        );

        expect(res.body.tasks).toHaveLength(2);
    });
});
