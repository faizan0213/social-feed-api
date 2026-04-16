require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { connectRedis, redisClient } = require('./src/config/redis');
const pool = require('./src/config/db');
const logger = require('./src/config/logger');
const requestId = require('./src/middleware/requestId');
const feedRoutes = require('./src/routes/feed');
const postRoutes = require('./src/routes/posts');
const rateLimiter = require('./src/middleware/ratelimiter');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Global Middleware ────────────────────────────────────────────────── 
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(requestId); // attach req.id to every request

// Structured access logging
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  })
);

// Response time header
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    res.setHeader('X-Response-Time', `${ms}ms`);
    if (ms > 200) {
      logger.warn('Slow response detected', { path: req.path, ms, requestId: req.id });
    }
  });
  next();
});

// Rate limiter — 120 req/min per IP
app.use(rateLimiter({ windowMs: 60_000, max: 120 }));

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/feed', feedRoutes);
app.use('/api/posts', postRoutes);

// Health check — real DB + Redis ping
app.get('/health', async (req, res) => {
  const checks = { status: 'ok', timestamp: new Date().toISOString() };

  try {
    await pool.query('SELECT 1');
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
    checks.status = 'degraded';
  }

  try {
    await redisClient.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    checks.status = 'degraded';
  }

  res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { requestId: req.id, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Something went wrong' });
});

// ─── Boot ────────────────────────────────────────────────────────────────────
const start = async () => {
  await connectRedis();
  app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});