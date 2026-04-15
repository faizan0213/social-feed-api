const { redisClient } = require('../config/redis');

const DEFAULT_TTL = 60; // seconds

/**
 * Generic Redis cache middleware.
 * Key is built from req.originalUrl so each unique URL gets its own cache entry.
 */
const cacheMiddleware = (ttl = DEFAULT_TTL) => async (req, res, next) => {
  const cacheKey = `feed:${req.originalUrl}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json({
        ...JSON.parse(cached),
        meta: { ...JSON.parse(cached).meta, cache: 'HIT' },
      });
    }
  } catch (err) {
    // Redis down → degrade gracefully, still serve from DB
    console.warn('Redis get failed, skipping cache:', err.message);
  }

  // Monkey-patch res.json to intercept the response and store in Redis
  const originalJson = res.json.bind(res);
  res.json = async (body) => {
    try {
      await redisClient.setEx(cacheKey, ttl, JSON.stringify(body));
    } catch (err) {
      console.warn('Redis set failed:', err.message);
    }
    return originalJson(body);
  };

  next();
};

/**
 * Invalidate all cache keys matching a pattern.
 * Call this when a new post is created.
 */
const invalidatePattern = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) await redisClient.del(keys);
  } catch (err) {
    console.warn('Cache invalidation failed:', err.message);
  }
};

module.exports = { cacheMiddleware, invalidatePattern };
