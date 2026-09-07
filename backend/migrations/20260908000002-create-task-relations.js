'use strict';

const { safeCreateTable, safeAddIndex } = require('../utils/migration-utils');

module.exports = {
    async up(queryInterface, Sequelize) {
        await safeCreateTable(queryInterface, 'task_relations', {
            id: {
                type: Sequelize.INTEGER,
                primaryKey: true,
                autoIncrement: true,
                allowNull: false,
            },
            uid: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true,
            },
            source_task_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'tasks', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            target_task_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'tasks', key: 'id' },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE',
            },
            relation_type: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            created_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
            updated_at: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
            },
        });

        // safeAddIndex treats an index as already present when any requested
        // field appears in any existing index, so it would skip the second of
        // these two: target_task_id is also the middle column of the composite.
        // Both are needed. Relations are read by pair when one is created and
        // by target alone on every task list, to mark blocked tasks.
        const existing = await queryInterface.showIndex('task_relations');
        const missing = (name) =>
            !existing.some((index) => index.name === name);

        if (missing('task_relations_source_target_type_unique')) {
            await queryInterface.addIndex(
                'task_relations',
                ['source_task_id', 'target_task_id', 'relation_type'],
                {
                    name: 'task_relations_source_target_type_unique',
                    unique: true,
                }
            );
        }
        if (missing('task_relations_target_task_id_idx')) {
            await queryInterface.addIndex(
                'task_relations',
                ['target_task_id'],
                {
                    name: 'task_relations_target_task_id_idx',
                }
            );
        }
    },

    async down(queryInterface) {
        await queryInterface.dropTable('task_relations');
    },
};
