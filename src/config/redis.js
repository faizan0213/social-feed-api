const { createClient } = require('redis');

const redisUrl = (process.env.REDIS_URL || 'redis://127.0.0.1:6379').replace('localhost', '127.0.0.1');

const redisClient = createClient({
  url: redisUrl,
});

redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.on('connect', () => console.log('✅ Redis connected'));

const connectRedis = async () => {
  await redisClient.connect();
};

module.exports = { redisClient, connectRedis };
