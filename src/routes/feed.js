const express = require('express');
const router = express.Router();
const { getFeed, createPost, getFeedQueryPlan } = require('../controllers/feedController');
const { cacheMiddleware } = require('../middleware/cache');

// GET /api/feed/:userId          — paginated feed (cached 60s)
router.get('/:userId', cacheMiddleware(60), getFeed);

// GET /api/feed/:userId/explain  — show DB query plan (no cache, dev only)
router.get('/:userId/explain', getFeedQueryPlan);

module.exports = router;
