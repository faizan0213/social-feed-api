const { redisClient } = require('../config/redis');
const logger = require('../config/logger');

const DEFAULT_TTL = 60;
const LOCK_TTL = 5;      // seconds — max time to hold the stampede lock
const LOCK_RETRY_MS = 50; // how long to wait before retrying lock check

// ─── Stampede Protection ────────────────────────────────────────────────────
// When cache misses happen simultaneously for the same key, only ONE request
// hits the DB. Others wait (poll) for the lock to be released.
const acquireLock = async (lockKey) => {
  // SET NX EX — atomic: only succeeds if key doesn't exist
  const result = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_TTL });
  return result === 'OK';
};

const releaseLock = async (lockKey) => {
  await redisClient.del(lockKey);
};

const waitForLock = async (lockKey, cacheKey, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
    const lockExists = await redisClient.exists(lockKey);
    if (!lockExists) return null; // lock released but no cache → give up, hit DB
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
  return null;
};

// ─── Cache Middleware ────────────────────────────────────────────────────────
const cacheMiddleware = (ttl = DEFAULT_TTL) => async (req, res, next) => {
  const cacheKey = `feed:${req.originalUrl}`;
  const lockKey = `lock:${cacheKey}`;

  try {
    // 1. Try cache hit first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      return res.json({ ...parsed, meta: { ...parsed.meta, cache: 'HIT' } });
    }

    // 2. Cache miss — try to acquire stampede lock
    const gotLock = await acquireLock(lockKey);
    if (!gotLock) {
      // Another request is fetching from DB — wait for it
      const result = await waitForLock(lockKey, cacheKey);
      if (result) {
        return res.json({ ...result, meta: { ...result.meta, cache: 'HIT' } });
      }
      // Couldn't get result in time — fall through to DB (safe)
    }

    // 3. We hold the lock — fetch from DB, then populate cache
    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      try {
        await redisClient.setEx(cacheKey, ttl, JSON.stringify(body));
      } catch (err) {
        logger.warn('Redis set failed', { error: err.message });
      } finally {
        await releaseLock(lockKey);
      }
      return originalJson(body);
    };
  } catch (err) {
    // Redis fully down → graceful degradation, serve from DB
    logger.warn('Cache middleware error, degrading to DB', { error: err.message });
  }

  next();
};

// ─── Pattern Invalidation ────────────────────────────────────────────────────
const invalidatePattern = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      logger.info('Cache invalidated', { pattern, count: keys.length });
    }
  } catch (err) {
    logger.warn('Cache invalidation failed', { pattern, error: err.message });
  }
};

module.exports = { cacheMiddleware, invalidatePattern };