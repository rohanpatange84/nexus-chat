/* =====================================================
   NEXUS CHAT — Full Stack Application Logic
   ===================================================== */

const API_URL = '/api';
let socket;
let currentUser = null;
let token = localStorage.getItem('token');
let users = [];
let currentChatUserId = null;
let messagesCache = {}; // { userId: [messages] }

// ── DOM Refs ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  authOverlay:       $('authOverlay'),
  authForm:          $('authForm'),
  authNameGroup:     $('nameGroup'),
  authName:          $('authName'),
  authEmail:         $('authEmail'),
  authPassword:      $('authPassword'),
  authSwitchBtn:     $('authSwitchBtn'),
  authSwitchText:    $('authSwitchText'),
  authTitle:         $('authTitle'),
  authSubtitle:      $('authSubtitle'),
  appContainer:      $('appContainer'),
  
  contactList:       $('contactList'),
  groupList:         $('groupList'),
  emptyState:        $('emptyState'),
  chatWindow:        $('chatWindow'),
  chatHeader:        $('chatHeader'),
  peerAvatar:        $('peerAvatar'),
  peerStatus:        $('peerStatus'),
  peerName:          $('peerName'),
  peerMeta:          $('peerMeta'),
  messagesContainer: $('messagesContainer'),
  messageInput:      $('messageInput'),
  sendBtn:           $('sendBtn'),
  searchInput:       $('searchInput'),
  myAvatar:          $('myAvatar'),
  sidebar:           $('sidebar'),
  toast:             $('toast'),
  settingsBtn:       $('settingsBtn'),
  backBtn:           $('backBtn')
};

let isLoginMode = true;

// ── Init ──────────────────────────────────────────────
async function init() {
  const storedUser = localStorage.getItem('user');
  if (token && storedUser) {
    currentUser = JSON.parse(storedUser);
    showApp();
    await connectSocket();
    await fetchUsers();
  } else {
    showAuth();
  }
}

// ── Auth Logic ────────────────────────────────────────
function showAuth() {
  el.authOverlay.style.display = 'flex';
  el.appContainer.style.display = 'none';
}

function showApp() {
  el.authOverlay.style.display = 'none';
  el.appContainer.style.display = 'flex';
  
  // Set my info
  el.myAvatar.textContent = currentUser.avatar;
  el.myAvatar.style.cssText = `background:${currentUser.color};color:#fff;width:38px;height:38px;font-size:14px;border-radius:50%;font-family:'Outfit',sans-serif;font-weight:700;display:flex;align-items:center;justify-content:center;`;
  document.querySelector('.user-name').textContent = currentUser.name;
}

el.authSwitchBtn.addEventListener('click', () => {
  isLoginMode = !isLoginMode;
  if (isLoginMode) {
    el.authTitle.textContent = 'Welcome Back';
    el.authSubtitle.textContent = 'Sign in to continue to Nexus Chat.';
    el.authNameGroup.style.display = 'none';
    el.authName.required = false;
    el.authSwitchText.textContent = "Don't have an account?";
    el.authSwitchBtn.textContent = 'Sign Up';
  } else {
    el.authTitle.textContent = 'Create an Account';
    el.authSubtitle.textContent = 'Join Nexus Chat today.';
    el.authNameGroup.style.display = 'block';
    el.authName.required = true;
    el.authSwitchText.textContent = "Already have an account?";
    el.authSwitchBtn.textContent = 'Sign In';
  }
});

el.authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const endpoint = isLoginMode ? '/auth/signin' : '/auth/signup';
  
  const payload = {
    email: el.authEmail.value,
    password: el.authPassword.value,
  };
  if (!isLoginMode) payload.name = el.authName.value;

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (res.ok) {
      token = data.token;
      currentUser = data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(currentUser));
      showApp();
      await connectSocket();
      await fetchUsers();
      el.authEmail.value = ''; el.authPassword.value = ''; el.authName.value = '';
    } else {
      showToast(data.message || 'Authentication failed');
    }
  } catch (err) {
    showToast('Error connecting to server');
  }
});

// Logout
if (el.settingsBtn) {
  el.settingsBtn.addEventListener('click', () => {
    if(confirm('Are you sure you want to log out?')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      token = null;
      currentUser = null;
      if (socket) socket.disconnect();
      window.location.reload();
    }
  });
}

// ── Socket Logic ──────────────────────────────────────
async function connectSocket() {
  if (typeof io === 'undefined') {
    showToast('Socket.io library missing');
    return;
  }
  
  socket = io();
  
  socket.on('connect', () => {
    socket.emit('join', currentUser._id);
  });
  
  socket.on('user_status', ({ userId, status }) => {
    const user = users.find(u => u._id === userId);
    if (user) {
      user.status = status;
      renderSidebar();
      if (currentChatUserId === userId) {
        el.peerStatus.className = `status-dot ${status}`;
        el.peerMeta.textContent = status === 'online' ? 'Online' : 'Offline';
      }
    }
  });
  
  socket.on('receive_message', (msg) => {
    const otherUserId = msg.sender._id === currentUser._id ? msg.receiver : msg.sender._id;
    if (!messagesCache[otherUserId]) messagesCache[otherUserId] = [];
    messagesCache[otherUserId].push(msg);
    
    if (currentChatUserId === otherUserId) {
      appendMessageDOM(msg);
      scrollToBottom();
    } else {
      // Show unread indicator in sidebar
      renderSidebar();
      if (msg.sender._id !== currentUser._id) {
         showToast(`New message from ${msg.sender.name}`);
      }
    }
  });
}

// ── Data Fetching ─────────────────────────────────────
async function fetchUsers() {
  try {
    const res = await fetch(`${API_URL}/auth/users?currentUserId=${currentUser._id}`);
    users = await res.json();
    renderSidebar();
  } catch (err) {
    console.error('Failed to fetch users', err);
  }
}

async function fetchMessages(userId) {
  try {
    const res = await fetch(`${API_URL}/messages/${currentUser._id}/${userId}`);
    const msgs = await res.json();
    messagesCache[userId] = msgs;
    renderMessages(userId);
  } catch (err) {
    console.error('Failed to fetch messages', err);
  }
}

// ── UI Render Logic ───────────────────────────────────
function renderSidebar() {
  el.contactList.innerHTML = '';
  
  users.forEach(contact => {
    const li = document.createElement('li');
    li.className = 'contact-item' + (currentChatUserId === contact._id ? ' active' : '');
    li.dataset.id = contact._id;
    
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'avatar-wrap';
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = contact.avatar || contact.name.charAt(0);
    av.style.cssText = `background:${contact.color || '#ccc'};color:#fff;width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:bold;`;
    
    avatarWrap.appendChild(av);
    const dot = document.createElement('div');
    dot.className = `status-dot ${contact.status || 'offline'}`;
    avatarWrap.appendChild(dot);
    
    const info = document.createElement('div');
    info.className = 'contact-info';
    info.innerHTML = `<div class="contact-name">${contact.name}</div>`;
    
    li.append(avatarWrap, info);
    li.addEventListener('click', () => openChat(contact._id));
    el.contactList.appendChild(li);
  });
}

function openChat(id) {
  currentChatUserId = id;
  const peer = users.find(u => u._id === id);
  if (!peer) return;

  el.peerAvatar.textContent = peer.avatar || peer.name.charAt(0);
  el.peerAvatar.style.cssText = `background:${peer.color || '#ccc'};color:#fff;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:bold;`;
  el.peerStatus.className = `status-dot ${peer.status || 'offline'}`;
  el.peerName.textContent = peer.name;
  el.peerMeta.textContent = peer.status === 'online' ? 'Online' : 'Offline';

  el.emptyState.style.display = 'none';
  el.chatWindow.style.display = 'flex';
  el.chatWindow.style.flexDirection = 'column';
  
  if (window.innerWidth <= 680) {
    el.sidebar.classList.add('hidden');
  }

  renderSidebar();
  
  if (messagesCache[id]) {
    renderMessages(id);
  } else {
    fetchMessages(id);
  }
}

function renderMessages(userId) {
  el.messagesContainer.innerHTML = '';
  const msgs = messagesCache[userId] || [];
  msgs.forEach(msg => appendMessageDOM(msg));
  scrollToBottom();
}

function appendMessageDOM(msg) {
  const isOut = msg.sender._id === currentUser._id || msg.sender === currentUser._id;
  
  const row = document.createElement('div');
  row.className = `message-row ${isOut ? 'out' : 'in'}`;
  
  const group = document.createElement('div');
  group.className = 'bubble-group';
  
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = msg.text;
  
  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  const d = new Date(msg.createdAt || Date.now());
  meta.innerHTML = `<span>${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>`;
  
  group.append(bubble, meta);
  row.appendChild(group);
  el.messagesContainer.appendChild(row);
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  });
}

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 3000);
}

// ── Interactions ──────────────────────────────────────
el.sendBtn.addEventListener('click', sendMessage);
el.messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const text = el.messageInput.value.trim();
  if (!text || !currentChatUserId) return;
  
  socket.emit('private_message', {
    senderId: currentUser._id,
    receiverId: currentChatUserId,
    text
  });
  
  el.messageInput.value = '';
}

if (el.backBtn) {
  el.backBtn.addEventListener('click', () => {
    el.sidebar.classList.remove('hidden');
  });
}

// ── Run ───────────────────────────────────────────────
init();
