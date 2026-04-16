const pool = require('../config/db');
const { invalidatePattern } = require('../middleware/cache');
const logger = require('../config/logger');

// ─── Engagement Score ────────────────────────────────────────────────────────
// Weighted ranking: recency + likes + comments
// Decays older posts using log scale so fresh posts aren't buried forever
// Formula: (likes * 2 + comments * 3) / log2(hoursAgo + 2)
const ENGAGEMENT_QUERY = `
  SELECT
    p.id,
    p.content,
    p.media_url,
    p.like_count,
    p.comment_count,
    p.created_at,
    u.id            AS author_id,
    u.username      AS author_username,
    u.display_name  AS author_display_name,
    u.avatar_url    AS author_avatar,
    -- Engagement score (higher = better)
    ROUND(
      (p.like_count * 2.0 + p.comment_count * 3.0)
      / LOG(2, GREATEST(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600, 1) + 2)
    , 4) AS engagement_score
  FROM posts p
  JOIN users u ON u.id = p.user_id
  WHERE p.user_id IN (
    SELECT following_id FROM follows WHERE follower_id = $1
  )
`;

// ─── GET /api/feed/:userId ───────────────────────────────────────────────────
const getFeed = async (req, res) => {
  const { userId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const sort = req.query.sort === 'top' ? 'top' : 'recent'; // ?sort=top for ranked

  let cursorDate = null;
  if (req.query.cursor) {
    try {
      cursorDate = new Date(Buffer.from(req.query.cursor, 'base64').toString('utf8'));
      if (isNaN(cursorDate)) throw new Error('bad cursor');
    } catch {
      return res.status(400).json({ error: 'Invalid pagination cursor' });
    }
  }

  const start = Date.now();

  try {
    let query, params;

    if (sort === 'top') {
      // Engagement-ranked feed (no cursor — score changes dynamically)
      query = `${ENGAGEMENT_QUERY} ORDER BY engagement_score DESC, p.created_at DESC LIMIT $2`;
      params = [userId, limit + 1];
    } else {
      // Chronological feed with cursor pagination
      query = cursorDate
        ? `${ENGAGEMENT_QUERY} AND p.created_at < $2 ORDER BY p.created_at DESC LIMIT $3`
        : `${ENGAGEMENT_QUERY} ORDER BY p.created_at DESC LIMIT $2`;
      params = cursorDate ? [userId, cursorDate, limit + 1] : [userId, limit + 1];
    }

    const { rows } = await pool.query(query, params);

    const hasNextPage = rows.length > limit;
    const posts = hasNextPage ? rows.slice(0, limit) : rows;

    const nextCursor =
      hasNextPage && sort !== 'top'
        ? Buffer.from(posts[posts.length - 1].created_at.toISOString()).toString('base64')
        : null;

    const dbTime = Date.now() - start;

    logger.info('Feed served', {
      requestId: req.id,
      userId,
      sort,
      count: posts.length,
      dbTimeMs: dbTime,
      cache: 'MISS',
    });

    return res.json({
      data: posts.map((p) => ({
        id: p.id,
        content: p.content,
        mediaUrl: p.media_url,
        likeCount: p.like_count,
        commentCount: p.comment_count,
        createdAt: p.created_at,
        engagementScore: parseFloat(p.engagement_score) || 0,
        author: {
          id: p.author_id,
          username: p.author_username,
          displayName: p.author_display_name,
          avatarUrl: p.author_avatar,
        },
      })),
      pagination: { limit, hasNextPage, nextCursor },
      meta: {
        cache: 'MISS',
        sort,
        dbTimeMs: dbTime,
        totalTimeMs: Date.now() - start,
      },
    });
  } catch (err) {
    logger.error('getFeed error', { requestId: req.id, userId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── POST /api/posts ─────────────────────────────────────────────────────────
const createPost = async (req, res) => {
  const { userId, content, mediaUrl } = req.body;

  if (!userId || !content?.trim()) {
    return res.status(400).json({ error: 'userId and content are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO posts (user_id, content, media_url) VALUES ($1, $2, $3) RETURNING *`,
      [userId, content.trim(), mediaUrl || null]
    );

    // Invalidate feed caches for all followers
    const { rows: followers } = await pool.query(
      'SELECT follower_id FROM follows WHERE following_id = $1',
      [userId]
    );

    await Promise.all(
      followers.map((f) => invalidatePattern(`feed:/api/feed/${f.follower_id}*`))
    );

    logger.info('Post created, caches invalidated', {
      requestId: req.id,
      userId,
      followersInvalidated: followers.length,
    });

    return res.status(201).json({ data: rows[0] });
  } catch (err) {
    logger.error('createPost error', { requestId: req.id, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── GET /api/feed/:userId/explain ──────────────────────────────────────────
const getFeedQueryPlan = async (req, res) => {
  const { userId } = req.params;
  try {
    const { rows } = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT p.id, p.content, p.created_at, u.username,
         ROUND((p.like_count * 2.0 + p.comment_count * 3.0)
           / LOG(2, GREATEST(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600, 1) + 2), 4) AS score
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
       ORDER BY score DESC LIMIT 20`,
      [userId]
    );
    return res.json({ queryPlan: rows[0]['QUERY PLAN'] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { getFeed, createPost, getFeedQueryPlan };