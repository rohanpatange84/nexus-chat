const express = require('express');
const Message = require('../models/Message');
const router = express.Router();

// @route   GET /api/messages/:user1/:user2
// @desc    Get chat history between two users
router.get('/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;

    const messages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    })
    .sort({ createdAt: 1 })
    .populate('sender', 'name avatar color');

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
