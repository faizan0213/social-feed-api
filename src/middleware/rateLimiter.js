const { redisClient } = require('../config/redis');
const logger = require('../config/logger');

// Sliding window rate limiter using Redis
// windowMs: time window in ms, max: max requests per window
const rateLimiter = ({ windowMs = 60_000, max = 100 } = {}) => {
  return async (req, res, next) => {
    const key = `rl:${req.ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      const pipeline = redisClient.multi();
      pipeline.zRemRangeByScore(key, '-inf', windowStart);   // remove old entries
      pipeline.zAdd(key, [{ score: now, value: `${now}` }]); // add current request
      pipeline.zCard(key);                                   // count requests in window
      pipeline.expire(key, Math.ceil(windowMs / 1000));      // auto-expire key

      const results = await pipeline.exec();
      const requestCount = results[2]; // zCard result

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - requestCount));
      res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

      if (requestCount > max) {
        logger.warn('Rate limit exceeded', { ip: req.ip, requestId: req.id });
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil(windowMs / 1000),
        });
      }
    } catch (err) {
      // Redis down → fail open (don't block users)
      logger.warn('Rate limiter Redis error, failing open', { error: err.message });
    }

    next();
  };
};

module.exports = rateLimiter;