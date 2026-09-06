'use strict';

const express = require('express');
const relationService = require('./service');
const { logError } = require('../../../services/logService');

const router = express.Router();

function sendError(res, error) {
    if (error instanceof relationService.TaskRelationError) {
        return res.status(error.status).json({ error: error.message });
    }
    logError('Task relation request failed:', error);
    return res.status(500).json({ error: 'Internal server error' });
}

router.get('/task/:uid/relations', async (req, res) => {
    try {
        const relations = await relationService.listRelations(
            req.currentUser.id,
            req.params.uid
        );
        res.json({ relations });
    } catch (error) {
        sendError(res, error);
    }
});

router.post('/task/:uid/relations', async (req, res) => {
    try {
        const relation = await relationService.createRelation(
            req.currentUser.id,
            req.params.uid,
            req.body.related_task_uid,
            req.body.type
        );
        res.status(201).json(relation);
    } catch (error) {
        sendError(res, error);
    }
});

router.delete('/task/:uid/relations/:relationUid', async (req, res) => {
    try {
        const relation = await relationService.removeRelation(
            req.currentUser.id,
            req.params.uid,
            req.params.relationUid
        );
        res.json({ relation });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
