// gamify.life Main Application - localStorage-first with Supabase sync

// ============================================
// STORAGE & STATE
// ============================================

const STORAGE_KEY = 'gamify_life';
const SUPABASE_URL = 'https://klsxuyiwkjrkkvwwbehc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0E7ZTG1PKHzMBbxiv4uKdg_uyyKDulz';

// Default state structure
function getDefaultState() {
  return {
    profile: {
      name: 'User',
      level: 1,
      xp: 0,
      xp_to_next: 100,
      total_tasks_completed: 0,
      current_streak: 0,
      longest_streak: 0,
      achievements: [],
      last_task_date: null
    },
    tasks: [],
    projects: [],
    categories: [],
    daily_stats: [],
    personal_records: {},
    _meta: {
      version: 1,
      last_sync: null,
      schema_version: '1.0.0'
    }
  };
}

// App state
let state = getDefaultState();
let currentView = 'inbox';
let currentTheme = 'light';

// Supabase sync state
let supabaseClient = null;
let currentUser = null;
let syncTimeout = null;
let isSyncing = false;

// Load state from localStorage
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = { ...getDefaultState(), ...parsed };
      // Ensure all arrays exist
      state.tasks = state.tasks || [];
      state.projects = state.projects || [];
      state.categories = state.categories || [];
      state.daily_stats = state.daily_stats || [];
      state.personal_records = state.personal_records || {};
    }
  } catch (e) {
    console.error('Failed to load state:', e);
    state = getDefaultState();
  }
}

// Save state to localStorage and queue cloud sync
function saveState() {
  try {
    state._meta.version = (state._meta.version || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    queueCloudSync();
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

// ============================================
// SUPABASE CLOUD SYNC
// ============================================

function initSupabase() {
  if (typeof window.supabase !== 'undefined') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Listen for auth changes
    supabaseClient.auth.onAuthStateChange((event, session) => {
      handleAuthChange(event, session);
    });

    // Check current session
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        handleAuthChange('INITIAL', session);
      }
    });
  }
}

async function handleAuthChange(event, session) {
  if (session?.user) {
    currentUser = session.user;
    updateAuthUI(true);

    if (event === 'SIGNED_IN' || event === 'INITIAL') {
      await fetchAndMergeCloudData();

      // Set profile name from OAuth if still default
      const oauthName = currentUser.user_metadata?.full_name;
      if (oauthName && state.profile.name === 'User') {
        state.profile.name = oauthName;
        saveState();
      }
      updateUserDisplay();
      renderAll();
    }
  } else {
    currentUser = null;
    updateAuthUI(false);
  }
}

function updateAuthUI(isLoggedIn) {
  const loginBtn = document.getElementById('login-btn');
  const userInfo = document.getElementById('user-info');
  const avatar = document.getElementById('user-avatar');

  if (isLoggedIn && currentUser) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.remove('hidden');

    // Set avatar initial
    if (avatar) {
      const name = currentUser.user_metadata?.full_name || currentUser.email || 'U';
      avatar.textContent = name.charAt(0).toUpperCase();
    }
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.add('hidden');
  }
}

async function loginWithGoogle() {
  if (!supabaseClient) {
    showToast('Cloud sync not available');
    return;
  }

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + '/app.html'
    }
  });

  if (error) {
    console.error('Login error:', error);
    showToast('Login failed', 'error');
  }
}

async function logout() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  currentUser = null;
  updateAuthUI(false);
  showToast('Logged out - data stored locally');
}

function showUserMenu() {
  if (confirm('Log out of cloud sync?')) {
    logout();
  }
}

// Cloud sync functions
function queueCloudSync() {
  if (!supabaseClient || !currentUser) return;

  clearTimeout(syncTimeout);
  updateSyncIndicator('pending');
  syncTimeout = setTimeout(syncToCloud, 2000);
}

async function syncToCloud() {
  if (!supabaseClient || !currentUser || isSyncing) return;

  isSyncing = true;
  updateSyncIndicator('syncing');

  try {
    const { error } = await supabaseClient
      .from('gamify_today_data')
      .upsert({
        user_id: currentUser.id,
        data: state,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    if (error) throw error;

    state._meta.last_sync = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateSyncIndicator('synced');
  } catch (e) {
    console.error('Sync error:', e);
    updateSyncIndicator('offline');
  } finally {
    isSyncing = false;
  }
}

async function fetchAndMergeCloudData() {
  if (!supabaseClient || !currentUser) return;

  updateSyncIndicator('syncing');

  try {
    const { data, error } = await supabaseClient
      .from('gamify_today_data')
      .select('data, updated_at')
      .eq('user_id', currentUser.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data?.data) {
      state = mergeData(state, data.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      showToast('Synced from cloud', 'success');
    } else {
      await syncToCloud();
    }

    updateSyncIndicator('synced');
  } catch (e) {
    console.error('Fetch error:', e);
    updateSyncIndicator('offline');
  }
}

function mergeData(local, cloud) {
  // Profile: use higher XP/level, merge achievements
  const profile = {
    ...getDefaultState().profile,
    ...cloud.profile,
    ...local.profile,
    level: Math.max(local.profile?.level || 1, cloud.profile?.level || 1),
    xp: Math.max(local.profile?.xp || 0, cloud.profile?.xp || 0),
    total_tasks_completed: Math.max(
      local.profile?.total_tasks_completed || 0,
      cloud.profile?.total_tasks_completed || 0
    ),
    current_streak: Math.max(
      local.profile?.current_streak || 0,
      cloud.profile?.current_streak || 0
    ),
    longest_streak: Math.max(
      local.profile?.longest_streak || 0,
      cloud.profile?.longest_streak || 0
    ),
    achievements: [...new Set([
      ...(local.profile?.achievements || []),
      ...(cloud.profile?.achievements || [])
    ])],
    name: local.profile?.name !== 'User' ? local.profile?.name : (cloud.profile?.name || 'User')
  };

  // Recalculate xp_to_next based on level
  profile.xp_to_next = Gamification.xpToNextLevel(profile.level);

  // Tasks: combine, dedupe by ID, keep newer version
  const tasks = mergeArrayById(local.tasks || [], cloud.tasks || [], 'updated_at');

  // Projects: same approach
  const projects = mergeArrayById(local.projects || [], cloud.projects || [], 'updated_at');

  // Categories: same approach
  const categories = mergeArrayById(local.categories || [], cloud.categories || [], 'created_at');

  // Daily stats: combine by date, keep higher values
  const dailyStatsMap = new Map();
  [...(cloud.daily_stats || []), ...(local.daily_stats || [])].forEach(stat => {
    const existing = dailyStatsMap.get(stat.date);
    if (!existing) {
      dailyStatsMap.set(stat.date, stat);
    } else {
      dailyStatsMap.set(stat.date, {
        date: stat.date,
        tasks_completed: Math.max(existing.tasks_completed || 0, stat.tasks_completed || 0),
        xp_earned: Math.max(existing.xp_earned || 0, stat.xp_earned || 0)
      });
    }
  });
  const daily_stats = Array.from(dailyStatsMap.values())
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Personal records: keep higher values
  const personal_records = { ...(cloud.personal_records || {}), ...(local.personal_records || {}) };
  Object.entries(cloud.personal_records || {}).forEach(([key, value]) => {
    if (!personal_records[key] || value.value > personal_records[key].value) {
      personal_records[key] = value;
    }
  });

  return {
    profile,
    tasks,
    projects,
    categories,
    daily_stats,
    personal_records,
    _meta: {
      version: Math.max(local._meta?.version || 0, cloud._meta?.version || 0) + 1,
      last_sync: new Date().toISOString(),
      schema_version: '1.0.0'
    }
  };
}

function mergeArrayById(localArr, cloudArr, timestampField) {
  const map = new Map();

  cloudArr.forEach(item => map.set(item.id, item));

  localArr.forEach(item => {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const localTime = new Date(item[timestampField] || 0);
      const cloudTime = new Date(existing[timestampField] || 0);
      if (localTime > cloudTime) {
        map.set(item.id, item);
      }
    }
  });

  return Array.from(map.values());
}

function updateSyncIndicator(status) {
  const indicator = document.getElementById('sync-indicator');
  if (!indicator) return;

  indicator.classList.remove('syncing', 'offline', 'pending');

  if (status === 'syncing') {
    indicator.classList.add('syncing');
    indicator.title = 'Syncing...';
  } else if (status === 'offline') {
    indicator.classList.add('offline');
    indicator.title = 'Sync failed';
  } else if (status === 'pending') {
    indicator.classList.add('pending');
    indicator.title = 'Changes pending...';
  } else {
    indicator.title = 'Synced';
  }
}

// ============================================
// GAMIFICATION
// ============================================

// Achievement definitions
const ACHIEVEMENTS = [
  { id: 'first-task', name: 'First Steps', description: 'Complete your first task', xp: 50, check: (s) => s.profile.total_tasks_completed >= 1 },
  { id: 'task-10', name: 'Getting Started', description: 'Complete 10 tasks', xp: 100, check: (s) => s.profile.total_tasks_completed >= 10 },
  { id: 'task-50', name: 'Productive', description: 'Complete 50 tasks', xp: 250, check: (s) => s.profile.total_tasks_completed >= 50 },
  { id: 'task-100', name: 'Century', description: 'Complete 100 tasks', xp: 500, check: (s) => s.profile.total_tasks_completed >= 100 },
  { id: 'task-500', name: 'Task Master', description: 'Complete 500 tasks', xp: 1000, check: (s) => s.profile.total_tasks_completed >= 500 },
  { id: 'streak-3', name: 'On a Roll', description: 'Reach a 3-day streak', xp: 75, check: (s) => s.profile.longest_streak >= 3 },
  { id: 'streak-7', name: 'Week Warrior', description: 'Reach a 7-day streak', xp: 150, check: (s) => s.profile.longest_streak >= 7 },
  { id: 'streak-14', name: 'Two Week Champion', description: 'Reach a 14-day streak', xp: 300, check: (s) => s.profile.longest_streak >= 14 },
  { id: 'streak-30', name: 'Monthly Master', description: 'Reach a 30-day streak', xp: 750, check: (s) => s.profile.longest_streak >= 30 },
  { id: 'level-5', name: 'Apprentice', description: 'Reach level 5', xp: 100, check: (s) => s.profile.level >= 5 },
  { id: 'level-10', name: 'Journeyman', description: 'Reach level 10', xp: 200, check: (s) => s.profile.level >= 10 },
  { id: 'level-25', name: 'Expert', description: 'Reach level 25', xp: 500, check: (s) => s.profile.level >= 25 },
  { id: 'level-50', name: 'Legend', description: 'Reach level 50', xp: 1000, check: (s) => s.profile.level >= 50 },
  { id: 'epic-task', name: 'Epic Victory', description: 'Complete an Epic difficulty task', xp: 100, check: (s) => s.tasks.some(t => t.is_completed && t.difficulty === 'epic') },
  { id: 'major-task', name: 'Major Achievement', description: 'Complete a Major tier task', xp: 100, check: (s) => s.tasks.some(t => t.is_completed && t.tier === 'tier1') }
];

function calculateTaskXP(task) {
  let xp = Gamification.BASE_XP;
  xp *= Gamification.TIER_MULTIPLIER[task.tier] || Gamification.TIER_MULTIPLIER.tier3;
  xp *= Gamification.DIFFICULTY_MULTIPLIER[task.difficulty] || Gamification.DIFFICULTY_MULTIPLIER.medium;

  // On-time bonus
  if (task.due_date) {
    const wasOnTime = new Date() <= new Date(task.due_date);
    if (wasOnTime) {
      xp *= Gamification.ON_TIME_BONUS;
      task.was_on_time = true;
    }
  }

  // Streak bonus
  const streakMultiplier = Math.min(
    1 + (state.profile.current_streak * Gamification.STREAK_BONUS_PER_DAY),
    Gamification.MAX_STREAK_MULTIPLIER
  );
  xp *= streakMultiplier;

  return Math.floor(xp);
}

function updateStreak() {
  const today = new Date().toISOString().split('T')[0];
  const lastDate = state.profile.last_task_date;

  if (!lastDate) {
    state.profile.current_streak = 1;
  } else {
    const last = new Date(lastDate);
    const now = new Date(today);
    const diffDays = Math.floor((now - last) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      // Same day, no change
    } else if (diffDays === 1) {
      state.profile.current_streak++;
    } else {
      state.profile.current_streak = 1;
    }
  }

  state.profile.last_task_date = today;
  state.profile.longest_streak = Math.max(state.profile.longest_streak, state.profile.current_streak);
}

function updateDailyStats(xpEarned) {
  const today = new Date().toISOString().split('T')[0];
  let todayStat = state.daily_stats.find(s => s.date === today);

  if (!todayStat) {
    todayStat = { date: today, tasks_completed: 0, xp_earned: 0 };
    state.daily_stats.unshift(todayStat);
  }

  todayStat.tasks_completed++;
  todayStat.xp_earned += xpEarned;
}

function addXP(amount) {
  state.profile.xp += amount;

  // Check for level up
  let leveledUp = false;
  while (state.profile.xp >= state.profile.xp_to_next) {
    state.profile.xp -= state.profile.xp_to_next;
    state.profile.level++;
    state.profile.xp_to_next = Gamification.xpToNextLevel(state.profile.level);
    leveledUp = true;
  }

  return leveledUp;
}

function checkAchievements() {
  const newAchievements = [];

  ACHIEVEMENTS.forEach(achievement => {
    if (!state.profile.achievements.includes(achievement.id) && achievement.check(state)) {
      state.profile.achievements.push(achievement.id);
      addXP(achievement.xp);
      newAchievements.push(achievement);
    }
  });

  return newAchievements;
}

// ============================================
// THEME MANAGEMENT
// ============================================

function setTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gamify-theme', theme);

  document.querySelectorAll('.theme-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.theme === theme);
  });
}

function loadSavedTheme() {
  const savedTheme = localStorage.getItem('gamify-theme') || 'light';
  setTheme(savedTheme);
}

// ============================================
// USER DISPLAY
// ============================================

const characterRanks = [
  { minLevel: 1, rank: 'Novice', icon: '🎮' },
  { minLevel: 5, rank: 'Apprentice', icon: '⚔️' },
  { minLevel: 10, rank: 'Journeyman', icon: '🛡️' },
  { minLevel: 15, rank: 'Adept', icon: '🗡️' },
  { minLevel: 20, rank: 'Expert', icon: '🏹' },
  { minLevel: 30, rank: 'Master', icon: '👑' },
  { minLevel: 40, rank: 'Grandmaster', icon: '⚡' },
  { minLevel: 50, rank: 'Legend', icon: '🌟' },
  { minLevel: 75, rank: 'Mythic', icon: '🔱' },
  { minLevel: 100, rank: 'Immortal', icon: '💎' }
];

function getRankForLevel(level) {
  let result = characterRanks[0];
  for (const rank of characterRanks) {
    if (level >= rank.minLevel) result = rank;
    else break;
  }
  return result;
}

function updateUserDisplay() {
  const profile = state.profile;
  const level = profile.level || 1;
  const xp = profile.xp || 0;
  const xpToNext = profile.xp_to_next || 100;
  const streak = profile.current_streak || 0;

  // Update level badge
  const userLevel = document.getElementById('userLevel');
  if (userLevel) userLevel.textContent = level;

  // Update XP display
  const xpCurrent = document.getElementById('xpCurrent');
  const xpToNextEl = document.getElementById('xpToNext');
  if (xpCurrent) xpCurrent.textContent = xp;
  if (xpToNextEl) xpToNextEl.textContent = xpToNext;

  // Update XP bar
  const xpPercent = Math.min((xp / xpToNext) * 100, 100);
  const xpBarFill = document.getElementById('xpBarFill');
  if (xpBarFill) xpBarFill.style.width = `${xpPercent}%`;

  // Update level ring
  const levelRing = document.getElementById('levelRingProgress');
  if (levelRing) {
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (xpPercent / 100) * circumference;
    levelRing.style.strokeDashoffset = offset;
  }

  // Update rank
  const rankInfo = getRankForLevel(level);
  const rankEl = document.getElementById('characterRank');
  const avatarIcon = document.getElementById('avatarIcon');
  if (rankEl) rankEl.textContent = rankInfo.rank;
  if (avatarIcon) avatarIcon.textContent = rankInfo.icon;

  // Update streak
  const streakCount = document.getElementById('streakCount');
  if (streakCount) streakCount.textContent = streak;

  // Update tasks completed today
  updateTasksCompletedToday();
}

function updateTasksCompletedToday() {
  const today = new Date().toISOString().split('T')[0];
  const todayStat = state.daily_stats.find(s => s.date === today);
  const countEl = document.getElementById('tasksCompletedToday');
  if (countEl) countEl.textContent = todayStat?.tasks_completed || 0;
}

function triggerLevelUpAnimation() {
  const avatar = document.getElementById('characterAvatar');
  if (avatar) {
    avatar.classList.add('level-up');
    setTimeout(() => avatar.classList.remove('level-up'), 1000);
  }
}

// ============================================
// TASKS CRUD (LOCAL)
// ============================================

function getFilteredTasks() {
  let filtered = [...state.tasks];

  if (currentView === 'today') {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    filtered = filtered.filter(t => !t.is_completed && t.due_date && new Date(t.due_date) <= today);
  } else if (currentView === 'upcoming') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    filtered = filtered.filter(t => !t.is_completed && t.due_date && new Date(t.due_date) >= tomorrow);
  } else if (currentView === 'completed') {
    filtered = filtered.filter(t => t.is_completed);
  } else if (currentView.startsWith('project-')) {
    const projectId = currentView.replace('project-', '');
    filtered = filtered.filter(t => t.project_id === projectId && !t.is_completed);
  } else if (currentView.startsWith('category-')) {
    const categoryId = currentView.replace('category-', '');
    filtered = filtered.filter(t => t.category_id === categoryId && !t.is_completed);
  } else {
    // Inbox: all incomplete tasks
    filtered = filtered.filter(t => !t.is_completed);
  }

  // Sort by order_index, then by created_at
  filtered.sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || new Date(b.created_at) - new Date(a.created_at));

  return filtered;
}

function renderTasks() {
  const tasks = getFilteredTasks();
  const container = document.getElementById('taskList');
  const emptyState = document.getElementById('emptyState');

  if (tasks.length === 0) {
    if (container) container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  if (container) {
    container.innerHTML = tasks.map(task => {
      const priorityClass = task.priority ? `priority-${task.priority.toLowerCase()}` : '';
      const completedClass = task.is_completed ? 'completed' : '';
      const dueInfo = Gamification.formatDueDate(task.due_date);
      const tierInfo = Gamification.getTierInfo(task.tier);
      const project = state.projects.find(p => p.id === task.project_id);
      const xpPreview = Gamification.calculateXPPreview(task, state.profile.current_streak);

      return `
        <div class="task-card ${priorityClass} ${completedClass}" data-id="${task.id}">
          <div class="task-checkbox ${task.is_completed ? 'checked' : ''}"
               onclick="toggleTaskComplete('${task.id}', ${!task.is_completed})"></div>
          <div class="task-content" onclick="editTask('${task.id}')">
            <div class="task-title">${escapeHtml(task.title)}</div>
            <div class="task-meta">
              ${project ? `<span>📁 ${escapeHtml(project.name)}</span>` : ''}
              ${dueInfo ? `<span class="task-due ${dueInfo.class}">📅 ${dueInfo.text}</span>` : ''}
              <span class="tier-badge ${task.tier}">${tierInfo.name}</span>
              ${!task.is_completed ? `<span class="task-xp">${Gamification.formatXP(xpPreview)}</span>` : ''}
              ${task.is_completed && task.xp_earned ? `<span class="task-xp">Earned ${task.xp_earned} XP</span>` : ''}
            </div>
          </div>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteTask('${task.id}')" title="Delete">
            🗑️
          </button>
        </div>
      `;
    }).join('');
  }
}

function createTask(taskData) {
  const task = {
    id: Date.now().toString(),
    title: taskData.title || '',
    description: taskData.description || '',
    status: 'Not started',
    priority: taskData.priority || null,
    tier: taskData.tier || 'tier3',
    difficulty: taskData.difficulty || 'medium',
    due_date: taskData.due_date || null,
    is_completed: false,
    completed_at: null,
    xp_earned: 0,
    was_on_time: null,
    project_id: taskData.project_id || null,
    category_id: taskData.category_id || null,
    tags: taskData.tags || [],
    order_index: state.tasks.length,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  state.tasks.push(task);
  saveState();
  renderTasks();
  updateTaskCounts();

  return task;
}

function updateTask(taskId, updates) {
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    Object.assign(task, updates, { updated_at: new Date().toISOString() });
    saveState();
    renderTasks();
  }
}

function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;

  state.tasks = state.tasks.filter(t => t.id !== taskId);
  saveState();
  renderTasks();
  updateTaskCounts();
  showToast('Task deleted', 'success');
}

function toggleTaskComplete(taskId, complete) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (complete) {
    // Calculate XP
    const xpEarned = calculateTaskXP(task);
    task.xp_earned = xpEarned;
    task.is_completed = true;
    task.completed_at = new Date().toISOString();
    task.updated_at = new Date().toISOString();

    // Update stats
    state.profile.total_tasks_completed++;
    updateStreak();
    updateDailyStats(xpEarned);

    // Add XP and check level up
    const leveledUp = addXP(xpEarned);

    // Check achievements
    const newAchievements = checkAchievements();

    saveState();
    renderTasks();
    updateUserDisplay();
    updateTaskCounts();

    // Show feedback
    showToast(`+${xpEarned} XP earned!`, 'success');

    if (leveledUp) {
      Gamification.createConfetti();
      triggerLevelUpAnimation();
      showToast(`Level Up! You're now level ${state.profile.level}!`, 'success');
    }

    newAchievements.forEach(achievement => {
      setTimeout(() => showAchievementToast(achievement), 500);
    });

  } else {
    // Uncomplete task - revoke XP
    const revokedXP = task.xp_earned || 0;

    if (revokedXP > 0) {
      state.profile.xp -= revokedXP;

      // Handle level down
      while (state.profile.xp < 0 && state.profile.level > 1) {
        state.profile.level--;
        state.profile.xp_to_next = Gamification.xpToNextLevel(state.profile.level);
        state.profile.xp += state.profile.xp_to_next;
      }
      state.profile.xp = Math.max(0, state.profile.xp);

      state.profile.total_tasks_completed = Math.max(0, state.profile.total_tasks_completed - 1);
      showToast(`-${revokedXP} XP revoked`, 'error');
    }

    task.is_completed = false;
    task.completed_at = null;
    task.xp_earned = 0;
    task.updated_at = new Date().toISOString();

    saveState();
    renderTasks();
    updateUserDisplay();
    updateTaskCounts();
  }
}

function updateTaskCounts() {
  const incompleteTasks = state.tasks.filter(t => !t.is_completed);
  const inboxCount = document.getElementById('inboxCount');
  if (inboxCount) inboxCount.textContent = incompleteTasks.length;

  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const todayTasks = incompleteTasks.filter(t => t.due_date && new Date(t.due_date) <= today);
  const todayCount = document.getElementById('todayCount');
  if (todayCount) todayCount.textContent = todayTasks.length;
}

// ============================================
// PROJECTS CRUD (LOCAL)
// ============================================

function renderProjectsList() {
  const container = document.getElementById('projectsList');
  if (!container) return;

  container.innerHTML = state.projects.map(project => {
    const taskCount = state.tasks.filter(t => t.project_id === project.id && !t.is_completed).length;
    return `
      <div class="nav-item-wrapper">
        <div class="nav-item ${currentView === 'project-' + project.id ? 'active' : ''}"
             data-view="project-${project.id}"
             onclick="setActiveView('project-${project.id}')">
          <span class="nav-item-icon">📁</span>
          <span class="truncate">${escapeHtml(project.name)}</span>
          <span class="nav-item-count">${taskCount}</span>
        </div>
        <div class="nav-item-actions">
          <button class="nav-item-action" onclick="event.stopPropagation(); editProject('${project.id}')" title="Edit project">✏️</button>
          <button class="nav-item-action nav-item-action-delete" onclick="event.stopPropagation(); deleteProject('${project.id}')" title="Delete project">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateProjectSelect() {
  const select = document.getElementById('taskProject');
  if (!select) return;

  select.innerHTML = '<option value="">None</option>' +
    state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function createProject(projectData) {
  const project = {
    id: Date.now().toString(),
    name: projectData.name || '',
    description: projectData.description || '',
    status: 'Not started',
    start_date: projectData.start_date || null,
    due_date: projectData.due_date || null,
    tier: 'tier2',
    xp_earned: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  state.projects.push(project);
  saveState();
  renderProjectsList();
  updateProjectSelect();

  return project;
}

// ============================================
// CATEGORIES CRUD (LOCAL)
// ============================================

function renderCategoriesList() {
  const container = document.getElementById('categoriesList');
  if (!container) return;

  container.innerHTML = state.categories.map(cat => `
    <div class="nav-item-wrapper">
      <div class="nav-item ${currentView === 'category-' + cat.id ? 'active' : ''}"
           data-view="category-${cat.id}"
           onclick="setActiveView('category-${cat.id}')">
        <span class="category-dot" style="background: ${cat.color}"></span>
        <span class="truncate">${escapeHtml(cat.name)}</span>
      </div>
      <div class="nav-item-actions">
        <button class="nav-item-action" onclick="event.stopPropagation(); editCategory('${cat.id}')" title="Edit category">✏️</button>
        <button class="nav-item-action nav-item-action-delete" onclick="event.stopPropagation(); deleteCategory('${cat.id}')" title="Delete category">🗑️</button>
      </div>
    </div>
  `).join('');
}

function updateCategorySelect() {
  const select = document.getElementById('taskCategory');
  if (!select) return;

  select.innerHTML = '<option value="">None</option>' +
    state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function createCategory(categoryData) {
  const category = {
    id: Date.now().toString(),
    name: categoryData.name || '',
    color: categoryData.color || '#6b7280',
    order_index: state.categories.length,
    created_at: new Date().toISOString()
  };

  state.categories.push(category);
  saveState();
  renderCategoriesList();
  updateCategorySelect();

  return category;
}

// ============================================
// VIEW MANAGEMENT
// ============================================

function setActiveView(view) {
  currentView = view;

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.view === view) {
      item.classList.add('active');
    }
  });

  const titles = {
    inbox: { title: 'Inbox', subtitle: 'All your tasks' },
    today: { title: 'Today', subtitle: 'Tasks due today' },
    upcoming: { title: 'Upcoming', subtitle: 'Future tasks' },
    completed: { title: 'Completed', subtitle: 'Finished tasks' }
  };

  if (titles[view]) {
    document.getElementById('viewTitle').textContent = titles[view].title;
    document.getElementById('viewSubtitle').textContent = titles[view].subtitle;
  } else if (view.startsWith('project-')) {
    const project = state.projects.find(p => p.id === view.replace('project-', ''));
    if (project) {
      document.getElementById('viewTitle').textContent = project.name;
      document.getElementById('viewSubtitle').textContent = 'Project tasks';
    }
  } else if (view.startsWith('category-')) {
    const category = state.categories.find(c => c.id === view.replace('category-', ''));
    if (category) {
      document.getElementById('viewTitle').textContent = category.name;
      document.getElementById('viewSubtitle').textContent = 'Category tasks';
    }
  }

  renderTasks();
}

// ============================================
// MODALS
// ============================================

function showTaskModal(taskData = null) {
  document.getElementById('taskModal').classList.add('active');
  document.getElementById('taskModalTitle').textContent = taskData ? 'Edit Task' : 'Add Task';

  if (taskData) {
    document.getElementById('taskId').value = taskData.id;
    document.getElementById('taskTitle').value = taskData.title;
    document.getElementById('taskDescription').value = taskData.description || '';
    document.getElementById('taskDueDate').value = taskData.due_date ? taskData.due_date.slice(0, 16) : '';
    document.getElementById('taskPriority').value = taskData.priority || '';
    document.getElementById('taskTier').value = taskData.tier || 'tier3';
    document.getElementById('taskDifficulty').value = taskData.difficulty || 'medium';
    document.getElementById('taskProject').value = taskData.project_id || '';
    document.getElementById('taskCategory').value = taskData.category_id || '';
  } else {
    document.getElementById('taskForm').reset();
    document.getElementById('taskId').value = '';
  }

  updateXPPreview();
}

function closeTaskModal() {
  document.getElementById('taskModal').classList.remove('active');
}

function saveTask() {
  const id = document.getElementById('taskId').value;
  const data = {
    title: document.getElementById('taskTitle').value,
    description: document.getElementById('taskDescription').value || null,
    due_date: document.getElementById('taskDueDate').value || null,
    priority: document.getElementById('taskPriority').value || null,
    tier: document.getElementById('taskTier').value,
    difficulty: document.getElementById('taskDifficulty').value,
    project_id: document.getElementById('taskProject').value || null,
    category_id: document.getElementById('taskCategory').value || null
  };

  if (!data.title) {
    showToast('Please enter a task title', 'error');
    return;
  }

  if (id) {
    updateTask(id, data);
    showToast('Task updated', 'success');
  } else {
    createTask(data);
    showToast('Task created', 'success');
  }

  closeTaskModal();
}

function editTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    showTaskModal(task);
  }
}

function showProjectModal() {
  document.getElementById('projectModal').classList.add('active');
  document.getElementById('projectForm').reset();
  document.getElementById('projectId').value = '';
}

function closeProjectModal() {
  document.getElementById('projectModal').classList.remove('active');
}

function saveProject() {
  const id = document.getElementById('projectId').value;
  const data = {
    name: document.getElementById('projectName').value,
    description: document.getElementById('projectDescription').value || null,
    start_date: document.getElementById('projectStartDate').value || null,
    due_date: document.getElementById('projectDueDate').value || null
  };

  if (!data.name) {
    showToast('Please enter a project name', 'error');
    return;
  }

  if (id) {
    const project = state.projects.find(p => p.id === id);
    if (project) {
      Object.assign(project, data, { updated_at: new Date().toISOString() });
      saveState();
    }
    showToast('Project updated', 'success');
  } else {
    createProject(data);
    showToast('Project created', 'success');
  }

  closeProjectModal();
  renderProjectsList();
}

function showCategoryModal() {
  document.getElementById('categoryModal').classList.add('active');
  document.getElementById('categoryForm').reset();
  document.getElementById('categoryId').value = '';
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('active');
}

function saveCategory() {
  const id = document.getElementById('categoryId').value;
  const data = {
    name: document.getElementById('categoryName').value,
    color: document.getElementById('categoryColor').value
  };

  if (!data.name) {
    showToast('Please enter a category name', 'error');
    return;
  }

  if (id) {
    const category = state.categories.find(c => c.id === id);
    if (category) {
      Object.assign(category, data);
      saveState();
    }
    showToast('Category updated', 'success');
  } else {
    createCategory(data);
    showToast('Category created', 'success');
  }

  closeCategoryModal();
  renderCategoriesList();
}

// Edit project
function editProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  document.getElementById('projectId').value = project.id;
  document.getElementById('projectName').value = project.name;
  document.getElementById('projectDescription').value = project.description || '';
  document.getElementById('projectStartDate').value = project.start_date || '';
  document.getElementById('projectDueDate').value = project.due_date || '';
  document.getElementById('projectModal').classList.add('active');
}

// Delete project
function deleteProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  if (!confirm(`Delete project "${project.name}"? Tasks will be unassigned but not deleted.`)) return;

  // Unassign tasks from this project
  state.tasks.forEach(task => {
    if (task.project_id === projectId) {
      task.project_id = null;
      task.updated_at = new Date().toISOString();
    }
  });

  // Remove project
  state.projects = state.projects.filter(p => p.id !== projectId);
  saveState();

  // If viewing this project, go to inbox
  if (currentView === `project-${projectId}`) {
    setActiveView('inbox');
  }

  renderProjectsList();
  renderMobileProjectsList();
  showToast('Project deleted', 'success');
}

// Edit category
function editCategory(categoryId) {
  const category = state.categories.find(c => c.id === categoryId);
  if (!category) return;

  document.getElementById('categoryId').value = category.id;
  document.getElementById('categoryName').value = category.name;
  document.getElementById('categoryColor').value = category.color || '#6366f1';
  document.getElementById('categoryModal').classList.add('active');
}

// Delete category
function deleteCategory(categoryId) {
  const category = state.categories.find(c => c.id === categoryId);
  if (!category) return;

  if (!confirm(`Delete category "${category.name}"? Tasks will be unassigned but not deleted.`)) return;

  // Unassign tasks from this category
  state.tasks.forEach(task => {
    if (task.category_id === categoryId) {
      task.category_id = null;
      task.updated_at = new Date().toISOString();
    }
  });

  // Remove category
  state.categories = state.categories.filter(c => c.id !== categoryId);
  saveState();

  // If viewing this category, go to inbox
  if (currentView === `category-${categoryId}`) {
    setActiveView('inbox');
  }

  renderCategoriesList();
  renderMobileCategoriesList();
  showToast('Category deleted', 'success');
}

function showStatsModal() {
  document.getElementById('statsModal').classList.add('active');

  // Update stats
  document.getElementById('statTotalTasks').textContent = state.profile.total_tasks_completed;
  document.getElementById('statLongestStreak').textContent = state.profile.longest_streak;

  // On-time completions
  const onTimeTasks = state.tasks.filter(t => t.is_completed && t.was_on_time).length;
  document.getElementById('statOnTime').textContent = onTimeTasks;

  // Week XP
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekXP = state.daily_stats
    .filter(s => new Date(s.date) >= weekAgo)
    .reduce((sum, s) => sum + (s.xp_earned || 0), 0);
  document.getElementById('statWeekXP').textContent = weekXP;

  // Achievements
  const unlockedCount = state.profile.achievements.length;
  const totalCount = ACHIEVEMENTS.length;
  document.getElementById('achievementProgress').textContent = `${unlockedCount}/${totalCount}`;

  const container = document.getElementById('achievementsList');
  container.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = state.profile.achievements.includes(a.id);
    return `
      <div class="achievement-badge ${unlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${unlocked ? '🏆' : '🔒'}</div>
        <div class="achievement-info">
          <div class="achievement-name">${a.name}</div>
          <div class="achievement-desc">${a.description}</div>
        </div>
        <div class="achievement-xp">+${a.xp} XP</div>
      </div>
    `;
  }).join('');
}

function closeStatsModal() {
  document.getElementById('statsModal').classList.remove('active');
}

// XP Preview
function setupXPPreview() {
  const inputs = ['taskTier', 'taskDifficulty', 'taskDueDate'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateXPPreview);
  });
}

function updateXPPreview() {
  const task = {
    tier: document.getElementById('taskTier').value,
    difficulty: document.getElementById('taskDifficulty').value,
    due_date: document.getElementById('taskDueDate').value
  };

  const xp = Gamification.calculateXPPreview(task, state.profile.current_streak);
  const xpPreview = document.getElementById('xpPreview');
  if (xpPreview) xpPreview.textContent = Gamification.formatXP(xp);
}

// ============================================
// TOASTS
// ============================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</div>
    <div class="toast-content">
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showAchievementToast(achievement) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast achievement';
  toast.innerHTML = `
    <div class="toast-icon">🏆</div>
    <div class="toast-content">
      <div class="toast-title">Achievement Unlocked!</div>
      <div class="toast-message">${achievement.name} - +${achievement.xp} XP</div>
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================
// UTILITY
// ============================================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// RENDER ALL
// ============================================

function renderAll() {
  renderTasks();
  renderProjectsList();
  renderCategoriesList();
  updateProjectSelect();
  updateCategorySelect();
  updateTaskCounts();
  updateUserDisplay();
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

let selectedTaskIndex = -1;
let commandPaletteSelectedIndex = 0;

const commands = [
  { id: 'go-inbox', title: 'Go to Inbox', description: 'View all tasks', icon: '📥', shortcut: ['1', 'I'], category: 'Navigation', action: () => setActiveView('inbox') },
  { id: 'go-today', title: 'Go to Today', description: 'Tasks due today', icon: '📅', shortcut: ['2', 'T'], category: 'Navigation', action: () => setActiveView('today') },
  { id: 'go-upcoming', title: 'Go to Upcoming', description: 'Future tasks', icon: '📆', shortcut: ['3', 'U'], category: 'Navigation', action: () => setActiveView('upcoming') },
  { id: 'go-completed', title: 'Go to Completed', description: 'Finished tasks', icon: '✅', shortcut: ['4', 'D'], category: 'Navigation', action: () => setActiveView('completed') },
  { id: 'go-stats', title: 'Go to Stats', description: 'View achievements', icon: '📊', shortcut: ['5', 'S'], category: 'Navigation', action: () => showStatsModal() },
  { id: 'quick-add', title: 'Quick Add Task', description: 'Focus quick add input', icon: '✨', shortcut: ['N'], category: 'Create', action: () => focusQuickAdd() },
  { id: 'new-task', title: 'Full Task Modal', description: 'Open task form', icon: '➕', shortcut: ['A'], category: 'Create', action: () => showTaskModal() },
  { id: 'new-project', title: 'New Project', description: 'Create a new project', icon: '📁', shortcut: ['P'], category: 'Create', action: () => showProjectModal() },
  { id: 'new-category', title: 'New Category', description: 'Create a new category', icon: '🏷️', shortcut: ['C'], category: 'Create', action: () => showCategoryModal() },
  { id: 'show-shortcuts', title: 'Keyboard Shortcuts', description: 'Show all shortcuts', icon: '⌨️', shortcut: ['?'], category: 'Help', action: () => showShortcutsModal() },
];

function isInputFocused() {
  const activeElement = document.activeElement;
  const tagName = activeElement?.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeElement?.isContentEditable;
}

function isModalOpen() {
  return document.querySelector('.modal-overlay.active') !== null;
}

function isCommandPaletteOpen() {
  return document.getElementById('commandPalette')?.classList.contains('active');
}

function getTaskCards() {
  return Array.from(document.querySelectorAll('.task-card'));
}

function updateTaskSelection() {
  const taskCards = getTaskCards();
  taskCards.forEach((card, index) => {
    card.classList.toggle('keyboard-selected', index === selectedTaskIndex);
  });

  if (selectedTaskIndex >= 0 && taskCards[selectedTaskIndex]) {
    taskCards[selectedTaskIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function selectNextTask() {
  const taskCards = getTaskCards();
  if (taskCards.length === 0) return;
  selectedTaskIndex = Math.min(selectedTaskIndex + 1, taskCards.length - 1);
  if (selectedTaskIndex < 0) selectedTaskIndex = 0;
  updateTaskSelection();
}

function selectPreviousTask() {
  const taskCards = getTaskCards();
  if (taskCards.length === 0) return;
  if (selectedTaskIndex < 0) selectedTaskIndex = 0;
  else selectedTaskIndex = Math.max(selectedTaskIndex - 1, 0);
  updateTaskSelection();
}

function getSelectedTask() {
  const taskCards = getTaskCards();
  if (selectedTaskIndex < 0 || selectedTaskIndex >= taskCards.length) return null;
  const taskId = taskCards[selectedTaskIndex]?.dataset.id;
  return state.tasks.find(t => t.id === taskId);
}

function showCommandPalette() {
  const palette = document.getElementById('commandPalette');
  const input = document.getElementById('commandPaletteInput');
  palette.classList.add('active');
  input.value = '';
  input.focus();
  commandPaletteSelectedIndex = 0;
  renderCommandPalette('');
}

function closeCommandPalette() {
  document.getElementById('commandPalette').classList.remove('active');
}

function renderCommandPalette(query) {
  const list = document.getElementById('commandPaletteList');
  const lowerQuery = query.toLowerCase();

  const filteredCommands = commands.filter(cmd =>
    cmd.title.toLowerCase().includes(lowerQuery) ||
    cmd.description.toLowerCase().includes(lowerQuery) ||
    cmd.category.toLowerCase().includes(lowerQuery)
  );

  if (filteredCommands.length === 0) {
    list.innerHTML = `
      <div class="command-palette-empty">
        <div class="command-palette-empty-icon">🔍</div>
        <div>No commands found</div>
      </div>
    `;
    return;
  }

  const grouped = {};
  filteredCommands.forEach(cmd => {
    if (!grouped[cmd.category]) grouped[cmd.category] = [];
    grouped[cmd.category].push(cmd);
  });

  let html = '';
  let globalIndex = 0;

  Object.entries(grouped).forEach(([category, cmds]) => {
    html += `<div class="command-palette-section">
      <div class="command-palette-section-title">${category}</div>`;

    cmds.forEach(cmd => {
      const isSelected = globalIndex === commandPaletteSelectedIndex;
      const shortcutHtml = cmd.shortcut.map(k => `<span class="kbd">${k}</span>`).join('');

      html += `
        <div class="command-palette-item ${isSelected ? 'selected' : ''}"
             data-command-id="${cmd.id}"
             data-index="${globalIndex}">
          <div class="command-item-icon">${cmd.icon}</div>
          <div class="command-item-content">
            <div class="command-item-title">${cmd.title}</div>
            <div class="command-item-description">${cmd.description}</div>
          </div>
          <div class="command-item-shortcut">${shortcutHtml}</div>
        </div>
      `;
      globalIndex++;
    });

    html += '</div>';
  });

  list.innerHTML = html;

  list.querySelectorAll('.command-palette-item').forEach(item => {
    item.addEventListener('click', () => {
      executeCommand(item.dataset.commandId);
    });
    item.addEventListener('mouseenter', () => {
      commandPaletteSelectedIndex = parseInt(item.dataset.index);
      renderCommandPalette(document.getElementById('commandPaletteInput').value);
    });
  });
}

function executeCommand(commandId) {
  const command = commands.find(c => c.id === commandId);
  if (command) {
    closeCommandPalette();
    command.action();
  }
}

function handleCommandPaletteKeydown(e) {
  const input = document.getElementById('commandPaletteInput');
  const query = input.value.toLowerCase();
  const filteredCommands = commands.filter(cmd =>
    cmd.title.toLowerCase().includes(query) ||
    cmd.description.toLowerCase().includes(query) ||
    cmd.category.toLowerCase().includes(query)
  );

  if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
    e.preventDefault();
    commandPaletteSelectedIndex = Math.min(commandPaletteSelectedIndex + 1, filteredCommands.length - 1);
    renderCommandPalette(input.value);
    scrollCommandItemIntoView();
  } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
    e.preventDefault();
    commandPaletteSelectedIndex = Math.max(commandPaletteSelectedIndex - 1, 0);
    renderCommandPalette(input.value);
    scrollCommandItemIntoView();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCommands[commandPaletteSelectedIndex]) {
      executeCommand(filteredCommands[commandPaletteSelectedIndex].id);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      commandPaletteSelectedIndex = commandPaletteSelectedIndex <= 0 ? filteredCommands.length - 1 : commandPaletteSelectedIndex - 1;
    } else {
      commandPaletteSelectedIndex = commandPaletteSelectedIndex >= filteredCommands.length - 1 ? 0 : commandPaletteSelectedIndex + 1;
    }
    renderCommandPalette(input.value);
    scrollCommandItemIntoView();
  }
}

function scrollCommandItemIntoView() {
  setTimeout(() => {
    const selected = document.querySelector('.command-palette-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 0);
}

function showShortcutsModal() {
  document.getElementById('shortcutsModal').classList.add('active');
}

function closeShortcutsModal() {
  document.getElementById('shortcutsModal').classList.remove('active');
}

function handleKeydown(e) {
  const key = e.key.toLowerCase();
  const isMeta = e.metaKey || e.ctrlKey;

  if (isCommandPaletteOpen()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    return;
  }

  if (isMeta && key === 'k') {
    e.preventDefault();
    showCommandPalette();
    return;
  }

  if (isMeta && e.key === 'Enter') {
    if (document.getElementById('taskModal').classList.contains('active')) {
      e.preventDefault();
      saveTask();
      return;
    }
    if (document.getElementById('projectModal').classList.contains('active')) {
      e.preventDefault();
      saveProject();
      return;
    }
    if (document.getElementById('categoryModal').classList.contains('active')) {
      e.preventDefault();
      saveCategory();
      return;
    }
  }

  if (e.key === 'Escape') {
    closeTaskModal();
    closeProjectModal();
    closeCategoryModal();
    closeStatsModal();
    closeShortcutsModal();
    selectedTaskIndex = -1;
    updateTaskSelection();
    return;
  }

  if (isInputFocused()) return;
  if (isModalOpen()) return;

  switch (key) {
    case '1':
    case 'i':
      e.preventDefault();
      setActiveView('inbox');
      break;
    case '2':
    case 't':
      e.preventDefault();
      setActiveView('today');
      break;
    case '3':
    case 'u':
      e.preventDefault();
      setActiveView('upcoming');
      break;
    case '4':
    case 'd':
      e.preventDefault();
      setActiveView('completed');
      break;
    case '5':
    case 's':
      e.preventDefault();
      showStatsModal();
      break;
    case 'n':
      e.preventDefault();
      focusQuickAdd();
      break;
    case 'a':
      e.preventDefault();
      showTaskModal();
      break;
    case 'p':
      e.preventDefault();
      showProjectModal();
      break;
    case 'c':
      e.preventDefault();
      showCategoryModal();
      break;
    case '?':
      e.preventDefault();
      showShortcutsModal();
      break;
    case 'j':
    case 'arrowdown':
      e.preventDefault();
      selectNextTask();
      break;
    case 'k':
    case 'arrowup':
      e.preventDefault();
      selectPreviousTask();
      break;
    case ' ':
      e.preventDefault();
      const taskToToggle = getSelectedTask();
      if (taskToToggle) toggleTaskComplete(taskToToggle.id, !taskToToggle.is_completed);
      break;
    case 'e':
      e.preventDefault();
      const taskToEdit = getSelectedTask();
      if (taskToEdit) editTask(taskToEdit.id);
      break;
    case 'backspace':
    case 'delete':
      e.preventDefault();
      const taskToDelete = getSelectedTask();
      if (taskToDelete) deleteTask(taskToDelete.id);
      break;
  }
}

// ============================================
// QUICK ADD
// ============================================

function parseQuickAddInput(text) {
  let title = text;
  const result = {
    title: '',
    project_id: null,
    category_id: null,
    priority: null,
    difficulty: 'medium',
    tier: 'tier3',
    due_date: null
  };

  // Parse @project
  const projectMatch = title.match(/@(\S+)/);
  if (projectMatch) {
    const projectName = projectMatch[1].toLowerCase().replace(/-/g, ' ');
    const project = state.projects.find(p =>
      p.name.toLowerCase() === projectName ||
      p.name.toLowerCase().startsWith(projectName) ||
      p.name.toLowerCase().replace(/\s+/g, '-') === projectMatch[1].toLowerCase()
    );
    if (project) result.project_id = project.id;
    title = title.replace(/@\S+/, '').trim();
  }

  // Parse #category
  const categoryMatch = title.match(/#(\S+)/);
  if (categoryMatch) {
    const categoryName = categoryMatch[1].toLowerCase().replace(/-/g, ' ');
    const category = state.categories.find(c =>
      c.name.toLowerCase() === categoryName ||
      c.name.toLowerCase().startsWith(categoryName) ||
      c.name.toLowerCase().replace(/\s+/g, '-') === categoryMatch[1].toLowerCase()
    );
    if (category) result.category_id = category.id;
    title = title.replace(/#\S+/, '').trim();
  }

  // Parse !priority
  const priorityMatch = title.match(/!(\S+)/);
  if (priorityMatch) {
    const p = priorityMatch[1].toLowerCase();
    if (p === 'high' || p === '1' || p === 'h') result.priority = 'High';
    else if (p === 'medium' || p === '2' || p === 'm' || p === 'med') result.priority = 'Medium';
    else if (p === 'low' || p === '3' || p === 'l') result.priority = 'Low';
    title = title.replace(/!\S+/, '').trim();
  }

  // Parse ~difficulty
  const difficultyMatch = title.match(/~(\S+)/);
  if (difficultyMatch) {
    const d = difficultyMatch[1].toLowerCase();
    if (d === 'easy' || d === 'e' || d === '1') result.difficulty = 'easy';
    else if (d === 'medium' || d === 'm' || d === 'med' || d === '2') result.difficulty = 'medium';
    else if (d === 'hard' || d === 'h' || d === '3') result.difficulty = 'hard';
    else if (d === 'epic' || d === 'x' || d === '4') result.difficulty = 'epic';
    title = title.replace(/~\S+/, '').trim();
  }

  // Parse ^tier
  const tierMatch = title.match(/\^(\S+)/);
  if (tierMatch) {
    const t = tierMatch[1].toLowerCase();
    if (t === 'quick' || t === 'q' || t === '1' || t === 'small') result.tier = 'tier3';
    else if (t === 'standard' || t === 's' || t === '2' || t === 'std') result.tier = 'tier2';
    else if (t === 'major' || t === 'm' || t === '3' || t === 'big') result.tier = 'tier1';
    title = title.replace(/\^\S+/, '').trim();
  }

  // Parse due dates
  const dueDateResult = parseDueDate(title);
  if (dueDateResult.date) {
    result.due_date = dueDateResult.date;
    title = dueDateResult.remaining;
  }

  result.title = title.trim();
  return result;
}

function parseDueDate(text) {
  const now = new Date();
  let date = null;
  let remaining = text;

  if (/\btoday\b/i.test(text)) {
    date = new Date(now);
    date.setHours(23, 59, 0, 0);
    remaining = text.replace(/\btoday\b/i, '').trim();
  } else if (/\btomorrow\b/i.test(text) || /\btmr\b/i.test(text) || /\btmrw\b/i.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(23, 59, 0, 0);
    remaining = text.replace(/\b(tomorrow|tmr|tmrw)\b/i, '').trim();
  } else {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayAbbr = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    for (let i = 0; i < days.length; i++) {
      const regex = new RegExp(`\\b(${days[i]}|${dayAbbr[i]})\\b`, 'i');
      if (regex.test(text)) {
        date = new Date(now);
        const currentDay = date.getDay();
        let daysUntil = i - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        date.setDate(date.getDate() + daysUntil);
        date.setHours(23, 59, 0, 0);
        remaining = text.replace(regex, '').trim();
        break;
      }
    }
  }

  if (!date) {
    const inDaysMatch = text.match(/\bin\s+(\d+)\s*d(?:ays?)?\b/i);
    if (inDaysMatch) {
      date = new Date(now);
      date.setDate(date.getDate() + parseInt(inDaysMatch[1]));
      date.setHours(23, 59, 0, 0);
      remaining = text.replace(inDaysMatch[0], '').trim();
    }
  }

  if (!date && /\bnext\s*week\b/i.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 7);
    date.setHours(23, 59, 0, 0);
    remaining = text.replace(/\bnext\s*week\b/i, '').trim();
  }

  if (!date) {
    const slashMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (slashMatch) {
      const month = parseInt(slashMatch[1]) - 1;
      const day = parseInt(slashMatch[2]);
      date = new Date(now.getFullYear(), month, day, 23, 59, 0, 0);
      if (date < now) date.setFullYear(date.getFullYear() + 1);
      remaining = text.replace(slashMatch[0], '').trim();
    }
  }

  remaining = remaining.replace(/\s+/g, ' ').trim();

  return { date: date ? date.toISOString() : null, remaining };
}

function focusQuickAdd() {
  const input = document.getElementById('quickAddInput');
  if (input) {
    input.focus();
    input.placeholder = 'Task @project #category !priority ~difficulty today...';
  }
}

// Handle delete command from quick add
function handleDeleteCommand(target) {
  // Try to find a matching project
  const project = state.projects.find(p => p.name.toLowerCase() === target);
  if (project) {
    deleteProject(project.id);
    return;
  }

  // Try to find a matching category
  const category = state.categories.find(c => c.name.toLowerCase() === target);
  if (category) {
    deleteCategory(category.id);
    return;
  }

  // Try to find a matching task (incomplete tasks first, then completed)
  const task = state.tasks.find(t => t.title.toLowerCase() === target && !t.is_completed) ||
               state.tasks.find(t => t.title.toLowerCase() === target);
  if (task) {
    if (confirm(`Delete task "${task.title}"?`)) {
      state.tasks = state.tasks.filter(t => t.id !== task.id);
      saveState();
      renderTasks();
      updateTaskCounts();
      showToast('Task deleted', 'success');
    }
    return;
  }

  // Try partial matches if exact match not found
  const partialProject = state.projects.find(p => p.name.toLowerCase().includes(target));
  if (partialProject) {
    deleteProject(partialProject.id);
    return;
  }

  const partialCategory = state.categories.find(c => c.name.toLowerCase().includes(target));
  if (partialCategory) {
    deleteCategory(partialCategory.id);
    return;
  }

  const partialTask = state.tasks.find(t => t.title.toLowerCase().includes(target) && !t.is_completed) ||
                      state.tasks.find(t => t.title.toLowerCase().includes(target));
  if (partialTask) {
    if (confirm(`Delete task "${partialTask.title}"?`)) {
      state.tasks = state.tasks.filter(t => t.id !== partialTask.id);
      saveState();
      renderTasks();
      updateTaskCounts();
      showToast('Task deleted', 'success');
    }
    return;
  }

  showToast(`Nothing found matching "${target}"`, 'error');
}

function blurQuickAdd() {
  const input = document.getElementById('quickAddInput');
  if (input) {
    input.value = '';
    input.blur();
    input.placeholder = 'Press N to add a task...';
    hideQuickAddHints();
  }
}

function submitQuickAdd() {
  const input = document.getElementById('quickAddInput');
  const rawText = input?.value?.trim();

  if (!rawText) return;

  // Handle delete commands: del/kill [project/category/task name]
  const deleteMatch = rawText.match(/^(del|kill)\s+(.+)$/i);
  if (deleteMatch) {
    const target = deleteMatch[2].trim().toLowerCase();
    handleDeleteCommand(target);
    input.value = '';
    hideQuickAddHints();
    return;
  }

  const parsed = parseQuickAddInput(rawText);

  if (!parsed.title) {
    showToast('Please enter a task title', 'error');
    return;
  }

  createTask(parsed);

  input.value = '';
  hideQuickAddHints();

  let msg = 'Task created!';
  if (parsed.project_id) {
    const proj = state.projects.find(p => p.id === parsed.project_id);
    if (proj) msg += ` in ${proj.name}`;
  }
  if (parsed.due_date) {
    msg += ` due ${Gamification.formatDueDate(parsed.due_date)?.text || 'soon'}`;
  }

  showToast(msg, 'success');
  input.focus();
}

// Quick add autocomplete
let quickAddHintIndex = 0;

function showQuickAddHints(type, query) {
  let hints = [];
  const hintsContainer = document.getElementById('quickAddAutocomplete');

  if (type === 'project') {
    hints = state.projects.filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5).map(p => ({ label: p.name, value: `@${p.name.replace(/\s+/g, '-')}`, icon: '📁' }));
  } else if (type === 'category') {
    hints = state.categories.filter(c =>
      c.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5).map(c => ({ label: c.name, value: `#${c.name.replace(/\s+/g, '-')}`, icon: '🏷️', color: c.color }));
  } else if (type === 'priority') {
    hints = [
      { label: 'High', value: '!high', icon: '🔴' },
      { label: 'Medium', value: '!medium', icon: '🟡' },
      { label: 'Low', value: '!low', icon: '🟢' }
    ].filter(h => h.label.toLowerCase().includes(query.toLowerCase()));
  } else if (type === 'difficulty') {
    hints = [
      { label: 'Easy (1x)', value: '~easy', icon: '😊' },
      { label: 'Medium (1.5x)', value: '~medium', icon: '💪' },
      { label: 'Hard (2x)', value: '~hard', icon: '🔥' },
      { label: 'Epic (3x)', value: '~epic', icon: '⚡' }
    ].filter(h => h.label.toLowerCase().includes(query.toLowerCase()));
  } else if (type === 'tier') {
    hints = [
      { label: 'Quick (1x)', value: '^quick', icon: '⚡' },
      { label: 'Standard (2x)', value: '^standard', icon: '📋' },
      { label: 'Major (3x)', value: '^major', icon: '🎯' }
    ].filter(h => h.label.toLowerCase().includes(query.toLowerCase()));
  }

  if (hints.length === 0) {
    hideQuickAddHints();
    return;
  }

  hintsContainer.innerHTML = hints.map((h, i) => `
    <div class="quick-add-hint-item ${i === 0 ? 'selected' : ''}" data-value="${h.value}">
      <span class="quick-add-hint-icon" ${h.color ? `style="color: ${h.color}"` : ''}>${h.icon}</span>
      <span class="quick-add-hint-label">${h.label}</span>
      <span class="quick-add-hint-value">${h.value}</span>
    </div>
  `).join('');

  hintsContainer.classList.add('visible');

  hintsContainer.querySelectorAll('.quick-add-hint-item').forEach(item => {
    item.addEventListener('click', () => selectQuickAddHint(item.dataset.value));
  });
}

function hideQuickAddHints() {
  const hintsContainer = document.getElementById('quickAddAutocomplete');
  if (hintsContainer) {
    hintsContainer.classList.remove('visible');
    hintsContainer.innerHTML = '';
  }
}

function selectQuickAddHint(value) {
  const input = document.getElementById('quickAddInput');
  if (!input) return;

  const text = input.value;
  const lastTrigger = Math.max(
    text.lastIndexOf('@'),
    text.lastIndexOf('#'),
    text.lastIndexOf('!'),
    text.lastIndexOf('~'),
    text.lastIndexOf('^')
  );

  if (lastTrigger >= 0) {
    input.value = text.slice(0, lastTrigger) + value + ' ';
  }

  hideQuickAddHints();
  input.focus();
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Load theme first
  loadSavedTheme();

  // Load local state
  loadState();

  // Initialize Supabase (optional cloud sync)
  initSupabase();

  // Render everything
  renderAll();

  // Setup XP preview
  setupXPPreview();

  // Setup keyboard shortcuts
  document.addEventListener('keydown', handleKeydown);

  // Command palette input handler
  const commandPaletteInput = document.getElementById('commandPaletteInput');
  if (commandPaletteInput) {
    commandPaletteInput.addEventListener('input', (e) => {
      commandPaletteSelectedIndex = 0;
      renderCommandPalette(e.target.value);
    });
    commandPaletteInput.addEventListener('keydown', handleCommandPaletteKeydown);
  }

  // Close command palette on overlay click
  const commandPalette = document.getElementById('commandPalette');
  if (commandPalette) {
    commandPalette.addEventListener('click', (e) => {
      if (e.target.id === 'commandPalette') closeCommandPalette();
    });
  }

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });

  // Quick add input handlers
  const quickAddInput = document.getElementById('quickAddInput');
  if (quickAddInput) {
    quickAddInput.addEventListener('keydown', (e) => {
      const hintsContainer = document.getElementById('quickAddAutocomplete');
      const isHintsVisible = hintsContainer?.classList.contains('visible');

      if (isHintsVisible && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab')) {
        e.preventDefault();
        const items = hintsContainer.querySelectorAll('.quick-add-hint-item');
        if (items.length === 0) return;

        items[quickAddHintIndex]?.classList.remove('selected');

        if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
          quickAddHintIndex = (quickAddHintIndex + 1) % items.length;
        } else {
          quickAddHintIndex = (quickAddHintIndex - 1 + items.length) % items.length;
        }

        items[quickAddHintIndex]?.classList.add('selected');
        return;
      }

      if (isHintsVisible && e.key === 'Enter') {
        e.preventDefault();
        const selected = hintsContainer.querySelector('.quick-add-hint-item.selected');
        if (selected) selectQuickAddHint(selected.dataset.value);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitQuickAdd();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (isHintsVisible) {
          hideQuickAddHints();
        } else {
          blurQuickAdd();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        const parsed = parseQuickAddInput(quickAddInput.value?.trim() || '');
        blurQuickAdd();
        showTaskModal();
        if (parsed.title) document.getElementById('taskTitle').value = parsed.title;
        if (parsed.project_id) document.getElementById('taskProject').value = parsed.project_id;
        if (parsed.category_id) document.getElementById('taskCategory').value = parsed.category_id;
        if (parsed.priority) document.getElementById('taskPriority').value = parsed.priority;
        if (parsed.difficulty) document.getElementById('taskDifficulty').value = parsed.difficulty;
        if (parsed.tier) document.getElementById('taskTier').value = parsed.tier;
        if (parsed.due_date) document.getElementById('taskDueDate').value = parsed.due_date.slice(0, 16);
        updateXPPreview();
      }
    });

    quickAddInput.addEventListener('input', (e) => {
      const text = e.target.value;
      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = text.slice(0, cursorPos);

      const triggers = ['@', '#', '!', '~', '^'];
      let lastTriggerPos = -1;
      let lastTrigger = null;

      for (const trigger of triggers) {
        const pos = textBeforeCursor.lastIndexOf(trigger);
        if (pos > lastTriggerPos) {
          const afterTrigger = textBeforeCursor.slice(pos + 1);
          if (!afterTrigger.includes(' ')) {
            lastTriggerPos = pos;
            lastTrigger = trigger;
          }
        }
      }

      if (lastTrigger && lastTriggerPos >= 0) {
        const query = textBeforeCursor.slice(lastTriggerPos + 1);
        quickAddHintIndex = 0;

        switch (lastTrigger) {
          case '@': showQuickAddHints('project', query); break;
          case '#': showQuickAddHints('category', query); break;
          case '!': showQuickAddHints('priority', query); break;
          case '~': showQuickAddHints('difficulty', query); break;
          case '^': showQuickAddHints('tier', query); break;
        }
      } else {
        hideQuickAddHints();
      }
    });

    quickAddInput.addEventListener('focus', () => {
      quickAddInput.placeholder = 'Task @project #category !priority ~difficulty today...';
    });

    quickAddInput.addEventListener('blur', () => {
      if (!quickAddInput.value) {
        quickAddInput.placeholder = 'Press N to add a task...';
      }
      setTimeout(() => {
        if (document.activeElement !== quickAddInput) hideQuickAddHints();
      }, 150);
    });
  }
});

// ============================================
// MOBILE NAVIGATION
// ============================================

function mobileNavTo(view) {
  setActiveView(view);
  updateMobileNavActive(view);
}

function updateMobileNavActive(view) {
  // Update mobile nav buttons
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.view === view) {
      btn.classList.add('active');
    }
  });

  // For project views, highlight projects; for category views, highlight categories
  if (view.startsWith('project-')) {
    document.querySelector('.mobile-nav-item[data-view="projects"]')?.classList.add('active');
  } else if (view.startsWith('category-')) {
    document.querySelector('.mobile-nav-item[data-view="categories"]')?.classList.add('active');
  } else if (view === 'today' || view === 'upcoming' || view === 'completed') {
    document.querySelector('.mobile-nav-item[data-view="profile"]')?.classList.add('active');
  }
}

let activeMobilePanel = null;

function toggleMobilePanel(panelType) {
  if (activeMobilePanel === panelType) {
    closeMobilePanel();
  } else {
    openMobilePanel(panelType);
  }
}

function openMobilePanel(panelType) {
  const overlay = document.getElementById('mobilePanelOverlay');
  const panels = {
    projects: document.getElementById('mobileProjectsPanel'),
    categories: document.getElementById('mobileCategoriesPanel'),
    profile: document.getElementById('mobileProfilePanel')
  };

  // Close any open panel first
  Object.values(panels).forEach(p => p?.classList.remove('active'));

  // Update content based on panel type
  if (panelType === 'projects') {
    renderMobileProjectsList();
  } else if (panelType === 'categories') {
    renderMobileCategoriesList();
  } else if (panelType === 'profile') {
    updateMobileProfile();
    updateMobileAuthUI();
  }

  // Open the requested panel
  overlay.classList.add('active');
  panels[panelType]?.classList.add('active');
  activeMobilePanel = panelType;

  // Update nav active state
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.view === panelType) {
      btn.classList.add('active');
    }
  });

  // Prevent body scroll
  document.body.style.overflow = 'hidden';
}

function closeMobilePanel() {
  const overlay = document.getElementById('mobilePanelOverlay');
  const panels = document.querySelectorAll('.mobile-browse-panel');

  panels.forEach(p => p.classList.remove('active'));
  overlay.classList.remove('active');
  activeMobilePanel = null;

  // Restore inbox as active if no view is set
  updateMobileNavActive(currentView);

  // Restore body scroll
  document.body.style.overflow = '';
}

function renderMobileProjectsList() {
  const container = document.getElementById('mobileProjectsList');
  if (!container) return;

  if (state.projects.length === 0) {
    container.innerHTML = '<div class="mobile-browse-item" style="color: var(--text-tertiary); font-size: 13px;">No projects yet</div>';
    return;
  }

  container.innerHTML = state.projects.map(project => {
    const taskCount = state.tasks.filter(t => t.project_id === project.id && !t.is_completed).length;
    return `
      <div class="mobile-browse-item-row">
        <button class="mobile-browse-item" onclick="mobileNavTo('project-${project.id}'); closeMobilePanel()">
          <span class="mobile-browse-item-icon">📁</span>
          <span>${escapeHtml(project.name)}</span>
          <span class="mobile-browse-item-count">${taskCount}</span>
        </button>
        <div class="mobile-browse-item-actions">
          <button class="mobile-browse-action" onclick="event.stopPropagation(); editProject('${project.id}'); closeMobilePanel()" title="Edit">✏️</button>
          <button class="mobile-browse-action mobile-browse-action-delete" onclick="event.stopPropagation(); deleteProject('${project.id}')" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderMobileCategoriesList() {
  const container = document.getElementById('mobileCategoriesList');
  if (!container) return;

  if (state.categories.length === 0) {
    container.innerHTML = '<div class="mobile-browse-item" style="color: var(--text-tertiary); font-size: 13px;">No categories yet</div>';
    return;
  }

  container.innerHTML = state.categories.map(cat => {
    return `
      <div class="mobile-browse-item-row">
        <button class="mobile-browse-item" onclick="mobileNavTo('category-${cat.id}'); closeMobilePanel()">
          <span class="mobile-category-dot" style="background: ${cat.color}"></span>
          <span>${escapeHtml(cat.name)}</span>
        </button>
        <div class="mobile-browse-item-actions">
          <button class="mobile-browse-action" onclick="event.stopPropagation(); editCategory('${cat.id}'); closeMobilePanel()" title="Edit">✏️</button>
          <button class="mobile-browse-action mobile-browse-action-delete" onclick="event.stopPropagation(); deleteCategory('${cat.id}')" title="Delete">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateMobileProfile() {
  const level = document.getElementById('mobileLevelDisplay');
  const xp = document.getElementById('mobileXpDisplay');
  const xpNext = document.getElementById('mobileXpNextDisplay');
  const streak = document.getElementById('mobileStreakDisplay');
  const avatar = document.getElementById('mobileAvatarIcon');

  if (level) level.textContent = state.profile.level || 1;
  if (xp) xp.textContent = state.profile.xp || 0;
  if (xpNext) xpNext.textContent = state.profile.xp_to_next || 100;
  if (streak) streak.textContent = state.profile.current_streak || 0;

  if (avatar) {
    const rankInfo = getRankForLevel(state.profile.level || 1);
    avatar.textContent = rankInfo.icon;
  }
}

function updateMobileAuthUI() {
  const loginBtn = document.getElementById('mobile-login-btn');
  const userInfo = document.getElementById('mobile-user-info');

  if (currentUser) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.remove('hidden');
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.add('hidden');
  }
}
