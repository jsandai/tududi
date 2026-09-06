'use strict';

const { Op, Transaction, literal } = require('sequelize');
const { Task, TaskRelation, sequelize } = require('../../../models');
const permissionsService = require('../../../services/permissionsService');

const INPUT_TYPES = [
    'blocks',
    'blocked_by',
    'related_to',
    'duplicates',
    'duplicated_by',
];
const INVERSE_TYPES = {
    blocks: 'blocked_by',
    blocked_by: 'blocks',
    related_to: 'related_to',
    duplicates: 'duplicated_by',
    duplicated_by: 'duplicates',
};
const TERMINAL_STATUSES = [
    Task.STATUS.DONE,
    Task.STATUS.ARCHIVED,
    Task.STATUS.CANCELLED,
];

class TaskRelationError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'TaskRelationError';
        this.status = status;
    }
}

function hasRequiredAccess(access, required) {
    const levels = {
        [permissionsService.ACCESS.NONE]: 0,
        [permissionsService.ACCESS.RO]: 1,
        [permissionsService.ACCESS.RW]: 2,
        [permissionsService.ACCESS.ADMIN]: 3,
    };
    return levels[access] >= levels[required];
}

async function findTask(identifier, transaction = null) {
    if (
        typeof identifier === 'number' ||
        (typeof identifier === 'string' && /^\d+$/.test(identifier.trim()))
    ) {
        return await Task.findByPk(Number(identifier), { transaction });
    }
    if (typeof identifier !== 'string' || identifier.trim() === '') return null;
    return await Task.findOne({
        where: { uid: identifier.trim() },
        transaction,
    });
}

async function requireTaskAccess(
    userId,
    identifier,
    required = permissionsService.ACCESS.RO,
    transaction = null
) {
    const task = await findTask(identifier, transaction);
    if (!task) throw new TaskRelationError('Task not found.', 404);

    const access = await permissionsService.getAccess(userId, 'task', task.uid);
    if (!hasRequiredAccess(access, required)) {
        throw new TaskRelationError('Task not found.', 404);
    }
    return task;
}

function canonicalize(currentTask, relatedTask, inputType) {
    if (!INPUT_TYPES.includes(inputType)) {
        throw new TaskRelationError('Invalid task relation type.');
    }
    if (currentTask.id === relatedTask.id) {
        throw new TaskRelationError('A task cannot be related to itself.');
    }

    if (inputType === 'blocked_by') {
        return {
            sourceTask: relatedTask,
            targetTask: currentTask,
            relationType: TaskRelation.TYPE.BLOCKS,
        };
    }
    if (inputType === 'duplicated_by') {
        return {
            sourceTask: relatedTask,
            targetTask: currentTask,
            relationType: TaskRelation.TYPE.DUPLICATES,
        };
    }
    if (inputType === 'related_to') {
        const [sourceTask, targetTask] = [currentTask, relatedTask].sort(
            (a, b) => a.id - b.id
        );
        return {
            sourceTask,
            targetTask,
            relationType: TaskRelation.TYPE.RELATED_TO,
        };
    }
    return {
        sourceTask: currentTask,
        targetTask: relatedTask,
        relationType: inputType,
    };
}

// Walks the blocking graph outwards from the target one level at a time, so
// the check reads only the edges it can reach rather than the whole table.
// Ownership is ignored on purpose: a cycle routed through a task this user
// cannot see is still a cycle, and allowing it would break the ordering for
// whoever can see both ends.
async function wouldCreateBlockCycle(sourceTaskId, targetTaskId, transaction) {
    const visited = new Set();
    let frontier = [targetTaskId];

    while (frontier.length > 0) {
        if (frontier.includes(sourceTaskId)) return true;
        frontier.forEach((taskId) => visited.add(taskId));

        const rows = await TaskRelation.findAll({
            where: {
                relation_type: TaskRelation.TYPE.BLOCKS,
                source_task_id: { [Op.in]: frontier },
            },
            attributes: ['target_task_id'],
            raw: true,
            transaction,
        });
        frontier = [
            ...new Set(
                rows
                    .map((row) => row.target_task_id)
                    .filter((taskId) => !visited.has(taskId))
            ),
        ];
    }
    return false;
}

function relationTypeForTask(relation, taskId) {
    return relation.source_task_id === taskId
        ? relation.relation_type
        : INVERSE_TYPES[relation.relation_type];
}

function relationTaskForTask(relation, taskId) {
    return relation.source_task_id === taskId
        ? relation.TargetTask
        : relation.SourceTask;
}

function serializeRelation(relation, taskId) {
    const relatedTask = relationTaskForTask(relation, taskId);
    return {
        uid: relation.uid,
        type: relationTypeForTask(relation, taskId),
        related_task: relatedTask
            ? {
                  id: relatedTask.id,
                  uid: relatedTask.uid,
                  name: relatedTask.name,
                  status: relatedTask.status,
              }
            : null,
        created_at: relation.created_at,
    };
}

const RELATION_INCLUDES = [
    {
        model: Task,
        as: 'SourceTask',
        attributes: ['id', 'uid', 'name', 'status'],
    },
    {
        model: Task,
        as: 'TargetTask',
        attributes: ['id', 'uid', 'name', 'status'],
    },
];

async function createRelation(
    userId,
    currentIdentifier,
    relatedIdentifier,
    type
) {
    return await sequelize.transaction(
        { type: Transaction.TYPES.IMMEDIATE },
        async (transaction) => {
            const currentTask = await requireTaskAccess(
                userId,
                currentIdentifier,
                permissionsService.ACCESS.RW,
                transaction
            );
            const relatedTask = await requireTaskAccess(
                userId,
                relatedIdentifier,
                permissionsService.ACCESS.RW,
                transaction
            );
            const { sourceTask, targetTask, relationType } = canonicalize(
                currentTask,
                relatedTask,
                type
            );

            await Task.findAll({
                where: { id: { [Op.in]: [sourceTask.id, targetTask.id] } },
                order: [['id', 'ASC']],
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            // "A duplicates B" and "B duplicates A" are the same pair, so
            // match either direction. related_to sorts its endpoints before
            // storing, and a reversed blocks edge is a cycle.
            const pairScope =
                relationType === TaskRelation.TYPE.DUPLICATES
                    ? {
                          [Op.or]: [
                              {
                                  source_task_id: sourceTask.id,
                                  target_task_id: targetTask.id,
                              },
                              {
                                  source_task_id: targetTask.id,
                                  target_task_id: sourceTask.id,
                              },
                          ],
                      }
                    : {
                          source_task_id: sourceTask.id,
                          target_task_id: targetTask.id,
                      };
            const existing = await TaskRelation.findOne({
                where: { relation_type: relationType, ...pairScope },
                transaction,
            });
            if (existing) {
                throw new TaskRelationError(
                    'This task relation already exists.',
                    409
                );
            }

            if (
                relationType === TaskRelation.TYPE.BLOCKS &&
                (await wouldCreateBlockCycle(
                    sourceTask.id,
                    targetTask.id,
                    transaction
                ))
            ) {
                throw new TaskRelationError(
                    'This blocking relation would create a cycle.'
                );
            }

            const relation = await TaskRelation.create(
                {
                    source_task_id: sourceTask.id,
                    target_task_id: targetTask.id,
                    relation_type: relationType,
                },
                { transaction }
            );
            const loaded = await TaskRelation.findByPk(relation.id, {
                include: RELATION_INCLUDES,
                transaction,
            });
            return serializeRelation(loaded, currentTask.id);
        }
    );
}

async function listRelations(userId, currentIdentifier) {
    const currentTask = await requireTaskAccess(userId, currentIdentifier);
    const relations = await TaskRelation.findAll({
        where: {
            [Op.or]: [
                { source_task_id: currentTask.id },
                { target_task_id: currentTask.id },
            ],
        },
        include: RELATION_INCLUDES,
        order: [['created_at', 'ASC']],
    });

    const visible = relations
        .map((relation) => ({
            relation,
            relatedTask: relationTaskForTask(relation, currentTask.id),
        }))
        .filter((candidate) => candidate.relatedTask);

    const relatedUids = [
        ...new Set(visible.map((candidate) => candidate.relatedTask.uid)),
    ];
    const accessByUid = new Map(
        await Promise.all(
            relatedUids.map(async (uid) => [
                uid,
                await permissionsService.getAccess(userId, 'task', uid),
            ])
        )
    );

    return visible
        .filter((candidate) =>
            hasRequiredAccess(
                accessByUid.get(candidate.relatedTask.uid),
                permissionsService.ACCESS.RO
            )
        )
        .map((candidate) =>
            serializeRelation(candidate.relation, currentTask.id)
        );
}

async function removeRelation(userId, currentIdentifier, relationUid) {
    return await sequelize.transaction(
        { type: Transaction.TYPES.IMMEDIATE },
        async (transaction) => {
            const currentTask = await requireTaskAccess(
                userId,
                currentIdentifier,
                permissionsService.ACCESS.RW,
                transaction
            );
            const relation = await TaskRelation.findOne({
                where: { uid: relationUid },
                include: RELATION_INCLUDES,
                transaction,
            });
            if (
                !relation ||
                (relation.source_task_id !== currentTask.id &&
                    relation.target_task_id !== currentTask.id)
            ) {
                throw new TaskRelationError('Task relation not found.', 404);
            }

            const relatedTask = relationTaskForTask(relation, currentTask.id);
            if (!relatedTask) {
                throw new TaskRelationError('Task relation not found.', 404);
            }
            await requireTaskAccess(
                userId,
                relatedTask.uid,
                permissionsService.ACCESS.RW,
                transaction
            );
            const serialized = serializeRelation(relation, currentTask.id);
            await relation.destroy({ transaction });
            return serialized;
        }
    );
}

// Copies the relations whose endpoints both sit inside a copied set of tasks,
// given a map of original task id to new task id. One endpoint outside the set
// is dropped: a copy has to stand on its own, and pointing a copied task at
// the original's blocker would tie the two together.
async function copyRelationsForTaskIds(taskIdMap, transaction = null) {
    const originalIds = Object.keys(taskIdMap)
        .map(Number)
        .filter((id) => Number.isInteger(id) && taskIdMap[id]);
    if (originalIds.length < 2) return [];

    const relations = await TaskRelation.findAll({
        where: {
            source_task_id: { [Op.in]: originalIds },
            target_task_id: { [Op.in]: originalIds },
        },
        transaction,
    });
    if (relations.length === 0) return [];

    return await TaskRelation.bulkCreate(
        relations.map((relation) => ({
            source_task_id: taskIdMap[relation.source_task_id],
            target_task_id: taskIdMap[relation.target_task_id],
            relation_type: relation.relation_type,
        })),
        { transaction, validate: true }
    );
}

async function getBlockedTaskIds(taskIds) {
    const uniqueIds = [...new Set(taskIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Set();

    const relations = await TaskRelation.findAll({
        where: {
            relation_type: TaskRelation.TYPE.BLOCKS,
            target_task_id: { [Op.in]: uniqueIds },
        },
        include: [
            {
                model: Task,
                as: 'SourceTask',
                attributes: [],
                required: true,
                where: { status: { [Op.notIn]: TERMINAL_STATUSES } },
            },
        ],
        attributes: ['target_task_id'],
        raw: true,
    });
    return new Set(relations.map((relation) => relation.target_task_id));
}

async function isTaskBlocked(taskId) {
    return (await getBlockedTaskIds([taskId])).has(taskId);
}

function getActionableRelationPredicate() {
    const statuses = TERMINAL_STATUSES.join(', ');
    return literal(`NOT EXISTS (
        SELECT 1
        FROM task_relations actionable_relation
        INNER JOIN tasks actionable_blocker
            ON actionable_blocker.id = actionable_relation.source_task_id
        WHERE actionable_relation.target_task_id = "Task"."id"
          AND actionable_relation.relation_type = 'blocks'
          AND actionable_blocker.status NOT IN (${statuses})
    )`);
}

module.exports = {
    INPUT_TYPES,
    TaskRelationError,
    createRelation,
    wouldCreateBlockCycle,
    listRelations,
    removeRelation,
    copyRelationsForTaskIds,
    getBlockedTaskIds,
    isTaskBlocked,
    getActionableRelationPredicate,
};
