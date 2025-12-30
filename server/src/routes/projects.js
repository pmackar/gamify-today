const express = require('express');
const db = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Get all projects for current user
router.get('/', async (req, res) => {
  try {
    const { status, category_id, priority } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT p.*, c.name as category_name, c.color as category_color,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
             (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.is_completed = true) as completed_task_count
      FROM projects p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.user_id = $1
    `;
    const params = [userId];
    let paramCount = 2;

    if (status) {
      query += ` AND p.status = $${paramCount++}`;
      params.push(status);
    }

    if (category_id) {
      query += ` AND p.category_id = $${paramCount++}`;
      params.push(category_id);
    }

    if (priority) {
      query += ` AND p.priority = $${paramCount++}`;
      params.push(priority);
    }

    query += ' ORDER BY p.due_date ASC NULLS LAST, p.created_at DESC';

    const result = await db.query(query, params);

    // Calculate progress for each project
    const projects = result.rows.map(p => ({
      ...p,
      progress: p.end_value > 0 ? Math.round((p.start_value / p.end_value) * 100) : 0
    }));

    res.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get single project
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT p.*, c.name as category_name, c.color as category_color
       FROM projects p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1 AND p.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = result.rows[0];
    project.progress = project.end_value > 0 ? Math.round((project.start_value / project.end_value) * 100) : 0;

    res.json({ project });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create project
router.post('/', async (req, res) => {
  try {
    const {
      name, description, status, priority, category_id,
      start_date, due_date, start_value, end_value, tier
    } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const result = await db.query(
      `INSERT INTO projects (user_id, name, description, status, priority, category_id,
                             start_date, due_date, start_value, end_value, tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        userId,
        name.trim(),
        description || null,
        status || 'Not started',
        priority || null,
        category_id || null,
        start_date || null,
        due_date || null,
        start_value || 0,
        end_value || 100,
        tier || 'tier2'
      ]
    );

    res.status(201).json({ project: result.rows[0] });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const allowedFields = [
      'name', 'description', 'status', 'priority', 'category_id',
      'start_date', 'due_date', 'start_value', 'end_value', 'tier'
    ];

    // Check ownership
    const existing = await db.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
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
      `UPDATE projects SET ${updates.join(', ')}
       WHERE id = $${paramCount++} AND user_id = $${paramCount}
       RETURNING *`,
      values
    );

    res.json({ project: result.rows[0] });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Delete project
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({ message: 'Project deleted', id });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
