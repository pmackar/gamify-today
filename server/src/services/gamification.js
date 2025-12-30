const db = require('../db/config');

// XP Constants
const BASE_XP = 10;
const TIER_MULTIPLIER = { tier1: 3, tier2: 2, tier3: 1 };
const DIFFICULTY_MULTIPLIER = { easy: 1, medium: 1.5, hard: 2, epic: 3 };
const ON_TIME_BONUS = 1.5;
const STREAK_BONUS_PER_DAY = 0.1;
const MAX_STREAK_MULTIPLIER = 2;

// Achievement definitions
const ACHIEVEMENTS = {
  'first-task': { name: 'First Step', desc: 'Complete your first task', xp: 25, condition: (stats) => stats.total_tasks >= 1 },
  'task-10': { name: 'Getting Going', desc: 'Complete 10 tasks', xp: 50, condition: (stats) => stats.total_tasks >= 10 },
  'task-50': { name: 'Half Century', desc: 'Complete 50 tasks', xp: 100, condition: (stats) => stats.total_tasks >= 50 },
  'task-100': { name: 'Centurion', desc: 'Complete 100 tasks', xp: 200, condition: (stats) => stats.total_tasks >= 100 },
  'task-500': { name: 'Legendary', desc: 'Complete 500 tasks', xp: 500, condition: (stats) => stats.total_tasks >= 500 },
  'streak-3': { name: 'Warming Up', desc: '3-day streak', xp: 50, condition: (stats) => stats.current_streak >= 3 },
  'streak-7': { name: 'Week Warrior', desc: '7-day streak', xp: 100, condition: (stats) => stats.current_streak >= 7 },
  'streak-14': { name: 'Fortnight Fighter', desc: '14-day streak', xp: 200, condition: (stats) => stats.current_streak >= 14 },
  'streak-30': { name: 'Monthly Master', desc: '30-day streak', xp: 500, condition: (stats) => stats.current_streak >= 30 },
  'streak-100': { name: 'Streak Legend', desc: '100-day streak', xp: 2000, condition: (stats) => stats.current_streak >= 100 },
  'on-time-10': { name: 'Punctual', desc: '10 tasks completed on time', xp: 75, condition: (stats) => stats.on_time_tasks >= 10 },
  'on-time-50': { name: 'Reliable', desc: '50 tasks completed on time', xp: 200, condition: (stats) => stats.on_time_tasks >= 50 },
  'level-5': { name: 'Rising Star', desc: 'Reach level 5', xp: 150, condition: (stats) => stats.level >= 5 },
  'level-10': { name: 'Veteran', desc: 'Reach level 10', xp: 300, condition: (stats) => stats.level >= 10 },
  'level-25': { name: 'Master', desc: 'Reach level 25', xp: 750, condition: (stats) => stats.level >= 25 }
};

// Calculate XP required for next level
function xpToNextLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

// Calculate XP earned for completing a task
function calculateTaskXP(task, currentStreak) {
  let xp = BASE_XP;

  // Apply tier multiplier
  xp *= TIER_MULTIPLIER[task.tier] || TIER_MULTIPLIER.tier3;

  // Apply difficulty multiplier
  xp *= DIFFICULTY_MULTIPLIER[task.difficulty] || DIFFICULTY_MULTIPLIER.medium;

  // Apply on-time bonus if task has a due date and was completed on time
  if (task.due_date && task.was_on_time) {
    xp *= ON_TIME_BONUS;
  }

  // Apply streak bonus (capped at 2x)
  const streakMultiplier = Math.min(1 + (currentStreak * STREAK_BONUS_PER_DAY), MAX_STREAK_MULTIPLIER);
  xp *= streakMultiplier;

  return Math.floor(xp);
}

// Process task completion - update user stats, XP, level, streaks, achievements
async function processTaskCompletion(userId, task) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Get current user stats
    const userResult = await client.query(
      'SELECT level, xp, xp_to_next, total_tasks_completed, current_streak, longest_streak, achievements, last_task_date FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const lastTaskDate = user.last_task_date ? user.last_task_date.toISOString().split('T')[0] : null;

    // Calculate streak
    let newStreak = user.current_streak;
    if (lastTaskDate === today) {
      // Already completed a task today, streak unchanged
    } else if (lastTaskDate === getYesterday()) {
      // Completed task yesterday, increment streak
      newStreak += 1;
    } else {
      // Streak broken or first task
      newStreak = 1;
    }

    const longestStreak = Math.max(newStreak, user.longest_streak);

    // Calculate XP for this task
    const earnedXP = calculateTaskXP(task, newStreak);

    // Calculate new XP and level
    let newXP = user.xp + earnedXP;
    let newLevel = user.level;
    let xpToNext = user.xp_to_next;

    // Level up check (can level up multiple times)
    while (newXP >= xpToNext) {
      newXP -= xpToNext;
      newLevel += 1;
      xpToNext = xpToNextLevel(newLevel);
    }

    // Check for new achievements
    const currentAchievements = user.achievements || [];
    const newAchievements = [];
    let achievementXP = 0;

    // Get on-time completions count for achievement checking
    const onTimeResult = await client.query(
      'SELECT COUNT(*) as count FROM tasks WHERE user_id = $1 AND was_on_time = true',
      [userId]
    );
    const onTimeTasks = parseInt(onTimeResult.rows[0].count) + (task.was_on_time ? 1 : 0);

    const stats = {
      total_tasks: user.total_tasks_completed + 1,
      current_streak: newStreak,
      on_time_tasks: onTimeTasks,
      level: newLevel
    };

    for (const [id, achievement] of Object.entries(ACHIEVEMENTS)) {
      if (!currentAchievements.includes(id) && achievement.condition(stats)) {
        newAchievements.push(id);
        achievementXP += achievement.xp;
      }
    }

    // Add achievement XP
    if (achievementXP > 0) {
      newXP += achievementXP;
      // Recheck level ups after achievement XP
      while (newXP >= xpToNext) {
        newXP -= xpToNext;
        newLevel += 1;
        xpToNext = xpToNextLevel(newLevel);
      }
    }

    const allAchievements = [...currentAchievements, ...newAchievements];

    // Update user
    await client.query(
      `UPDATE users SET
        level = $1, xp = $2, xp_to_next = $3,
        total_tasks_completed = total_tasks_completed + 1,
        current_streak = $4, longest_streak = $5,
        achievements = $6, last_task_date = $7
      WHERE id = $8`,
      [newLevel, newXP, xpToNext, newStreak, longestStreak, allAchievements, today, userId]
    );

    // Update task with earned XP
    await client.query(
      'UPDATE tasks SET xp_earned = $1 WHERE id = $2',
      [earnedXP, task.id]
    );

    // Update or insert daily stats
    await client.query(
      `INSERT INTO daily_stats (user_id, date, tasks_completed, xp_earned, on_time_completions)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (user_id, date)
       DO UPDATE SET
         tasks_completed = daily_stats.tasks_completed + 1,
         xp_earned = daily_stats.xp_earned + $3,
         on_time_completions = daily_stats.on_time_completions + $4`,
      [userId, today, earnedXP, task.was_on_time ? 1 : 0]
    );

    // Update personal records
    await updatePersonalRecords(client, userId, {
      tasksToday: (await client.query(
        'SELECT tasks_completed FROM daily_stats WHERE user_id = $1 AND date = $2',
        [userId, today]
      )).rows[0]?.tasks_completed || 1,
      streak: newStreak
    });

    await client.query('COMMIT');

    return {
      earnedXP,
      totalXP: newXP,
      level: newLevel,
      xpToNext,
      streak: newStreak,
      longestStreak,
      newAchievements: newAchievements.map(id => ({
        id,
        ...ACHIEVEMENTS[id]
      })),
      achievementXP
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updatePersonalRecords(client, userId, stats) {
  // Most tasks in a day
  await client.query(
    `INSERT INTO personal_records (user_id, record_type, value)
     VALUES ($1, 'most-tasks-day', $2)
     ON CONFLICT (user_id, record_type)
     DO UPDATE SET value = GREATEST(personal_records.value, $2), achieved_at = CURRENT_TIMESTAMP
     WHERE personal_records.value < $2`,
    [userId, stats.tasksToday]
  );

  // Longest streak
  await client.query(
    `INSERT INTO personal_records (user_id, record_type, value)
     VALUES ($1, 'longest-streak', $2)
     ON CONFLICT (user_id, record_type)
     DO UPDATE SET value = GREATEST(personal_records.value, $2), achieved_at = CURRENT_TIMESTAMP
     WHERE personal_records.value < $2`,
    [userId, stats.streak]
  );
}

function getYesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split('T')[0];
}

// Get all achievements with unlock status for a user
function getAchievements(userAchievements = []) {
  return Object.entries(ACHIEVEMENTS).map(([id, achievement]) => ({
    id,
    name: achievement.name,
    description: achievement.desc,
    xp: achievement.xp,
    unlocked: userAchievements.includes(id)
  }));
}

// Process task uncompletion - revoke XP and update user stats
async function processTaskUncompletion(userId, task) {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // Get current user stats
    const userResult = await client.query(
      'SELECT level, xp, xp_to_next, total_tasks_completed FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = userResult.rows[0];
    const xpToRevoke = task.xp_earned || 0;

    if (xpToRevoke === 0) {
      // No XP was earned for this task, just update count
      await client.query(
        'UPDATE users SET total_tasks_completed = GREATEST(0, total_tasks_completed - 1) WHERE id = $1',
        [userId]
      );
      await client.query('COMMIT');
      return { revokedXP: 0, totalXP: user.xp, level: user.level, xpToNext: user.xp_to_next };
    }

    // Calculate new XP and level after revocation
    // We need to work backwards - add back XP from previous levels if we need to delevel
    let totalXPEver = 0;
    for (let l = 1; l < user.level; l++) {
      totalXPEver += xpToNextLevel(l);
    }
    totalXPEver += user.xp; // Add current progress in current level

    // Subtract the revoked XP
    totalXPEver = Math.max(0, totalXPEver - xpToRevoke);

    // Recalculate level from total XP
    let newLevel = 1;
    let remainingXP = totalXPEver;
    while (remainingXP >= xpToNextLevel(newLevel)) {
      remainingXP -= xpToNextLevel(newLevel);
      newLevel++;
    }

    const newXP = remainingXP;
    const newXPToNext = xpToNextLevel(newLevel);

    // Update user
    await client.query(
      `UPDATE users SET
        level = $1, xp = $2, xp_to_next = $3,
        total_tasks_completed = GREATEST(0, total_tasks_completed - 1)
      WHERE id = $4`,
      [newLevel, newXP, newXPToNext, userId]
    );

    // Clear the xp_earned on the task
    await client.query(
      'UPDATE tasks SET xp_earned = 0 WHERE id = $1',
      [task.id]
    );

    // Update daily stats (decrement if same day)
    const today = new Date().toISOString().split('T')[0];
    const completedDate = task.completed_at ? new Date(task.completed_at).toISOString().split('T')[0] : today;

    await client.query(
      `UPDATE daily_stats SET
        tasks_completed = GREATEST(0, tasks_completed - 1),
        xp_earned = GREATEST(0, xp_earned - $1),
        on_time_completions = GREATEST(0, on_time_completions - $2)
      WHERE user_id = $3 AND date = $4`,
      [xpToRevoke, task.was_on_time ? 1 : 0, userId, completedDate]
    );

    await client.query('COMMIT');

    return {
      revokedXP: xpToRevoke,
      totalXP: newXP,
      level: newLevel,
      xpToNext: newXPToNext,
      levelChanged: newLevel !== user.level
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  calculateTaskXP,
  processTaskCompletion,
  processTaskUncompletion,
  xpToNextLevel,
  getAchievements,
  ACHIEVEMENTS
};
