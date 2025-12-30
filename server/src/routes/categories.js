const express = require('express');
const db = require('../db/config');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all categories for current user
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM categories WHERE user_id = $1 ORDER BY order_index ASC, created_at ASC',
      [req.user.id]
    );

    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category
router.post('/', async (req, res) => {
  try {
    const { name, color, icon } = req.body;
    const userId = req.user.id;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Get max order_index
    const maxOrderResult = await db.query(
      'SELECT COALESCE(MAX(order_index), -1) as max_order FROM categories WHERE user_id = $1',
      [userId]
    );
    const orderIndex = maxOrderResult.rows[0].max_order + 1;

    const result = await db.query(
      `INSERT INTO categories (user_id, name, color, icon, order_index)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name.trim(), color || '#ff6b35', icon || null, orderIndex]
    );

    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'Category name already exists' });
    }
    console.error('Create category error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, icon, order_index } = req.body;
    const userId = req.user.id;

    // Check ownership
    const existing = await db.query(
      'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name.trim());
    }
    if (color !== undefined) {
      updates.push(`color = $${paramCount++}`);
      values.push(color);
    }
    if (icon !== undefined) {
      updates.push(`icon = $${paramCount++}`);
      values.push(icon);
    }
    if (order_index !== undefined) {
      updates.push(`order_index = $${paramCount++}`);
      values.push(order_index);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, userId);
    const result = await db.query(
      `UPDATE categories SET ${updates.join(', ')}
       WHERE id = $${paramCount++} AND user_id = $${paramCount}
       RETURNING *`,
      values
    );

    res.json({ category: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Category name already exists' });
    }
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      'DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted', id });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Reorder categories
router.post('/reorder', async (req, res) => {
  try {
    const { categoryIds } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(categoryIds)) {
      return res.status(400).json({ error: 'categoryIds array is required' });
    }

    // Update order_index for each category
    const updates = categoryIds.map((id, index) =>
      db.query(
        'UPDATE categories SET order_index = $1 WHERE id = $2 AND user_id = $3',
        [index, id, userId]
      )
    );

    await Promise.all(updates);

    res.json({ message: 'Categories reordered' });
  } catch (error) {
    console.error('Reorder categories error:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

module.exports = router;
