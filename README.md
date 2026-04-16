# Social Feed API

A **performance-focused backend API** for a social media feed — built with **Node.js + Express**, **PostgreSQL**, and **Redis**.

Designed to handle **high traffic scenarios**, reduce database load, and maintain **sub-200ms response times** using caching and query optimization.

---

## 🚀 Key Highlights

* ⚡ Sub-10ms responses on cache hits
* 🧠 Redis caching with **stampede protection**
* 📊 Optimized SQL queries with indexing + cursor pagination
* 🛡️ Built-in **rate limiting** for traffic control
* 🔁 Cache invalidation for data consistency
* 📈 Designed for **high concurrency & scalability**

---

## Features

| Requirement               | Implementation                               |
| ------------------------- | -------------------------------------------- |
| Pagination                | Cursor-based (no offset, O(log n))           |
| Optimized DB queries      | Indexed queries + JOIN (no N+1)              |
| Redis caching             | Route-level caching with TTL + invalidation  |
| High traffic handling     | Rate limiting + caching + connection pooling |
| Response time <200ms      | Cached responses typically **2–10ms**        |
| Cache stampede protection | Redis locks (SET NX EX) to avoid DB overload |

---

## Tech Stack

* **Runtime:** Node.js 18+
* **Framework:** Express
* **Database:** PostgreSQL (connection pooling)
* **Cache:** Redis
* **Other:** Helmet, Compression, Morgan, Winston logging

---

## 🧠 Performance Architecture

### Request Flow

```text
Client → Cache (Redis)
        ↓
      HIT → return (2–10ms)
        ↓
      MISS → DB query → cache store → return
```

---

### 🔥 Redis Caching Strategy

* **Cache key:** Based on route + query params (userId, cursor, limit)
* **TTL:** 60 seconds
* **Invalidation:** On post creation (followers' feeds cleared)
* **Graceful fallback:** If Redis fails → DB used directly

---

### ⚡ Cache Stampede Protection

To prevent multiple requests hitting the DB on cache miss:

```js
SET lockKey NX EX
```

* Only **one request fetches from DB**
* Others wait for cached result
* Prevents DB overload during traffic spikes

---

### 🛡️ High Traffic Handling

* **Redis-based sliding window rate limiting**
* Prevents abuse and traffic spikes
* Ensures fair usage per IP

```text
Max 120 requests / minute per IP
```
---
## 🚦 High Traffic Scenario (Example)

Under heavy load (e.g., 1000 concurrent requests):

- ~90% requests are served from Redis cache (fast response)
- Only a small portion hits the database due to caching + stampede protection
- Rate limiting prevents excessive abuse from a single client
- Connection pooling ensures efficient DB usage

Result:
- Stable performance
- No database overload
- Consistent low latency

### 📊 Database Optimization

* Cursor-based pagination (no OFFSET)
* Composite indexes:

  * `(created_at DESC)`
  * `(user_id, created_at DESC)`
* JOIN queries to avoid N+1 problem

---

### ⚡ Connection Pooling

```js
max: 20 connections
```

* Handles concurrent requests efficiently
* Reduces connection overhead

---

## 📈 Benchmark (Local)

| Scenario                        | Response Time            |
| ------------------------------- | ------------------------ |
| Cache MISS                      | ~15–40ms                 |
| Cache HIT                       | ~2–10ms                  |
| High load (50 concurrent users) | Stable with no DB spikes |

---

## API Endpoints

### GET `/api/feed/:userId`

* Paginated feed
* Cached (60s TTL)

### POST `/api/posts`

* Creates post
* Invalidates follower feed cache

### GET `/health`

* Checks DB + Redis status

### GET `/api/feed/:userId/explain`

* Returns query execution plan

---

## 📂 Project Structure

```
src/
├── config/
│   ├── db.js
│   ├── redis.js
├── middleware/
│   ├── cache.js        # Redis caching + stampede protection
│   ├── rateLimiter.js # High traffic control
├── controllers/
│   └── feedController.js
├── routes/
│   ├── feed.js
│   └── posts.js
```

---

## 💡 Design Decisions

* Used **cursor pagination** for scalability
* Added **Redis caching** to reduce DB load
* Implemented **rate limiting** to control traffic
* Designed for **graceful degradation** (Redis failure safe)
* Focused on **real-world backend performance patterns**

---

## 🚀 Summary

This system is designed to:

* Handle **high read traffic efficiently**
* Minimize database load using caching
* Maintain **low latency under load**
* Provide a scalable backend foundation

---
