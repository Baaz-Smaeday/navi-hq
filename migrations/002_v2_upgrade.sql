-- Navi HQ v2 — Upgrade existing schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- 1. Add 'tool' and 'laptop_id' columns to existing commands table
ALTER TABLE commands ADD COLUMN IF NOT EXISTS tool text DEFAULT 'claude-code';
ALTER TABLE commands ADD COLUMN IF NOT EXISTS laptop_id text;

-- 2. Create laptops table for heartbeat system
CREATE TABLE IF NOT EXISTS laptops (
  id text PRIMARY KEY,
  hostname text,
  last_heartbeat timestamptz DEFAULT now(),
  status text DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  created_at timestamptz DEFAULT now()
);

-- 3. Allow anon access to laptops (same as commands)
ALTER TABLE laptops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon access to laptops" ON laptops FOR ALL USING (true) WITH CHECK (true);

-- 4. Index for faster pending command lookup
CREATE INDEX IF NOT EXISTS idx_commands_pending
  ON commands(status, created_at) WHERE status = 'pending';

-- 5. Enable Realtime on both tables
ALTER PUBLICATION supabase_realtime ADD TABLE commands;
ALTER PUBLICATION supabase_realtime ADD TABLE laptops;

-- Done! Your v2 listener can now use heartbeats and multi-tool routing.
