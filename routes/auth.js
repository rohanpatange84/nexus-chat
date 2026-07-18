const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'supersecretjwtkey_change_in_production', {
    expiresIn: '30d',
  });
};

// @route   POST /api/auth/signup
// @desc    Register a new user
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Please provide all fields' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const avatar = name.charAt(0).toUpperCase();
    const colors = [
      'linear-gradient(135deg,#7c3aed,#06b6d4)',
      'linear-gradient(135deg,#f59e0b,#ef4444)',
      'linear-gradient(135deg,#10b981,#06b6d4)',
      'linear-gradient(135deg,#ec4899,#f43f5e)',
      'linear-gradient(135deg,#8b5cf6,#3b82f6)'
    ];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const user = await User.create({
      name,
      email,
      password,
      avatar,
      color,
      status: 'online'
    });

    if (user) {
      const io = req.app.get('io');
      if (io) {
        io.emit('new_user', { _id: user._id, name: user.name });
      }
      
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        color: user.color,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/auth/signin
// @desc    Authenticate user & get token
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        color: user.color,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/auth/users
// @desc    Get all users except current
router.get('/users', async (req, res) => {
  try {
    const currentUserId = req.query.currentUserId;
    const mongoose = require('mongoose');
    const Message = require('../models/Message');

    const users = await User.find({ _id: { $ne: currentUserId } }).select('-password').lean();

    const unreadCounts = await Message.aggregate([
      { $match: { receiver: new mongoose.Types.ObjectId(currentUserId), isRead: false } },
      { $group: { _id: '$sender', count: { $sum: 1 } } }
    ]);

    const usersWithUnread = users.map(user => {
      const unreadData = unreadCounts.find(u => u._id.toString() === user._id.toString());
      return {
        ...user,
        unreadCount: unreadData ? unreadData.count : 0
      };
    });

    res.json(usersWithUnread);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
