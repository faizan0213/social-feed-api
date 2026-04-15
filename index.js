require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { connectRedis } = require('./src/config/redis');
const feedRoutes = require('./src/routes/feed');
const postRoutes = require('./src/routes/posts');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Global Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());           // gzip responses
app.use(express.json());
app.use(morgan('dev'));

// ─── Response time header (useful for benchmarking) ────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const onFinish = () => {
    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
    }
  };
  res.on('finish', onFinish);
  next();
});

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/feed', feedRoutes);
app.use('/api/posts', postRoutes);

app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong' });
});

// ─── Boot ───────────────────────────────────────────────────────────────────
const start = async () => {
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
