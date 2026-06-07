-- Run this in Supabase Dashboard SQL editor (https://supabase.com/dashboard/project/todakddcgsktsvkmvhzk/sql/new)
-- This makes the app work across all your devices with the same data

-- Weights
ALTER TABLE weights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_weights" ON weights;
DROP POLICY IF EXISTS "authenticated_insert_weights" ON weights;
DROP POLICY IF EXISTS "authenticated_update_weights" ON weights;
DROP POLICY IF EXISTS "authenticated_delete_weights" ON weights;
CREATE POLICY "authenticated_read_weights" ON weights FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_weights" ON weights FOR INSERT WITH CHECK (true);
CREATE POLICY "authenticated_update_weights" ON weights FOR UPDATE USING (true);
CREATE POLICY "authenticated_delete_weights" ON weights FOR DELETE USING (true);
ALTER TABLE weights REPLICA IDENTITY FULL;

-- Steps
ALTER TABLE steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_steps" ON steps;
DROP POLICY IF EXISTS "authenticated_insert_steps" ON steps;
DROP POLICY IF EXISTS "authenticated_update_steps" ON steps;
CREATE POLICY "authenticated_read_steps" ON steps FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_steps" ON steps FOR INSERT WITH CHECK (true);
CREATE POLICY "authenticated_update_steps" ON steps FOR UPDATE USING (true);
ALTER TABLE steps REPLICA IDENTITY FULL;

-- Daily logs
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_logs" ON daily_logs;
DROP POLICY IF EXISTS "authenticated_insert_logs" ON daily_logs;
DROP POLICY IF EXISTS "authenticated_update_logs" ON daily_logs;
CREATE POLICY "authenticated_read_logs" ON daily_logs FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_logs" ON daily_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "authenticated_update_logs" ON daily_logs FOR UPDATE USING (true);
ALTER TABLE daily_logs REPLICA IDENTITY FULL;

-- Alarms
ALTER TABLE alarms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_alarms" ON alarms;
DROP POLICY IF EXISTS "authenticated_insert_alarms" ON alarms;
DROP POLICY IF EXISTS "authenticated_update_alarms" ON alarms;
DROP POLICY IF EXISTS "authenticated_delete_alarms" ON alarms;
CREATE POLICY "authenticated_read_alarms" ON alarms FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_alarms" ON alarms FOR INSERT WITH CHECK (true);
CREATE POLICY "authenticated_update_alarms" ON alarms FOR UPDATE USING (true);
CREATE POLICY "authenticated_delete_alarms" ON alarms FOR DELETE USING (true);
ALTER TABLE alarms REPLICA IDENTITY FULL;

-- Sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_sessions" ON sessions;
CREATE POLICY "authenticated_read_sessions" ON sessions FOR SELECT USING (true);
ALTER TABLE sessions REPLICA IDENTITY FULL;

-- Tracks
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_tracks" ON tracks;
DROP POLICY IF EXISTS "authenticated_insert_tracks" ON tracks;
CREATE POLICY "authenticated_read_tracks" ON tracks FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_tracks" ON tracks FOR INSERT WITH CHECK (true);
ALTER TABLE tracks REPLICA IDENTITY FULL;

-- Checks
ALTER TABLE checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_read_checks" ON checks;
DROP POLICY IF EXISTS "authenticated_insert_checks" ON checks;
CREATE POLICY "authenticated_read_checks" ON checks FOR SELECT USING (true);
CREATE POLICY "authenticated_insert_checks" ON checks FOR INSERT WITH CHECK (true);
ALTER TABLE checks REPLICA IDENTITY FULL;

-- Allow anonymous role too (the publishable key uses anon role)
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
