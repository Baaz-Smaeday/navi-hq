-- Navi HQ — Supabase Schema
-- Run this in your Supabase SQL Editor

-- 1. Commands table (core relay)
CREATE TABLE IF NOT EXISTS commands (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  command text NOT NULL,
  project text DEFAULT 'general',
  tool text DEFAULT 'claude-code',
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error', 'cancelled')),
  result text,
  laptop_id text,
  session_id uuid,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Fast lookup for listener polling
CREATE INDEX IF NOT EXISTS idx_commands_pending
  ON commands(status, created_at) WHERE status = 'pending';

-- Fast lookup for history
CREATE INDEX IF NOT EXISTS idx_commands_user_created
  ON commands(user_id, created_at DESC);

-- 2. Laptops table (heartbeat + multi-laptop)
CREATE TABLE IF NOT EXISTS laptops (
  id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  name text,
  hostname text,
  last_heartbeat timestamptz DEFAULT now(),
  status text DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  created_at timestamptz DEFAULT now()
);

-- 3. Sessions table (conversation continuity)
CREATE TABLE IF NOT EXISTS sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  laptop_id text REFERENCES laptops(id),
  project text NOT NULL,
  tool text DEFAULT 'claude-code',
  status text DEFAULT 'active' CHECK (status IN ('active', 'idle', 'closed')),
  created_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now()
);

-- 4. Row Level Security
ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE laptops ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "Users access own commands"
  ON commands FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users access own laptops"
  ON laptops FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users access own sessions"
  ON sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Enable Realtime for instant command delivery
ALTER PUBLICATION supabase_realtime ADD TABLE commands;
ALTER PUBLICATION supabase_realtime ADD TABLE laptops;

-- 6. Auto-update laptop status to offline after 2 minutes of no heartbeat
-- (Run as a Supabase cron job or Edge Function)
-- UPDATE laptops SET status = 'offline' WHERE last_heartbeat < now() - interval '2 minutes';
