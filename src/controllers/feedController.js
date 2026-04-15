const pool = require('../config/db');
const { invalidatePattern } = require('../middleware/cache');

/**
 * GET /api/feed/:userId
 *
 * Returns paginated posts from users that :userId follows.
 * Uses cursor-based pagination (cursor = last post's created_at ISO string).
 *
 * Query params:
 *   limit  — number of posts per page (default 20, max 50)
 *   cursor — opaque pagination cursor (base64-encoded ISO timestamp)
 *
 * Why cursor over offset?
 *   OFFSET N forces the DB to scan and discard N rows every time.
 *   A cursor (WHERE created_at < $cursor) uses the index directly → O(log n).
 */
const getFeed = async (req, res) => {
  const { userId } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);

  // Decode cursor: base64(ISO timestamp) → Date
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
    // Single optimized query with JOIN — avoids N+1
    // Fetches one extra row to determine if there's a next page
    const query = cursorDate
      ? `
          SELECT
            p.id,
            p.content,
            p.media_url,
            p.like_count,
            p.comment_count,
            p.created_at,
            u.id        AS author_id,
            u.username  AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar
          FROM posts p
          JOIN users u ON u.id = p.user_id
          WHERE p.user_id IN (
            SELECT following_id FROM follows WHERE follower_id = $1
          )
          AND p.created_at < $2
          ORDER BY p.created_at DESC
          LIMIT $3
        `
      : `
          SELECT
            p.id,
            p.content,
            p.media_url,
            p.like_count,
            p.comment_count,
            p.created_at,
            u.id        AS author_id,
            u.username  AS author_username,
            u.display_name AS author_display_name,
            u.avatar_url AS author_avatar
          FROM posts p
          JOIN users u ON u.id = p.user_id
          WHERE p.user_id IN (
            SELECT following_id FROM follows WHERE follower_id = $1
          )
          ORDER BY p.created_at DESC
          LIMIT $2
        `;

    const params = cursorDate ? [userId, cursorDate, limit + 1] : [userId, limit + 1];
    const { rows } = await pool.query(query, params);

    const hasNextPage = rows.length > limit;
    const posts = hasNextPage ? rows.slice(0, limit) : rows;

    // Encode next cursor
    const nextCursor = hasNextPage
      ? Buffer.from(posts[posts.length - 1].created_at.toISOString()).toString('base64')
      : null;

    const dbTime = Date.now() - start;

    return res.json({
      data: posts.map((p) => ({
        id: p.id,
        content: p.content,
        mediaUrl: p.media_url,
        likeCount: p.like_count,
        commentCount: p.comment_count,
        createdAt: p.created_at,
        author: {
          id: p.author_id,
          username: p.author_username,
          displayName: p.author_display_name,
          avatarUrl: p.author_avatar,
        },
      })),
      pagination: {
        limit,
        hasNextPage,
        nextCursor,
      },
      meta: {
        cache: 'MISS',
        dbTimeMs: dbTime,
        totalTimeMs: Date.now() - start,
      },
    });
  } catch (err) {
    console.error('getFeed error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/posts
 * Create a new post and invalidate the author's followers' feed caches.
 */
const createPost = async (req, res) => {
  const { userId, content, mediaUrl } = req.body;

  if (!userId || !content?.trim()) {
    return res.status(400).json({ error: 'userId and content are required' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO posts (user_id, content, media_url)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, content.trim(), mediaUrl || null]
    );

    // Invalidate feed caches for all followers of this user
    // Pattern: feed:/api/feed/<followerId>*
    const { rows: followers } = await pool.query(
      'SELECT follower_id FROM follows WHERE following_id = $1',
      [userId]
    );

    await Promise.all(
      followers.map((f) => invalidatePattern(`feed:/api/feed/${f.follower_id}*`))
    );

    return res.status(201).json({ data: rows[0] });
  } catch (err) {
    console.error('createPost error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/feed/:userId/stats
 * Returns EXPLAIN ANALYZE output for the feed query — useful for demonstrating index usage.
 */
const getFeedQueryPlan = async (req, res) => {
  const { userId } = req.params;
  try {
    const { rows } = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT p.id, p.content, p.created_at, u.username
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [userId]
    );
    return res.json({ queryPlan: rows[0]['QUERY PLAN'] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = { getFeed, createPost, getFeedQueryPlan };
