-- gamify.today Database Schema
-- PostgreSQL 14+

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  avatar VARCHAR(255) DEFAULT 'default',

  -- Gamification
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  xp_to_next INTEGER DEFAULT 100,
  total_tasks_completed INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  achievements TEXT[] DEFAULT '{}',

  -- OAuth
  google_id VARCHAR(255) UNIQUE,
  auth_provider VARCHAR(20) DEFAULT 'email',

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  last_task_date DATE
);

-- Categories (user-configurable)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(7) DEFAULT '#ff6b35',
  icon VARCHAR(50),
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'Not started' CHECK (status IN ('Parking Lot', 'Not started', 'In progress', 'Done')),
  priority VARCHAR(10) CHECK (priority IN ('High', 'Medium', 'Low')),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  start_date DATE,
  due_date DATE,

  -- Progress tracking
  start_value REAL DEFAULT 0,
  end_value REAL DEFAULT 100,

  -- Gamification
  tier VARCHAR(10) DEFAULT 'tier2' CHECK (tier IN ('tier1', 'tier2', 'tier3')),
  xp_earned INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,

  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'Not started' CHECK (status IN ('Parking Lot', 'Not started', 'In progress', 'Done')),
  priority VARCHAR(10) CHECK (priority IN ('High', 'Medium', 'Low')),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,

  effort_level VARCHAR(10) DEFAULT 'Medium' CHECK (effort_level IN ('Small', 'Medium', 'Large')),
  estimated_duration REAL,
  due_date TIMESTAMP,

  -- Gamification
  tier VARCHAR(10) DEFAULT 'tier3' CHECK (tier IN ('tier1', 'tier2', 'tier3')),
  difficulty VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard', 'epic')),
  xp_earned INTEGER DEFAULT 0,
  was_on_time BOOLEAN,

  -- Completion
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP,

  tags TEXT[] DEFAULT '{}',
  order_index INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Daily Stats (for streak tracking)
CREATE TABLE IF NOT EXISTS daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  tasks_completed INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  on_time_completions INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- Personal Records
CREATE TABLE IF NOT EXISTS personal_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  record_type VARCHAR(50) NOT NULL,
  value INTEGER NOT NULL,
  achieved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, record_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(is_completed);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_user_date ON daily_stats(user_id, date);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
