-- Seed data for gamify.today
-- This file contains the default achievements definition
-- Achievements are stored in user records as an array of achievement IDs

-- Achievement definitions (stored as reference, actual data in code)
-- These are seeded into the database for reference but the logic is in the app

COMMENT ON TABLE users IS 'Achievement IDs stored in achievements array:
  first-task: Complete your first task (25 XP)
  task-10: Complete 10 tasks (50 XP)
  task-50: Complete 50 tasks (100 XP)
  task-100: Complete 100 tasks (200 XP)
  task-500: Complete 500 tasks (500 XP)
  streak-3: 3-day streak (50 XP)
  streak-7: 7-day streak (100 XP)
  streak-14: 14-day streak (200 XP)
  streak-30: 30-day streak (500 XP)
  streak-100: 100-day streak (2000 XP)
  on-time-10: 10 tasks completed on time (75 XP)
  on-time-50: 50 tasks completed on time (200 XP)
  early-bird: Complete 10 tasks before 9am (100 XP)
  night-owl: Complete 10 tasks after 10pm (100 XP)
  level-5: Reach level 5 (150 XP)
  level-10: Reach level 10 (300 XP)
  level-25: Reach level 25 (750 XP)
';

-- Create a test user for development (password: test123)
-- INSERT INTO users (email, username, password_hash, auth_provider)
-- VALUES ('test@example.com', 'testuser', '$2a$10$rQnM.kCvO1mXLw.XU.NqFeWqXz5xFqJ7X0z5k5z5z5z5z5z5z5z5z', 'email')
-- ON CONFLICT (email) DO NOTHING;
