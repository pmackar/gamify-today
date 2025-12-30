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

// User Display
function updateUserDisplay() {
  if (!currentUser) return;

  document.getElementById('userLevel').textContent = currentUser.level;
  document.getElementById('xpCurrent').textContent = currentUser.xp;
  document.getElementById('xpToNext').textContent = currentUser.xpToNext;

  const xpPercent = (currentUser.xp / currentUser.xpToNext) * 100;
  document.getElementById('xpBarFill').style.width = `${xpPercent}%`;

  document.getElementById('streakCount').textContent = currentUser.currentStreak;

  // Update streak visibility
  const streakDisplay = document.getElementById('streakDisplay');
  if (currentUser.currentStreak > 0) {
    streakDisplay.style.display = 'flex';
  } else {
    streakDisplay.style.display = 'none';
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

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    commandPaletteSelectedIndex = Math.min(commandPaletteSelectedIndex + 1, filteredCommands.length - 1);
    renderCommandPalette(input.value);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    commandPaletteSelectedIndex = Math.max(commandPaletteSelectedIndex - 1, 0);
    renderCommandPalette(input.value);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCommands[commandPaletteSelectedIndex]) {
      executeCommand(filteredCommands[commandPaletteSelectedIndex].id);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  }
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
    // New task
    case 'n':
      e.preventDefault();
      showTaskModal();
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
