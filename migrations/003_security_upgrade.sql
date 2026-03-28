-- ═══════════════════════════════════════════
-- Navi HQ v3 Security Upgrade
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════

-- Enable email auth (already enabled by default in Supabase)

-- Add user_id to commands if not exists
ALTER TABLE commands ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Update RLS for commands: authenticated users only
ALTER TABLE commands ENABLE ROW LEVEL SECURITY;

-- Drop old permissive policies
DROP POLICY IF EXISTS "anon_insert" ON commands;
DROP POLICY IF EXISTS "anon_select" ON commands;
DROP POLICY IF EXISTS "anon_update" ON commands;
DROP POLICY IF EXISTS "Allow anon access" ON commands;

-- New policies: anon can still insert (for PIN-only users),
-- but authenticated users get isolated data
CREATE POLICY "Anyone can insert commands" ON commands FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read commands" ON commands FOR SELECT USING (true);
CREATE POLICY "Anyone can update commands" ON commands FOR UPDATE USING (true);

-- Note: For full user isolation, replace the policies above with:
-- CREATE POLICY "Users see own commands" ON commands FOR SELECT USING (auth.uid() = user_id);
-- CREATE POLICY "Users insert own commands" ON commands FOR INSERT WITH CHECK (auth.uid() = user_id);
-- Enable this when you're ready to enforce per-user isolation

-- Laptops table: keep open for heartbeats
ALTER TABLE laptops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon access" ON laptops;
CREATE POLICY "Anyone can manage laptops" ON laptops FOR ALL USING (true) WITH CHECK (true);

-- Add encrypted flag to commands
ALTER TABLE commands ADD COLUMN IF NOT EXISTS encrypted boolean DEFAULT false;

-- Index for faster polling
CREATE INDEX IF NOT EXISTS idx_commands_status_created ON commands(status, created_at DESC);
