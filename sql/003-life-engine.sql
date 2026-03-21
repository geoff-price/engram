-- Life Engine tables: habits, checkins, briefings, evolution
-- Reuses update_updated_at() trigger from 001-create-thoughts.sql

CREATE TABLE IF NOT EXISTS habits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'weekdays', 'specific_days')),
  time_of_day TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

DROP TRIGGER IF EXISTS habits_updated_at ON habits;
CREATE TRIGGER habits_updated_at
  BEFORE UPDATE ON habits FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS habit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  habit_id UUID NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  notes TEXT,
  completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS habit_log_completed_at_idx ON habit_log (completed_at DESC);
CREATE INDEX IF NOT EXISTS habit_log_habit_id_idx ON habit_log (habit_id);

CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
  energy INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkins_created_at_idx ON checkins (created_at DESC);

CREATE TABLE IF NOT EXISTS briefings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('morning', 'pre_meeting', 'midday', 'evening')),
  content TEXT NOT NULL,
  sent_via TEXT DEFAULT 'telegram',
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS briefings_type_sent_at_idx ON briefings (type, sent_at DESC);

CREATE TABLE IF NOT EXISTS evolution (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  change_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'rejected', 'applied')),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evolution_status_idx ON evolution (status);

DROP TRIGGER IF EXISTS evolution_updated_at ON evolution;
CREATE TRIGGER evolution_updated_at
  BEFORE UPDATE ON evolution FOR EACH ROW EXECUTE FUNCTION update_updated_at();
