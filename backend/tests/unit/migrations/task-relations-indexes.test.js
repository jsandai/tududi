const { Sequelize } = require('sequelize');
const migration = require('../../../migrations/20260908000002-create-task-relations');

// The migration runs against a scratch database rather than the suite's, so it
// can assert what a fresh install ends up with. The shared safeAddIndex helper
// cannot be used for these two indexes: it treats an index as present when any
// requested field appears in any existing index, and target_task_id is also a
// column of the composite one.
describe('task relations migration', () => {
    let scratch;
    let queryInterface;

    beforeEach(async () => {
        scratch = new Sequelize({
            dialect: 'sqlite',
            storage: ':memory:',
            logging: false,
        });
        queryInterface = scratch.getQueryInterface();
        await scratch.query('CREATE TABLE tasks (id INTEGER PRIMARY KEY)');
        await scratch.query('INSERT INTO tasks (id) VALUES (1), (2)');
    });

    afterEach(async () => {
        await scratch.close();
    });

    async function indexNames() {
        const indexes = await queryInterface.showIndex('task_relations');
        return indexes.map((index) => index.name);
    }

    it('creates both the pair index and the target index', async () => {
        await migration.up(queryInterface, Sequelize);

        const names = await indexNames();
        expect(names).toContain('task_relations_source_target_type_unique');
        expect(names).toContain('task_relations_target_task_id_idx');
    });

    it('runs again without failing or duplicating an index', async () => {
        await migration.up(queryInterface, Sequelize);
        await migration.up(queryInterface, Sequelize);

        const names = await indexNames();
        expect(
            names.filter((n) => n === 'task_relations_target_task_id_idx')
        ).toHaveLength(1);
    });

    it('rejects a duplicate relation for the same pair and type', async () => {
        await migration.up(queryInterface, Sequelize);
        const insert = `INSERT INTO task_relations (uid, source_task_id, target_task_id, relation_type, created_at, updated_at)
             VALUES (:uid, 1, 2, 'blocks', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;

        await scratch.query(insert, { replacements: { uid: 'a' } });
        await expect(
            scratch.query(insert, { replacements: { uid: 'b' } })
        ).rejects.toThrow();
    });
});
