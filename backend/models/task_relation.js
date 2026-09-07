const { DataTypes } = require('sequelize');
const { uid } = require('../utils/uid');

module.exports = (sequelize) => {
    const TaskRelation = sequelize.define(
        'TaskRelation',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
                defaultValue: uid,
            },
            source_task_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'tasks',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            target_task_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'tasks',
                    key: 'id',
                },
                onDelete: 'CASCADE',
                validate: {
                    notSameTask(value) {
                        if (value === this.source_task_id) {
                            throw new Error(
                                'A task cannot be related to itself.'
                            );
                        }
                    },
                },
            },
            relation_type: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    isIn: [['blocks', 'related_to', 'duplicates']],
                },
            },
        },
        {
            tableName: 'task_relations',
            indexes: [
                {
                    name: 'task_relations_source_target_type_unique',
                    unique: true,
                    fields: [
                        'source_task_id',
                        'target_task_id',
                        'relation_type',
                    ],
                },
                {
                    name: 'task_relations_target_task_id_idx',
                    fields: ['target_task_id'],
                },
            ],
        }
    );

    TaskRelation.TYPE = {
        BLOCKS: 'blocks',
        RELATED_TO: 'related_to',
        DUPLICATES: 'duplicates',
    };

    return TaskRelation;
};
