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

let contextMessageId = null;
let contextMessageSender = null;
let contextMessageReceiver = null;
const ctxMenu = document.getElementById('messageContextMenu');
const ctxDelete = document.getElementById('deleteOption');

document.addEventListener('click', (e) => {
  if (e.target.closest('#messageContextMenu')) return;
  ctxMenu.classList.add('hidden');
});

document.addEventListener('scroll', () => {
  ctxMenu.classList.add('hidden');
}, true);

ctxDelete.addEventListener('click', () => {
  ctxMenu.classList.add('hidden');
  if(confirm('Delete this message for everyone?')) {
    socket.emit('delete_message', { 
      messageId: contextMessageId, 
      senderId: contextMessageSender, 
      receiverId: contextMessageReceiver 
    });
  }
});

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
  
  socket.on('new_user', (newUser) => {
    if (newUser._id !== currentUser._id) {
      fetchUsers();
    }
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
    } else if (userId !== currentUser._id) {
      fetchUsers();
    }
  });
  
  socket.on('receive_message', (msg) => {
    const otherUserId = msg.sender._id === currentUser._id ? msg.receiver : msg.sender._id;
    if (!messagesCache[otherUserId]) messagesCache[otherUserId] = [];
    messagesCache[otherUserId].push(msg);
    
    if (currentChatUserId === otherUserId) {
      appendMessageDOM(msg);
      scrollToBottom();
      if (msg.sender._id !== currentUser._id) {
        socket.emit('mark_read', { senderId: msg.sender._id, receiverId: currentUser._id });
      }
    } else {
      // Show unread indicator in sidebar
      const user = users.find(u => u._id === otherUserId);
      if (user) {
        if (msg.sender._id !== currentUser._id) {
          user.unreadCount = (user.unreadCount || 0) + 1;
        }
        renderSidebar();
      } else {
        fetchUsers();
      }
      if (msg.sender._id !== currentUser._id) {
         showToast(`New message from ${msg.sender.name}`);
      }
    }
  });

  socket.on('messages_read', ({ receiverId }) => {
    if (messagesCache[receiverId]) {
      messagesCache[receiverId].forEach(msg => {
        if (msg.sender._id === currentUser._id || msg.sender === currentUser._id) {
          msg.isRead = true;
        }
      });
      if (currentChatUserId === receiverId) {
        document.querySelectorAll('.read-receipt').forEach(el => {
          el.innerHTML = `<svg class="check-icon double-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline><path d="M24 10.5L13.5 21l-3-3"></path></svg>`;
        });
      }
    }
  });

  socket.on('message_deleted', ({ messageId }) => {
    // Remove from cache
    for (const userId in messagesCache) {
      messagesCache[userId] = messagesCache[userId].filter(m => m._id !== messageId);
    }
    // Remove from DOM
    const row = document.querySelector(`.message-row[data-msg-id="${messageId}"]`);
    if (row) row.remove();
  });

  socket.on('typing', ({ senderId }) => {
    if (currentChatUserId === senderId) {
      el.peerMeta.textContent = 'typing...';
      el.peerMeta.style.color = 'var(--accent-1)';
      
      if (!document.getElementById('typingBubble')) {
        const row = document.createElement('div');
        row.id = 'typingBubble';
        row.className = 'typing-indicator-row';
        row.innerHTML = `<div class="typing-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
        el.messagesContainer.appendChild(row);
        scrollToBottom();
      }
    }
  });

  socket.on('stop_typing', ({ senderId }) => {
    if (currentChatUserId === senderId) {
      const peer = users.find(u => u._id === senderId);
      el.peerMeta.textContent = peer?.status === 'online' ? 'Online' : 'Offline';
      el.peerMeta.style.color = '';
      
      const bubble = document.getElementById('typingBubble');
      if (bubble) bubble.remove();
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
    
    const unreadCount = contact.unreadCount || 0;
    if (unreadCount > 0) {
      const badge = document.createElement('div');
      badge.className = 'badge-avatar';
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
      avatarWrap.appendChild(badge);
    }
    
    const info = document.createElement('div');
    info.className = 'contact-info';
    
    let previewHTML = '';
    let timeHTML = '';
    
    if (contact.lastMessage) {
      const msgText = contact.lastMessage.text;
      const d = new Date(contact.lastMessage.createdAt);
      timeHTML = `<div class="contact-time">${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>`;
      
      let receiptHTML = '';
      if (contact.lastMessage.sender === currentUser._id || contact.lastMessage.sender._id === currentUser._id) {
        const doubleCheckSVG = `<svg class="check-icon double-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;color:var(--accent-1);"><polyline points="20 6 9 17 4 12"></polyline><path d="M24 10.5L13.5 21l-3-3"></path></svg>`;
        const singleCheckSVG = `<svg class="check-icon single-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px;color:var(--text-muted);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        receiptHTML = contact.lastMessage.isRead ? doubleCheckSVG : singleCheckSVG;
      }
      previewHTML = `<div class="contact-preview">${receiptHTML}<span class="preview-text">${msgText}</span></div>`;
    }
    
    info.innerHTML = `
      <div class="contact-header">
        <div class="contact-name">${contact.name}</div>
        ${timeHTML}
      </div>
      ${previewHTML}
    `;
    
    li.append(avatarWrap, info);
    li.addEventListener('click', () => openChat(contact._id));
    el.contactList.appendChild(li);
  });
}

function openChat(id) {
  currentChatUserId = id;
  
  if (socket) {
    socket.emit('mark_read', { senderId: id, receiverId: currentUser._id });
  }

  const peer = users.find(u => u._id === id);
  if (!peer) return;

  peer.unreadCount = 0;

  el.peerAvatar.textContent = peer.avatar || peer.name.charAt(0);
  el.peerAvatar.style.cssText = `background:${peer.color || '#ccc'};color:#fff;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:bold;`;
  el.peerStatus.className = `status-dot ${peer.status || 'offline'}`;
  el.peerName.textContent = peer.name;
  
  let metaText = peer.status === 'online' ? 'Online' : 'Offline';
  if (peer.status === 'offline' && peer.lastSeen) {
    const d = new Date(peer.lastSeen);
    const today = new Date().toLocaleDateString();
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
    const dateStr = d.toLocaleDateString();
    
    let displayDate = dateStr;
    if (dateStr === today) displayDate = 'today';
    else if (dateStr === yesterday) displayDate = 'yesterday';
    else displayDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    
    metaText = `last seen ${displayDate} at ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
  }
  
  el.peerMeta.textContent = metaText;

  el.emptyState.style.display = 'none';
  el.chatWindow.style.display = 'flex';
  el.chatWindow.style.flexDirection = 'column';
  
  if (window.innerWidth <= 680) {
    el.sidebar.classList.add('hidden');
    if (!history.state || !history.state.chatOpen) {
      history.pushState({ chatOpen: true }, '');
    }
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
  
  let lastDate = null;
  msgs.forEach(msg => {
    const d = new Date(msg.createdAt || Date.now());
    const dateStr = d.toLocaleDateString();
    
    if (dateStr !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      
      const today = new Date().toLocaleDateString();
      const yesterday = new Date(Date.now() - 86400000).toLocaleDateString();
      
      let displayDate = dateStr;
      if (dateStr === today) displayDate = 'Today';
      else if (dateStr === yesterday) displayDate = 'Yesterday';
      else displayDate = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      
      divider.innerHTML = `<span>${displayDate}</span>`;
      el.messagesContainer.appendChild(divider);
      lastDate = dateStr;
    }
    
    appendMessageDOM(msg);
  });
  
  scrollToBottom();
}

function appendMessageDOM(msg) {
  const isOut = msg.sender._id === currentUser._id || msg.sender === currentUser._id;
  
  const row = document.createElement('div');
  row.className = `message-row ${isOut ? 'out' : 'in'}`;
  if (msg._id) {
    row.dataset.msgId = msg._id;
  }
  
  const group = document.createElement('div');
  group.className = 'bubble-group';
  
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  
  const d = new Date(msg.createdAt || Date.now());
  const timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  
  let receiptHTML = '';
  if (isOut) {
    const doubleCheckSVG = `<svg class="check-icon double-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline><path d="M24 10.5L13.5 21l-3-3"></path></svg>`;
    const singleCheckSVG = `<svg class="check-icon single-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    receiptHTML = `<span class="read-receipt" data-msg-id="${msg._id || ''}">${msg.isRead ? doubleCheckSVG : singleCheckSVG}</span>`;
  }
  
  bubble.innerHTML = `
    <span class="bubble-text">${msg.text}</span>
    <span class="bubble-meta-inline">${timeStr}${receiptHTML}</span>
  `;
  
  group.append(bubble);

  if (isOut) {
    let touchTimer;
    
    const showMenu = (e) => {
      e.preventDefault();
      contextMessageId = msg._id;
      contextMessageSender = currentUser._id;
      contextMessageReceiver = msg.sender._id === currentUser._id ? msg.receiver : msg.sender._id;
      
      let x = e.pageX || (e.touches && e.touches[0].pageX);
      const y = e.pageY || (e.touches && e.touches[0].pageY);
      
      const menuWidth = 160;
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 15;
      }
      
      ctxMenu.style.left = `${x}px`;
      ctxMenu.style.top = `${y}px`;
      ctxMenu.classList.remove('hidden');
    };

    group.addEventListener('contextmenu', showMenu);
    
    group.addEventListener('touchstart', (e) => {
      touchTimer = setTimeout(() => {
        showMenu(e);
      }, 600);
    });
    
    const clearTouch = () => clearTimeout(touchTimer);
    group.addEventListener('touchend', clearTouch);
    group.addEventListener('touchmove', clearTouch);
    group.addEventListener('touchcancel', clearTouch);
  }

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

let typingTimeout = null;
el.messageInput.addEventListener('input', () => {
  if (!currentChatUserId) return;
  socket.emit('typing', { senderId: currentUser._id, receiverId: currentChatUserId });
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stop_typing', { senderId: currentUser._id, receiverId: currentChatUserId });
  }, 1500);
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
    if (history.state && history.state.chatOpen) {
      history.back();
    } else {
      el.sidebar.classList.remove('hidden');
    }
  });
}

window.addEventListener('popstate', (e) => {
  if (window.innerWidth <= 680) {
    if (!e.state || !e.state.chatOpen) {
      el.sidebar.classList.remove('hidden');
    } else {
      el.sidebar.classList.add('hidden');
    }
  }
});

// ── Run ───────────────────────────────────────────────
init();

// Fix for mobile keyboards leaving gaps or overflowing
if (window.visualViewport) {
  const setViewportHeight = () => {
    document.body.style.height = window.visualViewport.height + 'px';
  };
  window.visualViewport.addEventListener('resize', setViewportHeight);
  setViewportHeight();
}
