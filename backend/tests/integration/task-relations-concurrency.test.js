const { Task, sequelize } = require('../../models');
const { isPostgres } = require('../../utils/db-dialect');
const { createTestUser } = require('../helpers/testUtils');
const relationService = require('../../modules/tasks/relations/service');

// The race this guards against needs two writers committing at once, which
// SQLite cannot produce: it has a single writer. These assertions therefore
// only mean anything on PostgreSQL.
const onPostgres = isPostgres() ? describe : describe.skip;

onPostgres('Blocking graph serialisation', () => {
    let user;
    let holder;

    beforeEach(async () => {
        holder = null;
        user = await createTestUser({
            email: `relations_lock_${Date.now()}@example.com`,
        });
    });

    // A failed assertion must not leave the advisory lock held: the next test
    // would block on it and the suite would hang rather than report.
    afterEach(async () => {
        if (holder) {
            try {
                await holder.rollback();
            } catch {
                // already settled by the test
            }
            holder = null;
        }
    });

    const createTask = (name) =>
        Task.create({
            user_id: user.id,
            name,
            status: Task.STATUS.NOT_STARTED,
        });

    // Resolves to 'pending' if the promise has not settled within the window.
    const settledWithin = (promise, ms) =>
        Promise.race([
            promise.then(() => 'settled').catch(() => 'settled'),
            new Promise((r) => setTimeout(() => r('pending'), ms)),
        ]);

    it('makes a blocking write wait for the graph lock', async () => {
        const source = await createTask('Lock source');
        const target = await createTask('Lock target');

        // Hold the lock the production code takes, using that same function
        // rather than a copy of its key.
        holder = await sequelize.transaction();
        await relationService.lockBlockingGraph(holder);

        const pending = relationService.createRelation(
            user.id,
            source.uid,
            target.uid,
            'blocks'
        );

        expect(await settledWithin(pending, 700)).toBe('pending');

        await holder.commit();
        holder = null;
        await expect(pending).resolves.toMatchObject({ type: 'blocks' });
    });

    it('does not make a non-blocking write wait', async () => {
        const first = await createTask('Free one');
        const second = await createTask('Free two');

        holder = await sequelize.transaction();
        await relationService.lockBlockingGraph(holder);

        const pending = relationService.createRelation(
            user.id,
            first.uid,
            second.uid,
            'related_to'
        );

        expect(await settledWithin(pending, 700)).toBe('settled');
        await holder.commit();
        holder = null;
        await expect(pending).resolves.toMatchObject({ type: 'related_to' });
    });
});
