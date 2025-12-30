const express = require('express');
const db = require('../db/config');
const { authenticate } = require('../middleware/auth');
const { processTaskCompletion, processTaskUncompletion, calculateTaskXP } = require('../services/gamification');

const router = express.Router();

router.use(authenticate);

// Get all tasks for current user
router.get('/', async (req, res) => {
  try {
    const { status, project_id, category_id, priority, is_completed, due_before, due_after } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT t.*, c.name as category_name, c.color as category_color,
             p.name as project_name
      FROM tasks t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = $1
    `;
    const params = [userId];
    let paramCount = 2;

    if (status) {
      query += ` AND t.status = $${paramCount++}`;
      params.push(status);
    }

    if (project_id) {
      query += ` AND t.project_id = $${paramCount++}`;
      params.push(project_id);
    }

    if (category_id) {
      query += ` AND t.category_id = $${paramCount++}`;
      params.push(category_id);
    }

    if (priority) {
      query += ` AND t.priority = $${paramCount++}`;
      params.push(priority);
    }

    if (is_completed !== undefined) {
      query += ` AND t.is_completed = $${paramCount++}`;
      params.push(is_completed === 'true');
    }

    if (due_before) {
      query += ` AND t.due_date <= $${paramCount++}`;
      params.push(due_before);
    }

    if (due_after) {
      query += ` AND t.due_date >= $${paramCount++}`;
      params.push(due_after);
    }

    query += ' ORDER BY t.is_completed ASC, t.due_date ASC NULLS LAST, t.order_index ASC, t.created_at DESC';

    const result = await db.query(query, params);

    // Add XP preview for incomplete tasks
    const tasks = result.rows.map(task => {
      if (!task.is_completed) {
        task.xp_preview = calculateTaskXP(task, req.user.current_streak);
      }
      return task;
    });

    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Get single task
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT t.*, c.name as category_name, c.color as category_color,
              p.name as project_name
       FROM tasks t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1 AND t.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = result.rows[0];
    if (!task.is_completed) {
      task.xp_preview = calculateTaskXP(task, req.user.current_streak);
    }

    res.json({ task });
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Create task
router.post('/', async (req, res) => {
  try {
    const {
      title, description, status, priority, category_id, project_id,
      effort_level, estimated_duration, due_date, tier, difficulty, tags
    } = req.body;
    const userId = req.user.id;

    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    // Get max order_index for this user
    const maxOrderResult = await db.query(
      'SELECT COALESCE(MAX(order_index), -1) as max_order FROM tasks WHERE user_id = $1',
      [userId]
    );
    const orderIndex = maxOrderResult.rows[0].max_order + 1;

    const result = await db.query(
      `INSERT INTO tasks (user_id, title, description, status, priority, category_id, project_id,
                          effort_level, estimated_duration, due_date, tier, difficulty, tags, order_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        userId,
        title.trim(),
        description || null,
        status || 'Not started',
        priority || null,
        category_id || null,
        project_id || null,
        effort_level || 'Medium',
        estimated_duration || null,
        due_date || null,
        tier || 'tier3',
        difficulty || 'medium',
        tags || [],
        orderIndex
      ]
    );

    const task = result.rows[0];
    task.xp_preview = calculateTaskXP(task, req.user.current_streak);

    res.status(201).json({ task });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update task
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const allowedFields = [
      'title', 'description', 'status', 'priority', 'category_id', 'project_id',
      'effort_level', 'estimated_duration', 'due_date', 'tier', 'difficulty', 'tags', 'order_index'
    ];

    // Check ownership
    const existing = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramCount++}`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, userId);
    const result = await db.query(
      `UPDATE tasks SET ${updates.join(', ')}
       WHERE id = $${paramCount++} AND user_id = $${paramCount}
       RETURNING *`,
      values
    );

    const task = result.rows[0];
    if (!task.is_completed) {
      task.xp_preview = calculateTaskXP(task, req.user.current_streak);
    }

    res.json({ task });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Complete task (special endpoint with gamification)
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get task
    const taskResult = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];

    if (task.is_completed) {
      return res.status(400).json({ error: 'Task already completed' });
    }

    // Check if completed on time
    const now = new Date();
    const wasOnTime = !task.due_date || new Date(task.due_date) >= now;

    // Update task as completed
    await db.query(
      `UPDATE tasks SET is_completed = true, completed_at = CURRENT_TIMESTAMP,
       was_on_time = $1, status = 'Done' WHERE id = $2`,
      [wasOnTime, id]
    );

    // Process gamification
    const updatedTask = { ...task, was_on_time: wasOnTime };
    const gamificationResult = await processTaskCompletion(userId, updatedTask);

    // Get updated task
    const finalTaskResult = await db.query(
      `SELECT t.*, c.name as category_name, c.color as category_color, p.name as project_name
       FROM tasks t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.id = $1`,
      [id]
    );

    res.json({
      task: finalTaskResult.rows[0],
      gamification: gamificationResult
    });
  } catch (error) {
    console.error('Complete task error:', error);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// Uncomplete task (undo completion) - revokes XP
router.post('/:id/uncomplete', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Get task first to check ownership and get xp_earned
    const taskResult = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskResult.rows[0];

    if (!task.is_completed) {
      return res.status(400).json({ error: 'Task is not completed' });
    }

    // Revoke XP and update user stats
    const gamificationResult = await processTaskUncompletion(userId, task);

    // Update task as incomplete
    const result = await db.query(
      `UPDATE tasks SET is_completed = false, completed_at = NULL, was_on_time = NULL, status = 'In progress'
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    const updatedTask = result.rows[0];
    updatedTask.xp_preview = calculateTaskXP(updatedTask, req.user.current_streak);

    res.json({
      task: updatedTask,
      gamification: gamificationResult
    });
  } catch (error) {
    console.error('Uncomplete task error:', error);
    res.status(500).json({ error: 'Failed to uncomplete task' });
  }
});

// Delete task
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ message: 'Task deleted', id });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Reorder tasks
router.post('/reorder', async (req, res) => {
  try {
    const { taskIds } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(taskIds)) {
      return res.status(400).json({ error: 'taskIds array is required' });
    }

    const updates = taskIds.map((id, index) =>
      db.query(
        'UPDATE tasks SET order_index = $1 WHERE id = $2 AND user_id = $3',
        [index, id, userId]
      )
    );

    await Promise.all(updates);

    res.json({ message: 'Tasks reordered' });
  } catch (error) {
    console.error('Reorder tasks error:', error);
    res.status(500).json({ error: 'Failed to reorder tasks' });
  }
});

module.exports = router;
