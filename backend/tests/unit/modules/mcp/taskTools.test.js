const { Task } = require('../../../../models');
const { createTestUser } = require('../../../helpers/testUtils');
const {
    registerTaskTools,
} = require('../../../../modules/mcp/tools/taskTools');

describe('MCP task tools', () => {
    let user;
    let tools;

    beforeEach(async () => {
        user = await createTestUser({
            email: `mcp_task_tools_${Date.now()}@example.com`,
            timezone: 'UTC',
        });
        tools = [];
        registerTaskTools(
            null,
            { userId: user.id, user: { timezone: 'UTC' } },
            tools
        );
    });

    function getTool(name) {
        return tools.find((tool) => tool.name === name);
    }

    function parseResult(result) {
        return JSON.parse(result.content[0].text);
    }

    it('filters blocked tasks from actionable results through list_tasks', async () => {
        const blocker = await Task.create({
            user_id: user.id,
            name: 'Blocker',
        });
        const blocked = await Task.create({
            user_id: user.id,
            name: 'Blocked',
        });
        await Task.create({ user_id: user.id, name: 'Available' });
        await getTool('create_task_relation').handler({
            task_id: blocker.uid,
            related_task_id: blocked.uid,
            type: 'blocks',
        });

        const result = parseResult(
            await getTool('list_tasks').handler({ actionable: true })
        );

        expect(result.tasks.some((task) => task.name === 'Blocked')).toBe(
            false
        );
        expect(result.tasks.some((task) => task.name === 'Available')).toBe(
            true
        );
    });

    it('uses the relation service cycle check', async () => {
        const first = await Task.create({ user_id: user.id, name: 'First' });
        const second = await Task.create({ user_id: user.id, name: 'Second' });
        await getTool('create_task_relation').handler({
            task_id: first.uid,
            related_task_id: second.uid,
            type: 'blocks',
        });

        await expect(
            getTool('create_task_relation').handler({
                task_id: second.uid,
                related_task_id: first.uid,
                type: 'blocks',
            })
        ).rejects.toThrow('This blocking relation would create a cycle.');
    });
});
