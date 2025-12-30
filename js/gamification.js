// Frontend gamification utilities for gamify.today

const Gamification = {
  // XP Constants (mirror backend)
  BASE_XP: 10,
  TIER_MULTIPLIER: { tier1: 3, tier2: 2, tier3: 1 },
  DIFFICULTY_MULTIPLIER: { easy: 1, medium: 1.5, hard: 2, epic: 3 },
  ON_TIME_BONUS: 1.5,
  STREAK_BONUS_PER_DAY: 0.1,
  MAX_STREAK_MULTIPLIER: 2,

  // Calculate XP preview for a task
  calculateXPPreview(task, currentStreak) {
    let xp = this.BASE_XP;
    xp *= this.TIER_MULTIPLIER[task.tier] || this.TIER_MULTIPLIER.tier3;
    xp *= this.DIFFICULTY_MULTIPLIER[task.difficulty] || this.DIFFICULTY_MULTIPLIER.medium;

    // Assume on-time if has due date in future
    if (task.due_date && new Date(task.due_date) >= new Date()) {
      xp *= this.ON_TIME_BONUS;
    }

    const streakMultiplier = Math.min(1 + (currentStreak * this.STREAK_BONUS_PER_DAY), this.MAX_STREAK_MULTIPLIER);
    xp *= streakMultiplier;

    return Math.floor(xp);
  },

  // Calculate XP required for a level
  xpToNextLevel(level) {
    return Math.floor(100 * Math.pow(1.5, level - 1));
  },

  // Get tier display info
  getTierInfo(tier) {
    const tiers = {
      tier1: { name: 'Major', color: '#8b5cf6', multiplier: '3x XP' },
      tier2: { name: 'Standard', color: '#3b82f6', multiplier: '2x XP' },
      tier3: { name: 'Quick', color: '#6b7280', multiplier: '1x XP' }
    };
    return tiers[tier] || tiers.tier3;
  },

  // Get difficulty display info
  getDifficultyInfo(difficulty) {
    const difficulties = {
      easy: { name: 'Easy', color: '#22c55e', multiplier: '1x' },
      medium: { name: 'Medium', color: '#f59e0b', multiplier: '1.5x' },
      hard: { name: 'Hard', color: '#ef4444', multiplier: '2x' },
      epic: { name: 'Epic', color: '#8b5cf6', multiplier: '3x' }
    };
    return difficulties[difficulty] || difficulties.medium;
  },

  // Get priority display info
  getPriorityInfo(priority) {
    const priorities = {
      High: { color: '#ef4444', icon: '🔴' },
      Medium: { color: '#f59e0b', icon: '🟡' },
      Low: { color: '#22c55e', icon: '🟢' }
    };
    return priorities[priority] || { color: '#6b7280', icon: '⚪' };
  },

  // Format XP number with animation class
  formatXP(xp) {
    return `+${xp} XP`;
  },

  // Format date relative to now
  formatDueDate(dateString) {
    if (!dateString) return null;

    const date = new Date(dateString);
    const now = new Date();
    const diff = date - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days < 0) {
      return { text: `${Math.abs(days)}d overdue`, class: 'overdue' };
    } else if (days === 0) {
      return { text: 'Today', class: 'soon' };
    } else if (days === 1) {
      return { text: 'Tomorrow', class: 'soon' };
    } else if (days <= 7) {
      return { text: `${days} days`, class: 'soon' };
    } else {
      return { text: date.toLocaleDateString(), class: '' };
    }
  },

  // Create confetti effect for level up
  createConfetti() {
    const colors = ['#ff6b35', '#fbbf24', '#8b5cf6', '#22c55e', '#3b82f6'];
    for (let i = 0; i < 50; i++) {
      const confetti = document.createElement('div');
      confetti.style.cssText = `
        position: fixed;
        width: 10px;
        height: 10px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        left: ${Math.random() * 100}vw;
        top: -10px;
        border-radius: 50%;
        z-index: 9999;
        animation: confetti-fall ${2 + Math.random() * 2}s ease-out forwards;
        animation-delay: ${Math.random() * 0.5}s;
      `;
      document.body.appendChild(confetti);
      setTimeout(() => confetti.remove(), 4000);
    }

    // Add confetti animation if not exists
    if (!document.getElementById('confetti-style')) {
      const style = document.createElement('style');
      style.id = 'confetti-style';
      style.textContent = `
        @keyframes confetti-fall {
          to {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }
  }
};
