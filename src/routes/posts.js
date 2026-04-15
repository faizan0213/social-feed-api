const express = require('express');
const router = express.Router();
const { createPost } = require('../controllers/feedController');

// POST /api/posts
router.post('/', createPost);

module.exports = router;
