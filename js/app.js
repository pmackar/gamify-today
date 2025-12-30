// gamify.today Main Application

// State
let currentUser = null;
let tasks = [];
let projects = [];
let categories = [];
let currentView = 'inbox';

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
  // Check authentication
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  try {
    const userData = JSON.parse(localStorage.getItem('user'));
    if (userData) {
      currentUser = userData;
      updateUserDisplay();
    }

    // Load data
    await Promise.all([
      loadTasks(),
      loadProjects(),
      loadCategories(),
      refreshUserData()
    ]);

    // Set up XP preview calculation
    setupXPPreview();

  } catch (error) {
    console.error('Init error:', error);
    showToast('Failed to load data', 'error');
  }
});

// Character ranks based on level
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

// User Display
function updateUserDisplay() {
  if (!currentUser) return;

  const level = currentUser.level || 1;
  const xp = currentUser.xp || 0;
  const xpToNext = currentUser.xpToNext || 100;
  const streak = currentUser.currentStreak || 0;

  // Update level badge
  document.getElementById('userLevel').textContent = level;

  // Update XP display
  document.getElementById('xpCurrent').textContent = xp;
  document.getElementById('xpToNext').textContent = xpToNext;

  // Update XP bar
  const xpPercent = Math.min((xp / xpToNext) * 100, 100);
  const xpBarFill = document.getElementById('xpBarFill');
  if (xpBarFill) {
    xpBarFill.style.width = `${xpPercent}%`;
  }

  // Update level ring progress (SVG circle)
  const levelRing = document.getElementById('levelRingProgress');
  if (levelRing) {
    const circumference = 2 * Math.PI * 45; // r=45
    const offset = circumference - (xpPercent / 100) * circumference;
    levelRing.style.strokeDashoffset = offset;
  }

  // Update character rank and icon
  const rankInfo = getRankForLevel(level);
  const rankEl = document.getElementById('characterRank');
  const avatarIcon = document.getElementById('avatarIcon');
  if (rankEl) rankEl.textContent = rankInfo.rank;
  if (avatarIcon) avatarIcon.textContent = rankInfo.icon;

  // Update streak
  document.getElementById('streakCount').textContent = streak;

  // Update tasks completed today
  updateTasksCompletedToday();
}

// Update tasks completed today count
async function updateTasksCompletedToday() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const data = await api.getTasks({ is_completed: 'true' });
    const todayTasks = data.tasks.filter(t => {
      const completedDate = new Date(t.completed_at || t.updated_at);
      return completedDate >= today;
    });
    const countEl = document.getElementById('tasksCompletedToday');
    if (countEl) countEl.textContent = todayTasks.length;
  } catch (error) {
    console.error('Failed to get tasks completed today:', error);
  }
}

// Trigger level up animation
function triggerLevelUpAnimation() {
  const avatar = document.getElementById('characterAvatar');
  if (avatar) {
    avatar.classList.add('level-up');
    setTimeout(() => avatar.classList.remove('level-up'), 1000);
  }
}

async function refreshUserData() {
  try {
    const data = await api.getMe();
    currentUser = data.user;
    localStorage.setItem('user', JSON.stringify(currentUser));
    updateUserDisplay();
  } catch (error) {
    console.error('Failed to refresh user data:', error);
  }
}

// Tasks
async function loadTasks() {
  try {
    const filters = {};

    if (currentView === 'today') {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      filters.due_before = today.toISOString();
      filters.is_completed = 'false';
    } else if (currentView === 'upcoming') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      filters.due_after = tomorrow.toISOString();
      filters.is_completed = 'false';
    } else if (currentView === 'completed') {
      filters.is_completed = 'true';
    } else if (currentView.startsWith('project-')) {
      filters.project_id = currentView.replace('project-', '');
    } else if (currentView.startsWith('category-')) {
      filters.category_id = currentView.replace('category-', '');
    }

    const data = await api.getTasks(filters);
    tasks = data.tasks;
    renderTasks();
    updateTaskCounts();
  } catch (error) {
    console.error('Failed to load tasks:', error);
    showToast('Failed to load tasks', 'error');
  }
}

function renderTasks() {
  const container = document.getElementById('taskList');
  const emptyState = document.getElementById('emptyState');

  if (tasks.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  container.innerHTML = tasks.map(task => {
    const priorityClass = task.priority ? `priority-${task.priority.toLowerCase()}` : '';
    const completedClass = task.is_completed ? 'completed' : '';
    const dueInfo = Gamification.formatDueDate(task.due_date);
    const tierInfo = Gamification.getTierInfo(task.tier);

    return `
      <div class="task-card ${priorityClass} ${completedClass}" data-id="${task.id}">
        <div class="task-checkbox ${task.is_completed ? 'checked' : ''}"
             onclick="toggleTaskComplete('${task.id}', ${!task.is_completed})"></div>
        <div class="task-content" onclick="editTask('${task.id}')">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            ${task.project_name ? `<span>📁 ${escapeHtml(task.project_name)}</span>` : ''}
            ${dueInfo ? `<span class="task-due ${dueInfo.class}">📅 ${dueInfo.text}</span>` : ''}
            <span class="tier-badge ${task.tier}">${tierInfo.name}</span>
            ${!task.is_completed ? `<span class="task-xp">${Gamification.formatXP(task.xp_preview || task.xp_earned)}</span>` : ''}
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

async function toggleTaskComplete(taskId, complete) {
  try {
    if (complete) {
      const result = await api.completeTask(taskId);

      // Show XP toast
      const gam = result.gamification;
      showToast(`+${gam.earnedXP} XP earned!`, 'success');

      // Check for new achievements
      if (gam.newAchievements && gam.newAchievements.length > 0) {
        gam.newAchievements.forEach(achievement => {
          setTimeout(() => {
            showAchievementToast(achievement);
          }, 500);
        });
      }

      // Check for level up
      if (gam.level > currentUser.level) {
        Gamification.createConfetti();
        triggerLevelUpAnimation();
        showToast(`Level Up! You're now level ${gam.level}!`, 'success');
      }

      // Update user data
      currentUser.level = gam.level;
      currentUser.xp = gam.totalXP;
      currentUser.xpToNext = gam.xpToNext;
      currentUser.currentStreak = gam.streak;
      currentUser.longestStreak = gam.longestStreak;
      currentUser.totalTasksCompleted++;
      localStorage.setItem('user', JSON.stringify(currentUser));
      updateUserDisplay();
    } else {
      await api.uncompleteTask(taskId);
    }

    await loadTasks();
  } catch (error) {
    console.error('Failed to update task:', error);
    showToast('Failed to update task', 'error');
  }
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;

  try {
    await api.deleteTask(taskId);
    await loadTasks();
    showToast('Task deleted', 'success');
  } catch (error) {
    console.error('Failed to delete task:', error);
    showToast('Failed to delete task', 'error');
  }
}

function updateTaskCounts() {
  // Count incomplete tasks for inbox
  api.getTasks({ is_completed: 'false' }).then(data => {
    document.getElementById('inboxCount').textContent = data.tasks.length;
  });

  // Count today's tasks
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  api.getTasks({ due_before: today.toISOString(), is_completed: 'false' }).then(data => {
    document.getElementById('todayCount').textContent = data.tasks.length;
  });
}

// Projects
async function loadProjects() {
  try {
    const data = await api.getProjects();
    projects = data.projects;
    renderProjectsList();
    updateProjectSelect();
  } catch (error) {
    console.error('Failed to load projects:', error);
  }
}

function renderProjectsList() {
  const container = document.getElementById('projectsList');
  container.innerHTML = projects.map(project => `
    <div class="nav-item ${currentView === 'project-' + project.id ? 'active' : ''}"
         data-view="project-${project.id}"
         onclick="setActiveView('project-${project.id}')">
      <span class="nav-item-icon">📁</span>
      <span class="truncate">${escapeHtml(project.name)}</span>
      <span class="nav-item-count">${project.task_count || 0}</span>
    </div>
  `).join('');
}

function updateProjectSelect() {
  const select = document.getElementById('taskProject');
  select.innerHTML = '<option value="">None</option>' +
    projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

// Categories
async function loadCategories() {
  try {
    const data = await api.getCategories();
    categories = data.categories;
    renderCategoriesList();
    updateCategorySelect();
  } catch (error) {
    console.error('Failed to load categories:', error);
  }
}

function renderCategoriesList() {
  const container = document.getElementById('categoriesList');
  container.innerHTML = categories.map(cat => `
    <div class="nav-item ${currentView === 'category-' + cat.id ? 'active' : ''}"
         data-view="category-${cat.id}"
         onclick="setActiveView('category-${cat.id}')">
      <span class="category-dot" style="background: ${cat.color}"></span>
      <span class="truncate">${escapeHtml(cat.name)}</span>
    </div>
  `).join('');
}

function updateCategorySelect() {
  const select = document.getElementById('taskCategory');
  select.innerHTML = '<option value="">None</option>' +
    categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// View Management
function setActiveView(view) {
  currentView = view;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.view === view) {
      item.classList.add('active');
    }
  });

  // Update title
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
    const project = projects.find(p => p.id === view.replace('project-', ''));
    if (project) {
      document.getElementById('viewTitle').textContent = project.name;
      document.getElementById('viewSubtitle').textContent = 'Project tasks';
    }
  } else if (view.startsWith('category-')) {
    const category = categories.find(c => c.id === view.replace('category-', ''));
    if (category) {
      document.getElementById('viewTitle').textContent = category.name;
      document.getElementById('viewSubtitle').textContent = 'Category tasks';
    }
  }

  loadTasks();
}

// Modals
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

async function saveTask() {
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

  try {
    if (id) {
      await api.updateTask(id, data);
      showToast('Task updated', 'success');
    } else {
      await api.createTask(data);
      showToast('Task created', 'success');
    }
    closeTaskModal();
    await loadTasks();
  } catch (error) {
    console.error('Failed to save task:', error);
    showToast(error.message || 'Failed to save task', 'error');
  }
}

async function editTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
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

async function saveProject() {
  const id = document.getElementById('projectId').value;
  const data = {
    name: document.getElementById('projectName').value,
    description: document.getElementById('projectDescription').value || null,
    start_date: document.getElementById('projectStartDate').value || null,
    due_date: document.getElementById('projectDueDate').value || null
  };

  try {
    if (id) {
      await api.updateProject(id, data);
      showToast('Project updated', 'success');
    } else {
      await api.createProject(data);
      showToast('Project created', 'success');
    }
    closeProjectModal();
    await loadProjects();
  } catch (error) {
    console.error('Failed to save project:', error);
    showToast(error.message || 'Failed to save project', 'error');
  }
}

function showCategoryModal() {
  document.getElementById('categoryModal').classList.add('active');
  document.getElementById('categoryForm').reset();
  document.getElementById('categoryId').value = '';
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('active');
}

async function saveCategory() {
  const id = document.getElementById('categoryId').value;
  const data = {
    name: document.getElementById('categoryName').value,
    color: document.getElementById('categoryColor').value
  };

  try {
    if (id) {
      await api.updateCategory(id, data);
      showToast('Category updated', 'success');
    } else {
      await api.createCategory(data);
      showToast('Category created', 'success');
    }
    closeCategoryModal();
    await loadCategories();
  } catch (error) {
    console.error('Failed to save category:', error);
    showToast(error.message || 'Failed to save category', 'error');
  }
}

async function showStatsModal() {
  document.getElementById('statsModal').classList.add('active');

  try {
    const [statsData, achievementsData] = await Promise.all([
      api.getStatsSummary(),
      api.getAchievements()
    ]);

    // Update stats
    document.getElementById('statTotalTasks').textContent = statsData.user.totalTasksCompleted;
    document.getElementById('statLongestStreak').textContent = statsData.user.longestStreak;
    document.getElementById('statOnTime').textContent = statsData.tasks.onTime;
    document.getElementById('statWeekXP').textContent = statsData.thisWeek.xpEarned;

    // Update achievements
    document.getElementById('achievementProgress').textContent = achievementsData.progress;

    const container = document.getElementById('achievementsList');
    container.innerHTML = achievementsData.achievements.map(a => `
      <div class="achievement-badge ${a.unlocked ? 'unlocked' : 'locked'}">
        <div class="achievement-icon">${a.unlocked ? '🏆' : '🔒'}</div>
        <div class="achievement-info">
          <div class="achievement-name">${a.name}</div>
          <div class="achievement-desc">${a.description}</div>
        </div>
        <div class="achievement-xp">+${a.xp} XP</div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load stats:', error);
    showToast('Failed to load stats', 'error');
  }
}

function closeStatsModal() {
  document.getElementById('statsModal').classList.remove('active');
}

// XP Preview
function setupXPPreview() {
  const inputs = ['taskTier', 'taskDifficulty', 'taskDueDate'];
  inputs.forEach(id => {
    document.getElementById(id).addEventListener('change', updateXPPreview);
  });
}

function updateXPPreview() {
  const task = {
    tier: document.getElementById('taskTier').value,
    difficulty: document.getElementById('taskDifficulty').value,
    due_date: document.getElementById('taskDueDate').value
  };

  const xp = Gamification.calculateXPPreview(task, currentUser?.currentStreak || 0);
  document.getElementById('xpPreview').textContent = Gamification.formatXP(xp);
}

// Toasts
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

// Utility
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

// ========================================
// Keyboard Shortcuts System
// ========================================

// Keyboard state
let pendingKey = null;
let pendingKeyTimeout = null;
let selectedTaskIndex = -1;
let commandPaletteSelectedIndex = 0;

// Command definitions for palette
const commands = [
  // Navigation
  { id: 'go-inbox', title: 'Go to Inbox', description: 'View all tasks', icon: '📥', shortcut: ['G', 'I'], category: 'Navigation', action: () => setActiveView('inbox') },
  { id: 'go-today', title: 'Go to Today', description: 'Tasks due today', icon: '📅', shortcut: ['G', 'T'], category: 'Navigation', action: () => setActiveView('today') },
  { id: 'go-upcoming', title: 'Go to Upcoming', description: 'Future tasks', icon: '📆', shortcut: ['G', 'U'], category: 'Navigation', action: () => setActiveView('upcoming') },
  { id: 'go-completed', title: 'Go to Completed', description: 'Finished tasks', icon: '✅', shortcut: ['G', 'D'], category: 'Navigation', action: () => setActiveView('completed') },
  { id: 'go-stats', title: 'Go to Stats', description: 'View achievements', icon: '📊', shortcut: ['G', 'S'], category: 'Navigation', action: () => showStatsModal() },

  // Create
  { id: 'new-task', title: 'New Task', description: 'Create a new task', icon: '➕', shortcut: ['N'], category: 'Create', action: () => showTaskModal() },
  { id: 'new-project', title: 'New Project', description: 'Create a new project', icon: '📁', shortcut: ['C', 'P'], category: 'Create', action: () => showProjectModal() },
  { id: 'new-category', title: 'New Category', description: 'Create a new category', icon: '🏷️', shortcut: ['C', 'C'], category: 'Create', action: () => showCategoryModal() },

  // Actions
  { id: 'show-shortcuts', title: 'Keyboard Shortcuts', description: 'Show all shortcuts', icon: '⌨️', shortcut: ['?'], category: 'Help', action: () => showShortcutsModal() },
];

// Check if focus is on an input element
function isInputFocused() {
  const activeElement = document.activeElement;
  const tagName = activeElement?.tagName?.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeElement?.isContentEditable;
}

// Check if any modal is open
function isModalOpen() {
  return document.querySelector('.modal-overlay.active') !== null;
}

// Check if command palette is open
function isCommandPaletteOpen() {
  return document.getElementById('commandPalette')?.classList.contains('active');
}

// Show pending key indicator
function showPendingKey(key) {
  const indicator = document.getElementById('pendingKeyIndicator');
  const display = document.getElementById('pendingKeyDisplay');
  display.textContent = key.toUpperCase();
  indicator.classList.add('visible');
}

// Hide pending key indicator
function hidePendingKey() {
  const indicator = document.getElementById('pendingKeyIndicator');
  indicator.classList.remove('visible');
}

// Clear pending key state
function clearPendingKey() {
  pendingKey = null;
  if (pendingKeyTimeout) {
    clearTimeout(pendingKeyTimeout);
    pendingKeyTimeout = null;
  }
  hidePendingKey();
}

// Get visible task cards
function getTaskCards() {
  return Array.from(document.querySelectorAll('.task-card'));
}

// Update task selection UI
function updateTaskSelection() {
  const taskCards = getTaskCards();
  taskCards.forEach((card, index) => {
    card.classList.toggle('keyboard-selected', index === selectedTaskIndex);
  });

  // Scroll selected task into view
  if (selectedTaskIndex >= 0 && taskCards[selectedTaskIndex]) {
    taskCards[selectedTaskIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Select next task
function selectNextTask() {
  const taskCards = getTaskCards();
  if (taskCards.length === 0) return;

  selectedTaskIndex = Math.min(selectedTaskIndex + 1, taskCards.length - 1);
  if (selectedTaskIndex < 0) selectedTaskIndex = 0;
  updateTaskSelection();
}

// Select previous task
function selectPreviousTask() {
  const taskCards = getTaskCards();
  if (taskCards.length === 0) return;

  if (selectedTaskIndex < 0) selectedTaskIndex = 0;
  else selectedTaskIndex = Math.max(selectedTaskIndex - 1, 0);
  updateTaskSelection();
}

// Get selected task
function getSelectedTask() {
  const taskCards = getTaskCards();
  if (selectedTaskIndex < 0 || selectedTaskIndex >= taskCards.length) return null;

  const taskId = taskCards[selectedTaskIndex]?.dataset.id;
  return tasks.find(t => t.id === taskId);
}

// Command Palette
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

  // Filter commands
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

  // Group by category
  const grouped = {};
  filteredCommands.forEach(cmd => {
    if (!grouped[cmd.category]) grouped[cmd.category] = [];
    grouped[cmd.category].push(cmd);
  });

  // Render
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

  // Add click handlers
  list.querySelectorAll('.command-palette-item').forEach(item => {
    item.addEventListener('click', () => {
      const cmdId = item.dataset.commandId;
      executeCommand(cmdId);
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
    // Tab cycles through results
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

// Helper to scroll command palette item into view
function scrollCommandItemIntoView() {
  setTimeout(() => {
    const selected = document.querySelector('.command-palette-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, 0);
}

// Shortcuts Modal
function showShortcutsModal() {
  document.getElementById('shortcutsModal').classList.add('active');
}

function closeShortcutsModal() {
  document.getElementById('shortcutsModal').classList.remove('active');
}

// Main keyboard handler
function handleKeydown(e) {
  const key = e.key.toLowerCase();
  const isMeta = e.metaKey || e.ctrlKey;

  // Command palette is open - handle its own keys
  if (isCommandPaletteOpen()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    // Let the palette input handle other keys
    return;
  }

  // Cmd/Ctrl+K - Command Palette (works everywhere)
  if (isMeta && key === 'k') {
    e.preventDefault();
    showCommandPalette();
    return;
  }

  // Cmd/Ctrl+Enter - Save in modal
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

  // Escape - Close modals
  if (e.key === 'Escape') {
    closeTaskModal();
    closeProjectModal();
    closeCategoryModal();
    closeStatsModal();
    closeShortcutsModal();
    clearPendingKey();
    selectedTaskIndex = -1;
    updateTaskSelection();
    return;
  }

  // Don't process shortcuts when typing in inputs
  if (isInputFocused()) return;

  // Don't process shortcuts when modal is open (except escape which is handled above)
  if (isModalOpen()) return;

  // Handle pending key sequences
  if (pendingKey) {
    clearPendingKey();

    // G + key sequences (navigation)
    if (pendingKey === 'g') {
      switch (key) {
        case 'i': setActiveView('inbox'); break;
        case 't': setActiveView('today'); break;
        case 'u': setActiveView('upcoming'); break;
        case 'd': setActiveView('completed'); break;
        case 's': showStatsModal(); break;
      }
      return;
    }

    // C + key sequences (create)
    if (pendingKey === 'c') {
      switch (key) {
        case 'p': showProjectModal(); break;
        case 'c': showCategoryModal(); break;
      }
      return;
    }
    return;
  }

  // Start key sequences
  if (key === 'g' || key === 'c') {
    pendingKey = key;
    showPendingKey(key);
    pendingKeyTimeout = setTimeout(clearPendingKey, 1500);
    return;
  }

  // Single key shortcuts
  switch (key) {
    // New task - focus quick add input
    case 'n':
      e.preventDefault();
      focusQuickAdd();
      break;

    // Show shortcuts help
    case '?':
      e.preventDefault();
      showShortcutsModal();
      break;

    // Task navigation - vim style
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

    // Task actions (when task is selected)
    case ' ': // Space - toggle complete
      e.preventDefault();
      const taskToToggle = getSelectedTask();
      if (taskToToggle) {
        toggleTaskComplete(taskToToggle.id, !taskToToggle.is_completed);
      }
      break;

    case 'e': // Edit
      e.preventDefault();
      const taskToEdit = getSelectedTask();
      if (taskToEdit) {
        editTask(taskToEdit.id);
      }
      break;

    case 'backspace':
    case 'delete':
      e.preventDefault();
      const taskToDelete = getSelectedTask();
      if (taskToDelete) {
        deleteTask(taskToDelete.id);
      }
      break;
  }
}

// Initialize keyboard shortcuts
document.addEventListener('keydown', handleKeydown);

// Command palette input handler
document.getElementById('commandPaletteInput')?.addEventListener('input', (e) => {
  commandPaletteSelectedIndex = 0;
  renderCommandPalette(e.target.value);
});

document.getElementById('commandPaletteInput')?.addEventListener('keydown', handleCommandPaletteKeydown);

// Close command palette on overlay click
document.getElementById('commandPalette')?.addEventListener('click', (e) => {
  if (e.target.id === 'commandPalette') {
    closeCommandPalette();
  }
});

// Reset task selection when tasks change
const originalRenderTasks = renderTasks;
renderTasks = function() {
  originalRenderTasks();
  selectedTaskIndex = -1;
};

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
    }
  });
});

// ========================================
// Quick Add Floating Input with Natural Language
// ========================================

// Parse natural language input for task creation
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
    const project = projects.find(p =>
      p.name.toLowerCase() === projectName ||
      p.name.toLowerCase().startsWith(projectName) ||
      p.name.toLowerCase().replace(/\s+/g, '-') === projectMatch[1].toLowerCase()
    );
    if (project) {
      result.project_id = project.id;
    }
    title = title.replace(/@\S+/, '').trim();
  }

  // Parse #category
  const categoryMatch = title.match(/#(\S+)/);
  if (categoryMatch) {
    const categoryName = categoryMatch[1].toLowerCase().replace(/-/g, ' ');
    const category = categories.find(c =>
      c.name.toLowerCase() === categoryName ||
      c.name.toLowerCase().startsWith(categoryName) ||
      c.name.toLowerCase().replace(/\s+/g, '-') === categoryMatch[1].toLowerCase()
    );
    if (category) {
      result.category_id = category.id;
    }
    title = title.replace(/#\S+/, '').trim();
  }

  // Parse !priority (!high, !medium, !low, !1, !2, !3)
  const priorityMatch = title.match(/!(\S+)/);
  if (priorityMatch) {
    const p = priorityMatch[1].toLowerCase();
    if (p === 'high' || p === '1' || p === 'h') result.priority = 'High';
    else if (p === 'medium' || p === '2' || p === 'm' || p === 'med') result.priority = 'Medium';
    else if (p === 'low' || p === '3' || p === 'l') result.priority = 'Low';
    title = title.replace(/!\S+/, '').trim();
  }

  // Parse ~difficulty (~easy, ~medium, ~hard, ~epic)
  const difficultyMatch = title.match(/~(\S+)/);
  if (difficultyMatch) {
    const d = difficultyMatch[1].toLowerCase();
    if (d === 'easy' || d === 'e' || d === '1') result.difficulty = 'easy';
    else if (d === 'medium' || d === 'm' || d === 'med' || d === '2') result.difficulty = 'medium';
    else if (d === 'hard' || d === 'h' || d === '3') result.difficulty = 'hard';
    else if (d === 'epic' || d === 'x' || d === '4') result.difficulty = 'epic';
    title = title.replace(/~\S+/, '').trim();
  }

  // Parse ^tier (^quick, ^standard, ^major or ^1, ^2, ^3)
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

// Parse natural language due dates
function parseDueDate(text) {
  const now = new Date();
  let date = null;
  let remaining = text;

  // Today
  if (/\btoday\b/i.test(text)) {
    date = new Date(now);
    date.setHours(23, 59, 0, 0);
    remaining = text.replace(/\btoday\b/i, '').trim();
  }
  // Tomorrow
  else if (/\btomorrow\b/i.test(text) || /\btmr\b/i.test(text) || /\btmrw\b/i.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(23, 59, 0, 0);
    remaining = text.replace(/\b(tomorrow|tmr|tmrw)\b/i, '').trim();
  }
  // Day names (monday, tuesday, etc.)
  else {
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

  // "in X days"
  if (!date) {
    const inDaysMatch = text.match(/\bin\s+(\d+)\s*d(?:ays?)?\b/i);
    if (inDaysMatch) {
      date = new Date(now);
      date.setDate(date.getDate() + parseInt(inDaysMatch[1]));
      date.setHours(23, 59, 0, 0);
      remaining = text.replace(inDaysMatch[0], '').trim();
    }
  }

  // "next week"
  if (!date && /\bnext\s*week\b/i.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 7);
    date.setHours(23, 59, 0, 0);
    remaining = text.replace(/\bnext\s*week\b/i, '').trim();
  }

  // Specific date formats: 12/25, 12-25, Dec 25, December 25
  if (!date) {
    // MM/DD or MM-DD
    const slashMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (slashMatch) {
      const month = parseInt(slashMatch[1]) - 1;
      const day = parseInt(slashMatch[2]);
      date = new Date(now.getFullYear(), month, day, 23, 59, 0, 0);
      if (date < now) date.setFullYear(date.getFullYear() + 1);
      remaining = text.replace(slashMatch[0], '').trim();
    }
  }

  // Clean up extra spaces
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

function blurQuickAdd() {
  const input = document.getElementById('quickAddInput');
  if (input) {
    input.value = '';
    input.blur();
    input.placeholder = 'Press N to add a task...';
    hideQuickAddHints();
  }
}

async function submitQuickAdd() {
  const input = document.getElementById('quickAddInput');
  const rawText = input?.value?.trim();

  if (!rawText) return;

  try {
    const parsed = parseQuickAddInput(rawText);

    if (!parsed.title) {
      showToast('Please enter a task title', 'error');
      return;
    }

    await api.createTask(parsed);

    input.value = '';
    hideQuickAddHints();

    // Build success message
    let msg = 'Task created!';
    if (parsed.project_id) {
      const proj = projects.find(p => p.id === parsed.project_id);
      if (proj) msg += ` in ${proj.name}`;
    }
    if (parsed.due_date) {
      msg += ` due ${Gamification.formatDueDate(parsed.due_date)?.text || 'soon'}`;
    }

    showToast(msg, 'success');
    await loadTasks();

    // Keep focus for rapid entry
    input.focus();
  } catch (error) {
    console.error('Failed to create task:', error);
    showToast(error.message || 'Failed to create task', 'error');
  }
}

// Quick add autocomplete hints
function showQuickAddHints(type, query) {
  let hints = [];
  const hintsContainer = document.getElementById('quickAddAutocomplete');

  if (type === 'project') {
    hints = projects.filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 5).map(p => ({ label: p.name, value: `@${p.name.replace(/\s+/g, '-')}`, icon: '📁' }));
  } else if (type === 'category') {
    hints = categories.filter(c =>
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

  // Add click handlers
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

  // Replace the trigger and query with the selected value
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

// Quick add autocomplete state
let quickAddHintIndex = 0;

// Quick add input handlers
document.getElementById('quickAddInput')?.addEventListener('keydown', (e) => {
  const hintsContainer = document.getElementById('quickAddAutocomplete');
  const isHintsVisible = hintsContainer?.classList.contains('visible');

  // Navigate hints with arrow keys
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

  // Select hint with Enter when hints are visible
  if (isHintsVisible && e.key === 'Enter') {
    e.preventDefault();
    const selected = hintsContainer.querySelector('.quick-add-hint-item.selected');
    if (selected) {
      selectQuickAddHint(selected.dataset.value);
    }
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
    // Cmd+Enter opens full modal with current text
    e.preventDefault();
    const input = document.getElementById('quickAddInput');
    const parsed = parseQuickAddInput(input?.value?.trim() || '');
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

// Detect triggers while typing
document.getElementById('quickAddInput')?.addEventListener('input', (e) => {
  const text = e.target.value;
  const cursorPos = e.target.selectionStart;
  const textBeforeCursor = text.slice(0, cursorPos);

  // Find the last trigger character before cursor
  const triggers = ['@', '#', '!', '~', '^'];
  let lastTriggerPos = -1;
  let lastTrigger = null;

  for (const trigger of triggers) {
    const pos = textBeforeCursor.lastIndexOf(trigger);
    if (pos > lastTriggerPos) {
      // Check if there's a space after the trigger (meaning it's complete)
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

// Update placeholder on focus/blur
document.getElementById('quickAddInput')?.addEventListener('focus', () => {
  document.getElementById('quickAddInput').placeholder = 'Task @project #category !priority ~difficulty today...';
});

document.getElementById('quickAddInput')?.addEventListener('blur', () => {
  const input = document.getElementById('quickAddInput');
  if (!input.value) {
    input.placeholder = 'Press N to add a task...';
  }
  // Delay hiding hints to allow click selection
  setTimeout(() => {
    if (document.activeElement !== input) {
      hideQuickAddHints();
    }
  }, 150);
});
