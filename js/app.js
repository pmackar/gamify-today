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

// Close modals on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeTaskModal();
    closeProjectModal();
    closeCategoryModal();
    closeStatsModal();
  }
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
    }
  });
});
