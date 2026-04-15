-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Posts table
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_url TEXT,
  like_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follows table (for personalized feed)
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

-- ─── Indexes for fast feed queries ────────────────────────────────────────────

-- Cursor-based pagination: fetch posts ordered by created_at DESC
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);

-- Feed query: get posts by a specific user, sorted
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts (user_id, created_at DESC);

-- Follows lookup: who does a user follow?
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);

-- ─── Seed data ─────────────────────────────────────────────────────────────────

INSERT INTO users (id, username, display_name, avatar_url) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'alice', 'Alice Kumar', 'https://i.pravatar.cc/150?u=alice'),
  ('a0000000-0000-0000-0000-000000000002', 'bob', 'Bob Sharma', 'https://i.pravatar.cc/150?u=bob'),
  ('a0000000-0000-0000-0000-000000000003', 'carol', 'Carol Singh', 'https://i.pravatar.cc/150?u=carol')
ON CONFLICT DO NOTHING;

-- alice follows bob and carol
INSERT INTO follows (follower_id, following_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003')
ON CONFLICT DO NOTHING;

-- Seed 50 posts across users
INSERT INTO posts (user_id, content, created_at)
SELECT
  u.id,
  'Post number ' || gs || ' from ' || u.username || ' — ' || md5(random()::text),
  NOW() - (gs * interval '1 hour')
FROM generate_series(1, 50) AS gs
CROSS JOIN users u
ON CONFLICT DO NOTHING;
