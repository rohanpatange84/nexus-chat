require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const Message = require('./models/Message');
const User = require('./models/User');

// Initialize app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' }
});
app.set('io', io);

// Connect to DB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

// Socket.io for Real-time Messaging
const onlineUsers = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // User joins and identifies themselves
  socket.on('join', async (userId) => {
    onlineUsers.set(userId, socket.id);
    
    // Update user status to online in DB
    await User.findByIdAndUpdate(userId, { status: 'online' });
    io.emit('user_status', { userId, status: 'online' });
    console.log(`User ${userId} joined with socket ${socket.id}`);
  });

  // Handle private messages
  socket.on('private_message', async ({ senderId, receiverId, text }) => {
    try {
      // Save message to DB
      const newMessage = new Message({
        sender: senderId,
        receiver: receiverId,
        text
      });
      await newMessage.save();

      const populatedMessage = await newMessage.populate('sender', 'name avatar color');

      // Send to receiver if online
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receive_message', populatedMessage);
      }
      
      // Send back to sender for confirmation
      socket.emit('receive_message', populatedMessage);
      
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  // Handle marking messages as read
  socket.on('mark_read', async ({ senderId, receiverId }) => {
    try {
      // Update all unread messages sent by senderId to receiverId
      await Message.updateMany(
        { sender: senderId, receiver: receiverId, isRead: false },
        { $set: { isRead: true } }
      );

      // Notify the sender that their messages were read
      const senderSocketId = onlineUsers.get(senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit('messages_read', { receiverId });
      }
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // Handle typing indicator
  socket.on('typing', ({ senderId, receiverId }) => {
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing', { senderId });
    }
  });

  socket.on('stop_typing', ({ senderId, receiverId }) => {
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('stop_typing', { senderId });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    let disconnectedUserId = null;
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        disconnectedUserId = userId;
        onlineUsers.delete(userId);
        break;
      }
    }
    
    if (disconnectedUserId) {
      await User.findByIdAndUpdate(disconnectedUserId, { status: 'offline' });
      io.emit('user_status', { userId: disconnectedUserId, status: 'offline' });
      console.log(`User ${disconnectedUserId} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
