const express = require('express');
const db = require('../db/config');
const { authenticate } = require('../middleware/auth');
const { getAchievements, xpToNextLevel } = require('../services/gamification');

const router = express.Router();

router.use(authenticate);

// Get user stats summary
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get task stats
    const taskStats = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_completed = true) as completed_tasks,
         COUNT(*) FILTER (WHERE is_completed = false) as pending_tasks,
         COUNT(*) FILTER (WHERE is_completed = true AND was_on_time = true) as on_time_tasks,
         COUNT(*) FILTER (WHERE is_completed = false AND due_date < NOW()) as overdue_tasks,
         SUM(CASE WHEN is_completed = true THEN xp_earned ELSE 0 END) as total_xp_from_tasks
       FROM tasks WHERE user_id = $1`,
      [userId]
    );

    // Get this week's stats
    const weekStats = await db.query(
      `SELECT
         COALESCE(SUM(tasks_completed), 0) as week_tasks,
         COALESCE(SUM(xp_earned), 0) as week_xp
       FROM daily_stats
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'`,
      [userId]
    );

    // Get today's stats
    const todayStats = await db.query(
      `SELECT tasks_completed, xp_earned, on_time_completions
       FROM daily_stats
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    );

    const stats = taskStats.rows[0];
    const week = weekStats.rows[0];
    const today = todayStats.rows[0] || { tasks_completed: 0, xp_earned: 0, on_time_completions: 0 };

    res.json({
      user: {
        level: req.user.level,
        xp: req.user.xp,
        xpToNext: req.user.xp_to_next,
        xpProgress: Math.round((req.user.xp / req.user.xp_to_next) * 100),
        totalTasksCompleted: req.user.total_tasks_completed,
        currentStreak: req.user.current_streak,
        longestStreak: req.user.longest_streak,
        achievementsCount: req.user.achievements?.length || 0
      },
      tasks: {
        completed: parseInt(stats.completed_tasks) || 0,
        pending: parseInt(stats.pending_tasks) || 0,
        onTime: parseInt(stats.on_time_tasks) || 0,
        overdue: parseInt(stats.overdue_tasks) || 0
      },
      today: {
        tasksCompleted: today.tasks_completed,
        xpEarned: today.xp_earned,
        onTimeCompletions: today.on_time_completions
      },
      thisWeek: {
        tasksCompleted: parseInt(week.week_tasks) || 0,
        xpEarned: parseInt(week.week_xp) || 0
      }
    });
  } catch (error) {
    console.error('Get stats summary error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get achievements
router.get('/achievements', async (req, res) => {
  try {
    const achievements = getAchievements(req.user.achievements);
    const unlockedCount = achievements.filter(a => a.unlocked).length;

    res.json({
      achievements,
      unlocked: unlockedCount,
      total: achievements.length,
      progress: Math.round((unlockedCount / achievements.length) * 100)
    });
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// Get streak info
router.get('/streaks', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get recent daily stats for streak calendar
    const recentStats = await db.query(
      `SELECT date, tasks_completed, xp_earned
       FROM daily_stats
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY date DESC`,
      [userId]
    );

    // Calculate if streak is at risk (no task today yet)
    const today = new Date().toISOString().split('T')[0];
    const hasTaskToday = recentStats.rows.some(s => s.date.toISOString().split('T')[0] === today);

    res.json({
      currentStreak: req.user.current_streak,
      longestStreak: req.user.longest_streak,
      streakAtRisk: !hasTaskToday && req.user.current_streak > 0,
      recentActivity: recentStats.rows.map(s => ({
        date: s.date,
        tasksCompleted: s.tasks_completed,
        xpEarned: s.xp_earned
      }))
    });
  } catch (error) {
    console.error('Get streaks error:', error);
    res.status(500).json({ error: 'Failed to fetch streak info' });
  }
});

// Get personal records
router.get('/records', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      'SELECT record_type, value, achieved_at FROM personal_records WHERE user_id = $1',
      [userId]
    );

    const recordsMap = {};
    result.rows.forEach(r => {
      recordsMap[r.record_type] = {
        value: r.value,
        achievedAt: r.achieved_at
      };
    });

    res.json({
      records: {
        mostTasksInDay: recordsMap['most-tasks-day'] || { value: 0, achievedAt: null },
        longestStreak: recordsMap['longest-streak'] || { value: req.user.longest_streak, achievedAt: null }
      }
    });
  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
});

// Get daily breakdown (for charts)
router.get('/daily', async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const result = await db.query(
      `SELECT date, tasks_completed, xp_earned, on_time_completions
       FROM daily_stats
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
       ORDER BY date ASC`,
      [userId]
    );

    res.json({
      dailyStats: result.rows.map(s => ({
        date: s.date,
        tasksCompleted: s.tasks_completed,
        xpEarned: s.xp_earned,
        onTimeCompletions: s.on_time_completions
      }))
    });
  } catch (error) {
    console.error('Get daily stats error:', error);
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

// Get level info and XP requirements
router.get('/levels', async (req, res) => {
  try {
    const levels = [];
    for (let i = 1; i <= 50; i++) {
      levels.push({
        level: i,
        xpRequired: xpToNextLevel(i),
        totalXpToReach: Array.from({ length: i - 1 }, (_, j) => xpToNextLevel(j + 1)).reduce((a, b) => a + b, 0)
      });
    }

    res.json({
      currentLevel: req.user.level,
      currentXp: req.user.xp,
      xpToNext: req.user.xp_to_next,
      levels
    });
  } catch (error) {
    console.error('Get levels error:', error);
    res.status(500).json({ error: 'Failed to fetch level info' });
  }
});

module.exports = router;
