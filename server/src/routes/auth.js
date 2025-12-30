const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db/config');
const { authenticate, generateToken } = require('../middleware/auth');
const { xpToNextLevel } = require('../services/gamification');

const router = express.Router();

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Validation
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    if (username.length < 3 || username.length > 50) {
      return res.status(400).json({ error: 'Username must be between 3 and 50 characters' });
    }

    // Check if email or username already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await db.query(
      `INSERT INTO users (email, username, password_hash, auth_provider, xp_to_next)
       VALUES ($1, $2, $3, 'email', $4)
       RETURNING id, email, username, avatar, level, xp, xp_to_next, total_tasks_completed, current_streak, longest_streak, achievements, created_at`,
      [email.toLowerCase(), username, passwordHash, xpToNextLevel(1)]
    );

    const user = result.rows[0];
    const token = generateToken(user.id);

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        level: user.level,
        xp: user.xp,
        xpToNext: user.xp_to_next,
        totalTasksCompleted: user.total_tasks_completed,
        currentStreak: user.current_streak,
        longestStreak: user.longest_streak,
        achievements: user.achievements,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await db.query(
      `SELECT id, email, username, password_hash, avatar, level, xp, xp_to_next,
              total_tasks_completed, current_streak, longest_streak, achievements, created_at
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await db.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        level: user.level,
        xp: user.xp,
        xpToNext: user.xp_to_next,
        totalTasksCompleted: user.total_tasks_completed,
        currentStreak: user.current_streak,
        longestStreak: user.longest_streak,
        achievements: user.achievements,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Google OAuth login
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists with this Google ID or email
    let result = await db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email.toLowerCase()]
    );

    let user;
    let isNewUser = false;

    if (result.rows.length === 0) {
      // Create new user
      isNewUser = true;
      const username = name.replace(/\s+/g, '').toLowerCase().slice(0, 20) + Math.floor(Math.random() * 1000);

      result = await db.query(
        `INSERT INTO users (email, username, auth_provider, google_id, avatar, xp_to_next)
         VALUES ($1, $2, 'google', $3, $4, $5)
         RETURNING id, email, username, avatar, level, xp, xp_to_next, total_tasks_completed, current_streak, longest_streak, achievements, created_at`,
        [email.toLowerCase(), username, googleId, picture, xpToNextLevel(1)]
      );

      user = result.rows[0];
    } else {
      user = result.rows[0];

      // Update Google ID if user exists with email but not google_id
      if (!user.google_id) {
        await db.query(
          'UPDATE users SET google_id = $1, auth_provider = $2 WHERE id = $3',
          [googleId, user.auth_provider === 'email' ? 'email,google' : 'google', user.id]
        );
      }

      // Update last login and avatar if changed
      await db.query(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP, avatar = COALESCE(avatar, $1) WHERE id = $2',
        [picture, user.id]
      );
    }

    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar || picture,
        level: user.level,
        xp: user.xp,
        xpToNext: user.xp_to_next,
        totalTasksCompleted: user.total_tasks_completed,
        currentStreak: user.current_streak,
        longestStreak: user.longest_streak,
        achievements: user.achievements || [],
        createdAt: user.created_at
      },
      isNewUser
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'Invalid Google credential' });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      username: req.user.username,
      avatar: req.user.avatar,
      level: req.user.level,
      xp: req.user.xp,
      xpToNext: req.user.xp_to_next,
      totalTasksCompleted: req.user.total_tasks_completed,
      currentStreak: req.user.current_streak,
      longestStreak: req.user.longest_streak,
      achievements: req.user.achievements,
      createdAt: req.user.created_at
    }
  });
});

// Update profile
router.put('/me', authenticate, async (req, res) => {
  try {
    const { username, avatar } = req.body;
    const userId = req.user.id;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username) {
      // Check if username is taken by another user
      const existingUser = await db.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username.toLowerCase(), userId]
      );
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }

    if (avatar) {
      updates.push(`avatar = $${paramCount++}`);
      values.push(avatar);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}
       RETURNING id, email, username, avatar, level, xp, xp_to_next, total_tasks_completed, current_streak, longest_streak, achievements, created_at`,
      values
    );

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        level: user.level,
        xp: user.xp,
        xpToNext: user.xp_to_next,
        totalTasksCompleted: user.total_tasks_completed,
        currentStreak: user.current_streak,
        longestStreak: user.longest_streak,
        achievements: user.achievements,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
