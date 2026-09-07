const { Op } = require('sequelize');
const { Project, Task, TaskRelation } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const relationService = require('../../modules/tasks/relations/service');
const templatesService = require('../../modules/templates/service');
const projectsRepository = require('../../modules/projects/repository');

describe('Task relations across copies and project deletion', () => {
    let user;
    let project;

    beforeEach(async () => {
        user = await createTestUser({
            email: `task_relations_copy_${Date.now()}@example.com`,
        });
        project = await Project.create({ name: 'Launch', user_id: user.id });
    });

    async function createTask(name, projectId = project.id) {
        return await Task.create({
            user_id: user.id,
            project_id: projectId,
            name,
        });
    }

    async function relationsInProject(projectUid) {
        const target = await Project.findOne({ where: { uid: projectUid } });
        const tasks = await Task.findAll({
            where: { project_id: target.id },
        });
        const taskIds = tasks.map((task) => task.id);
        const relations = await TaskRelation.findAll({
            where: {
                source_task_id: { [Op.in]: taskIds },
                target_task_id: { [Op.in]: taskIds },
            },
        });
        const nameById = new Map(tasks.map((task) => [task.id, task.name]));
        return relations.map((relation) => ({
            id: relation.id,
            type: relation.relation_type,
            source: nameById.get(relation.source_task_id),
            target: nameById.get(relation.target_task_id),
        }));
    }

    it('carries relations into a template and into a project cloned from it', async () => {
        const blocker = await createTask('Draft the copy');
        const blocked = await createTask('Publish');
        await relationService.createRelation(
            user.id,
            blocked.uid,
            blocker.uid,
            'blocked_by'
        );

        const template = await templatesService.saveProjectAsTemplate(
            project.uid,
            user.id,
            { name: 'Launch template' }
        );

        expect(await relationsInProject(template.uid)).toEqual([
            {
                id: expect.any(Number),
                type: 'blocks',
                source: 'Draft the copy',
                target: 'Publish',
            },
        ]);

        const clone = await templatesService.cloneTemplate(
            template.uid,
            user.id,
            { name: 'Launch again' }
        );

        expect(await relationsInProject(clone.uid)).toEqual([
            {
                id: expect.any(Number),
                type: 'blocks',
                source: 'Draft the copy',
                target: 'Publish',
            },
        ]);

        // Each copy got its own row, and the original kept its relation.
        expect(await relationsInProject(project.uid)).toHaveLength(1);
        expect(await TaskRelation.count()).toBe(3);
    });

    it('copies a relation between a task and its subtask', async () => {
        const parent = await createTask('Ship release');
        const subtask = await Task.create({
            user_id: user.id,
            project_id: project.id,
            parent_task_id: parent.id,
            name: 'Tag the build',
        });
        await relationService.createRelation(
            user.id,
            parent.uid,
            subtask.uid,
            'related_to'
        );

        const template = await templatesService.saveProjectAsTemplate(
            project.uid,
            user.id,
            { name: 'Release template' }
        );

        const copied = await relationsInProject(template.uid);
        expect(copied).toHaveLength(1);
        expect(copied[0].type).toBe('related_to');
        expect([copied[0].source, copied[0].target].sort()).toEqual([
            'Ship release',
            'Tag the build',
        ]);
    });

    it('drops a relation that points outside the copied project', async () => {
        const inside = await createTask('Inside the project');
        const elsewhere = await Project.create({
            name: 'Other',
            user_id: user.id,
        });
        const outside = await createTask('Outside', elsewhere.id);
        await relationService.createRelation(
            user.id,
            inside.uid,
            outside.uid,
            'blocks'
        );

        const template = await templatesService.saveProjectAsTemplate(
            project.uid,
            user.id,
            { name: 'Partial template' }
        );

        expect(await relationsInProject(template.uid)).toEqual([]);
        // The relation itself is untouched.
        expect(await TaskRelation.count()).toBe(1);
    });

    it('does not copy stored relations for a source that is not from the database', async () => {
        const blocker = await createTask('Blocker');
        const blocked = await createTask('Blocked');
        await relationService.createRelation(
            user.id,
            blocker.uid,
            blocked.uid,
            'blocks'
        );

        // A marketplace template arrives as a payload whose task ids mean
        // nothing here. These reuse the ids of the pair related above.
        const target = await Project.create({
            name: 'Installed template',
            user_id: user.id,
        });
        await templatesService._copyTasksToProject(
            {
                Tasks: [
                    { id: blocker.id, name: 'Remote one' },
                    { id: blocked.id, name: 'Remote two' },
                ],
                Subtasks: [],
            },
            target,
            user.id,
            { resetStatus: true }
        );

        expect(await relationsInProject(target.uid)).toEqual([]);
        expect(await TaskRelation.count()).toBe(1);
    });

    it('removes relations when a project delete destroys its tasks', async () => {
        const blocker = await createTask('Blocker');
        const blocked = await createTask('Blocked');
        await relationService.createRelation(
            user.id,
            blocker.uid,
            blocked.uid,
            'blocks'
        );
        expect(await TaskRelation.count()).toBe(1);

        // Project deletion bulk destroys its tasks, which skips the per
        // instance hook, so this leans on the row level cascade instead.
        await projectsRepository.deleteWithOrphaning(project, user.id);

        expect(await Task.count({ where: { project_id: project.id } })).toBe(0);
        expect(
            await TaskRelation.count({
                where: {
                    [Op.or]: [
                        { source_task_id: blocker.id },
                        { target_task_id: blocked.id },
                    ],
                },
            })
        ).toBe(0);
    });
});
