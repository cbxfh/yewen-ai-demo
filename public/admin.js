'use strict';

(() => {
  const state = {
    mode: 'login',
    adminConfigured: false,
    setupAllowed: false,
    admin: null,
    stats: null,
    feedback: {
      items: [],
      total: 0,
      totalAll: 0,
      unreadCount: 0,
      status: 'all',
      category: 'all',
      loaded: false,
      loading: false
    },
    refreshTimer: null,
    refreshTick: 0,
    loadingStats: false,
    toastTimer: null
  };

  const elements = {
    loading: document.getElementById('admin-loading'),
    gate: document.getElementById('admin-gate'),
    app: document.getElementById('admin-app'),
    gateKicker: document.getElementById('gate-kicker'),
    gateTitle: document.getElementById('gate-title'),
    gateCopy: document.getElementById('gate-copy'),
    loginForm: document.getElementById('admin-login-form'),
    username: document.getElementById('admin-username'),
    password: document.getElementById('admin-password'),
    confirmField: document.getElementById('admin-confirm-field'),
    confirmPassword: document.getElementById('admin-confirm-password'),
    togglePassword: document.getElementById('toggle-admin-password'),
    submit: document.getElementById('admin-submit'),
    error: document.getElementById('admin-error'),
    gateNote: document.getElementById('admin-gate-note'),
    adminName: document.getElementById('admin-name'),
    logout: document.getElementById('admin-logout'),
    refresh: document.getElementById('refresh-stats'),
    lastUpdated: document.getElementById('last-updated'),
    totalUsers: document.getElementById('total-users'),
    newUsersToday: document.getElementById('new-users-today'),
    activeSessions: document.getElementById('active-sessions'),
    totalDocuments: document.getElementById('total-documents'),
    totalMessages: document.getElementById('total-messages'),
    aiRequestsToday: document.getElementById('ai-requests-today'),
    totalFeedback: document.getElementById('total-feedback'),
    unreadFeedback: document.getElementById('unread-feedback'),
    feedbackUnreadCount: document.getElementById('feedback-unread-count'),
    feedbackCategoryFilter: document.getElementById('feedback-category-filter'),
    markAllFeedbackRead: document.getElementById('mark-all-feedback-read'),
    feedbackList: document.getElementById('feedback-list'),
    feedbackEmpty: document.getElementById('feedback-empty'),
    loadMoreFeedback: document.getElementById('load-more-feedback'),
    trendChart: document.getElementById('trend-chart'),
    trendTotal: document.getElementById('trend-total'),
    userSearch: document.getElementById('user-search'),
    visibleUsers: document.getElementById('visible-users'),
    userTableBody: document.getElementById('user-table-body'),
    tableEmpty: document.getElementById('table-empty'),
    toast: document.getElementById('toast')
  };

  init();

  async function init() {
    bindEvents();
    try {
      const response = await fetch('/api/admin/status', {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('无法读取管理员状态');
      const status = await response.json();
      state.adminConfigured = Boolean(status.adminConfigured);
      state.setupAllowed = Boolean(status.setupAllowed);
      state.admin = status.admin || null;
      elements.loading.hidden = true;
      if (status.authenticated && status.admin) {
        showDashboard(status.admin);
      } else {
        showGate();
      }
    } catch (error) {
      elements.loading.querySelector('strong').textContent = '后台暂时不可用';
      elements.loading.insertAdjacentHTML(
        'beforeend',
        `<p style="color:rgba(255,255,255,.55);font-size:13px">${escapeHTML(error.message)}</p>`
      );
    }
  }

  function bindEvents() {
    elements.loginForm.addEventListener('submit', submitGateForm);
    elements.togglePassword.addEventListener('click', () => {
      const showing = elements.password.type === 'text';
      elements.password.type = showing ? 'password' : 'text';
      elements.confirmPassword.type = elements.password.type;
      elements.togglePassword.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
    });
    [elements.username, elements.password, elements.confirmPassword].forEach((input) => {
      input.addEventListener('input', hideError);
    });
    elements.logout.addEventListener('click', logout);
    elements.refresh.addEventListener('click', () => {
      loadStats({ manual: true });
      loadFeedback({ reset: true, quiet: true });
    });
    elements.userSearch.addEventListener('input', renderUserTable);
    document.querySelectorAll('[data-feedback-status]').forEach((button) => {
      button.addEventListener('click', () => {
        state.feedback.status = button.dataset.feedbackStatus;
        document.querySelectorAll('[data-feedback-status]').forEach((candidate) => {
          candidate.classList.toggle('active', candidate === button);
        });
        loadFeedback({ reset: true });
      });
    });
    elements.feedbackCategoryFilter.addEventListener('change', () => {
      state.feedback.category = elements.feedbackCategoryFilter.value;
      loadFeedback({ reset: true });
    });
    elements.markAllFeedbackRead.addEventListener('click', markAllFeedbackRead);
    elements.loadMoreFeedback.addEventListener('click', () => loadFeedback());
    elements.feedbackList.addEventListener('toggle', handleFeedbackToggle, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.admin) {
        loadStats();
        loadFeedback({ reset: true, quiet: true });
      }
    });
  }

  function showGate() {
    elements.gate.hidden = false;
    elements.app.hidden = true;
    elements.loading.hidden = true;

    if (!state.adminConfigured && !state.setupAllowed) {
      state.mode = 'locked';
      elements.gateKicker.textContent = 'LOCAL SETUP REQUIRED';
      elements.gateTitle.textContent = '请先在电脑本机初始化';
      elements.gateCopy.textContent =
        '为了确保只有你能查看，管理员首次设置只能在运行网站的电脑本机完成。';
      elements.gateNote.textContent =
        '在电脑打开 http://127.0.0.1:8084/admin 设置管理员账号，完成后即可从公网登录。';
      elements.loginForm.hidden = true;
      return;
    }

    elements.loginForm.hidden = false;
    if (!state.adminConfigured) {
      state.mode = 'setup';
      elements.gateKicker.textContent = 'FIRST-TIME ADMIN SETUP';
      elements.gateTitle.textContent = '设置管理员账号';
      elements.gateCopy.textContent = '这是本机首次初始化。设置后，只有此管理员密码可以查看后台。';
      elements.confirmField.hidden = false;
      elements.confirmPassword.required = true;
      elements.password.autocomplete = 'new-password';
      elements.password.minLength = 12;
      elements.submit.textContent = '创建管理员并进入后台';
      elements.gateNote.textContent =
        '管理员密码至少 12 个字符。普通用户账号不能进入此后台，管理员账号也无法使用 AI 工作台。';
    } else {
      state.mode = 'login';
      elements.gateKicker.textContent = 'ADMIN ACCESS';
      elements.gateTitle.textContent = '管理员登录';
      elements.gateCopy.textContent = '输入独立管理员账号后查看实时运营数据。';
      elements.confirmField.hidden = true;
      elements.confirmPassword.required = false;
      elements.password.autocomplete = 'current-password';
      elements.password.minLength = 1;
      elements.submit.textContent = '登录后台';
      elements.gateNote.textContent =
        '管理员账号与普通用户账号完全独立，普通用户无法进入此后台。';
    }
  }

  async function submitGateForm(event) {
    event.preventDefault();
    if (state.mode === 'locked' || elements.submit.disabled) return;
    hideError();
    const username = elements.username.value.trim();
    const password = elements.password.value;
    if (state.mode === 'setup') {
      if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) {
        showError('管理员用户名需为 3–24 个汉字、字母、数字、下划线或短横线。');
        return;
      }
      if (password.length < 12) {
        showError('管理员密码至少需要 12 个字符。');
        return;
      }
      if (password !== elements.confirmPassword.value) {
        showError('两次输入的管理员密码不一致。');
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        state.mode === 'setup' ? '/api/admin/setup' : '/api/admin/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ username, password })
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '管理员登录失败');
      state.adminConfigured = true;
      state.admin = payload.admin;
      showDashboard(payload.admin);
    } catch (error) {
      showError(error.message);
      elements.password.focus();
    } finally {
      setSubmitting(false);
    }
  }

  function setSubmitting(submitting) {
    elements.submit.disabled = submitting;
    elements.submit.textContent = submitting
      ? '请稍候…'
      : state.mode === 'setup'
        ? '创建管理员并进入后台'
        : '登录后台';
  }

  function showDashboard(admin) {
    state.admin = admin;
    elements.gate.hidden = true;
    elements.loading.hidden = true;
    elements.app.hidden = false;
    elements.adminName.textContent = admin.username;
    document.title = `实时后台｜${admin.username}`;
    loadStats();
    loadFeedback({ reset: true });
    startRefresh();
  }

  async function loadStats({ manual = false } = {}) {
    if (state.loadingStats) return;
    state.loadingStats = true;
    if (manual) elements.refresh.classList.add('is-spinning');
    try {
      const response = await fetch('/api/admin/stats', {
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) {
        stopRefresh();
        elements.app.hidden = true;
        elements.gate.hidden = false;
        showGate();
        showError('管理员会话已过期，请重新登录。');
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '数据加载失败');
      state.stats = payload;
      renderDashboard();
      if (
        state.feedback.loaded &&
        Number(payload.unreadFeedback) !== state.feedback.unreadCount &&
        !state.feedback.loading
      ) {
        loadFeedback({ reset: true, quiet: true });
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      state.loadingStats = false;
      if (manual) elements.refresh.classList.remove('is-spinning');
    }
  }

  function renderDashboard() {
    const stats = state.stats;
    if (!stats) return;
    elements.totalUsers.textContent = formatNumber(stats.totalUsers);
    elements.newUsersToday.textContent = formatNumber(stats.newUsersToday);
    elements.activeSessions.textContent = formatNumber(stats.activeSessions);
    elements.totalDocuments.textContent = formatNumber(stats.totalDocuments);
    elements.totalMessages.textContent = formatNumber(stats.totalMessages);
    elements.aiRequestsToday.textContent = formatNumber(stats.aiRequestsToday);
    elements.totalFeedback.textContent = formatNumber(stats.feedbackTotal);
    elements.unreadFeedback.textContent = formatNumber(stats.unreadFeedback);
    elements.lastUpdated.textContent = formatTime(stats.generatedAt);
    renderTrend(stats.recentRegistrations || []);
    renderUserTable();
  }

  function renderTrend(items) {
    elements.trendChart.replaceChildren();
    const max = Math.max(1, ...items.map((item) => item.count));
    const total = items.reduce((sum, item) => sum + item.count, 0);
    elements.trendTotal.textContent = formatNumber(total);

    items.forEach((item, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = `trend-item${index === items.length - 1 ? ' is-today' : ''}`;
      const count = document.createElement('span');
      count.className = 'trend-count';
      count.textContent = String(item.count);
      const barWrap = document.createElement('div');
      barWrap.className = 'trend-bar-wrap';
      const bar = document.createElement('span');
      bar.className = 'trend-bar';
      bar.style.height = `${Math.max(2, (item.count / max) * 100)}%`;
      barWrap.append(bar);
      const date = document.createElement('span');
      date.className = 'trend-date';
      date.textContent = `${item.date.slice(5, 7)}/${item.date.slice(8, 10)}`;
      wrapper.append(count, barWrap, date);
      elements.trendChart.append(wrapper);
    });
  }

  async function loadFeedback({ reset = false, quiet = false } = {}) {
    if (state.feedback.loading) return;
    state.feedback.loading = true;
    elements.loadMoreFeedback.disabled = true;
    const offset = reset ? 0 : state.feedback.items.length;
    const params = new URLSearchParams({
      limit: '100',
      offset: String(offset),
      status: state.feedback.status,
      category: state.feedback.category
    });

    try {
      const response = await fetch(`/api/admin/feedback?${params}`, {
        headers: { Accept: 'application/json' }
      });
      if (response.status === 401) {
        expireAdminSession();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '意见信箱加载失败');

      const incoming = Array.isArray(payload.items) ? payload.items : [];
      if (reset) {
        state.feedback.items = incoming;
      } else {
        const knownIds = new Set(state.feedback.items.map((item) => item.id));
        state.feedback.items.push(...incoming.filter((item) => !knownIds.has(item.id)));
      }
      state.feedback.total = Number(payload.total) || 0;
      state.feedback.totalAll = Number(payload.totalAll) || 0;
      state.feedback.unreadCount = Number(payload.unreadCount) || 0;
      state.feedback.loaded = true;
      renderFeedbackList();
    } catch (error) {
      if (!quiet) showToast(error.message);
    } finally {
      state.feedback.loading = false;
      elements.loadMoreFeedback.disabled = false;
    }
  }

  function renderFeedbackList() {
    elements.feedbackList.replaceChildren();
    document.querySelectorAll('[data-feedback-status]').forEach((button) => {
      button.classList.toggle('active', button.dataset.feedbackStatus === state.feedback.status);
    });
    elements.feedbackCategoryFilter.value = state.feedback.category;
    updateFeedbackCounters();
    elements.feedbackEmpty.hidden = state.feedback.items.length > 0;
    elements.feedbackEmpty.querySelector('strong').textContent = state.feedback.totalAll
      ? '没有符合条件的意见'
      : '信箱还是空的';
    elements.feedbackEmpty.querySelector('p').textContent = state.feedback.totalAll
      ? '可以切换状态或意见类型查看其他内容。'
      : '用户通过 AI 助手页面提交意见后，会实时出现在这里。';
    elements.loadMoreFeedback.hidden =
      state.feedback.items.length >= state.feedback.total || state.feedback.total === 0;
    const remaining = Math.max(0, state.feedback.total - state.feedback.items.length);
    elements.loadMoreFeedback.textContent = `加载更早的意见（还有 ${remaining} 条）`;

    const fragment = document.createDocumentFragment();
    state.feedback.items.forEach((item) => {
      const details = document.createElement('details');
      details.className = `feedback-item ${item.readAt ? 'is-read' : 'is-unread'}`;
      details.dataset.feedbackId = item.id;

      const summary = document.createElement('summary');
      const unreadDot = document.createElement('span');
      unreadDot.className = 'feedback-unread-dot';
      unreadDot.setAttribute('aria-label', item.readAt ? '已读' : '未读');

      const summaryContent = document.createElement('div');
      summaryContent.className = 'feedback-summary-content';
      const summaryTop = document.createElement('div');
      summaryTop.className = 'feedback-summary-top';
      const category = document.createElement('span');
      category.className = `feedback-category feedback-category-${getCategoryKey(item.category)}`;
      category.textContent = item.category || '其他';
      const username = document.createElement('strong');
      username.textContent = item.username || '未知账号';
      const submittedAt = document.createElement('span');
      submittedAt.className = 'feedback-item-time';
      submittedAt.textContent = formatDate(item.createdAt, true);
      summaryTop.append(category, username, submittedAt);
      const summaryNote = document.createElement('p');
      summaryNote.textContent = `${item.page || '/assistant.html'} · ${
        item.readAt ? '已读' : '未读'
      }`;
      summaryContent.append(summaryTop, summaryNote);

      const summarySide = document.createElement('div');
      summarySide.className = 'feedback-summary-side';
      const delivery = getDeliveryInfo(item.delivery);
      const deliveryBadge = document.createElement('span');
      deliveryBadge.className = `delivery-badge delivery-${delivery.key}`;
      deliveryBadge.textContent = delivery.label;
      const expand = document.createElement('span');
      expand.className = 'feedback-expand';
      expand.textContent = '展开';
      summarySide.append(deliveryBadge, expand);
      summary.append(unreadDot, summaryContent, summarySide);

      const body = document.createElement('div');
      body.className = 'feedback-body';
      const message = document.createElement('p');
      message.className = 'feedback-message';
      message.textContent = item.message;
      const meta = document.createElement('div');
      meta.className = 'feedback-meta';
      const rows = [
        ['提交账号', item.username || '未知账号'],
        ['账号编号', item.userId || '—'],
        ['提交页面', item.page || '/assistant.html'],
        ['提交时间', formatDate(item.createdAt, true)],
        ['邮件状态', delivery.description],
        ...(item.deliveredAt ? [['邮件状态更新时间', formatDate(item.deliveredAt, true)]] : [])
      ];
      rows.forEach(([label, value]) => {
        const row = document.createElement('div');
        const term = document.createElement('span');
        term.textContent = label;
        const detail = document.createElement('strong');
        detail.textContent = value;
        row.append(term, detail);
        meta.append(row);
      });
      const idRow = document.createElement('div');
      const idLabel = document.createElement('span');
      idLabel.textContent = '意见编号';
      const idValue = document.createElement('code');
      idValue.textContent = item.id;
      idRow.append(idLabel, idValue);
      meta.append(idRow);
      body.append(message, meta);
      details.append(summary, body);
      fragment.append(details);
    });
    elements.feedbackList.append(fragment);
  }

  function updateFeedbackCounters() {
    elements.feedbackUnreadCount.textContent = formatNumber(state.feedback.unreadCount);
    elements.unreadFeedback.textContent = formatNumber(state.feedback.unreadCount);
    if (state.feedback.loaded) {
      elements.totalFeedback.textContent = formatNumber(state.feedback.totalAll);
    }
    elements.markAllFeedbackRead.disabled = state.feedback.unreadCount === 0;
  }

  async function handleFeedbackToggle(event) {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const item = state.feedback.items.find((entry) => entry.id === details.dataset.feedbackId);
    if (!item || item.readAt) return;

    const previousReadAt = item.readAt;
    item.readAt = new Date().toISOString();
    state.feedback.unreadCount = Math.max(0, state.feedback.unreadCount - 1);
    details.classList.remove('is-unread');
    details.classList.add('is-read');
    const summaryNote = details.querySelector('.feedback-summary-content > p');
    if (summaryNote) {
      summaryNote.textContent = `${item.page || '/assistant.html'} · 已读`;
    }
    updateFeedbackCounters();
    try {
      const response = await fetch('/api/admin/feedback/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ id: item.id })
      });
      if (response.status === 401) {
        expireAdminSession();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '无法标记为已读');
    } catch (error) {
      item.readAt = previousReadAt;
      state.feedback.unreadCount += 1;
      details.classList.add('is-unread');
      details.classList.remove('is-read');
      if (summaryNote) {
        summaryNote.textContent = `${item.page || '/assistant.html'} · 未读`;
      }
      updateFeedbackCounters();
      showToast(error.message);
    }
  }

  async function markAllFeedbackRead() {
    if (!state.feedback.unreadCount || elements.markAllFeedbackRead.disabled) return;
    elements.markAllFeedbackRead.disabled = true;
    try {
      const response = await fetch('/api/admin/feedback/read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ all: true })
      });
      if (response.status === 401) {
        expireAdminSession();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '无法全部标记为已读');
      showToast(`已将 ${payload.updated || 0} 条意见标为已读`);
      await loadFeedback({ reset: true, quiet: true });
      loadStats();
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.markAllFeedbackRead.disabled = state.feedback.unreadCount === 0;
    }
  }

  function expireAdminSession() {
    stopRefresh();
    state.admin = null;
    state.stats = null;
    elements.app.hidden = true;
    elements.gate.hidden = false;
    showGate();
    showError('管理员会话已过期，请重新登录。');
  }

  function getCategoryKey(category) {
    return (
      {
        功能建议: 'suggestion',
        问题反馈: 'issue',
        内容纠错: 'correction',
        其他: 'other'
      }[category] || 'other'
    );
  }

  function getDeliveryInfo(delivery) {
    return (
      {
        submitted: {
          key: 'submitted',
          label: '邮件已转发',
          description: '已通过邮件服务转发'
        },
        activation_pending: {
          key: 'pending-activation',
          label: '待激活邮件',
          description: '意见已保存在站内，管理邮箱尚未完成首次激活'
        },
        not_configured: {
          key: 'not-configured',
          label: '仅站内保存',
          description: '邮件服务未配置，意见仍保存在站内'
        },
        failed: {
          key: 'failed',
          label: '转发失败',
          description: '邮件转发失败，意见已保存在站内'
        },
        pending: {
          key: 'pending',
          label: '投递中',
          description: '正在处理邮件转发'
        }
      }[delivery] || {
        key: 'unknown',
        label: '状态未知',
        description: '未记录邮件投递状态'
      }
    );
  }

  function renderUserTable() {
    if (!state.stats) return;
    const query = elements.userSearch.value.trim().toLocaleLowerCase('zh-CN');
    const users = (state.stats.users || []).filter((user) => {
      return !query || user.username.toLocaleLowerCase('zh-CN').includes(query);
    });
    elements.userTableBody.replaceChildren();
    elements.visibleUsers.textContent = `显示 ${users.length} 个`;
    elements.tableEmpty.hidden = users.length > 0;
    if (!users.length) {
      elements.tableEmpty.textContent = state.stats.totalUsers ? '没有匹配的用户名' : '暂无注册账号';
      return;
    }

    const fragment = document.createDocumentFragment();
    users.forEach((user) => {
      const row = document.createElement('tr');
      const userCell = document.createElement('td');
      const userBox = document.createElement('div');
      userBox.className = 'admin-user-cell';
      const avatar = document.createElement('span');
      avatar.className = 'admin-user-avatar';
      avatar.textContent = user.username.slice(0, 1).toUpperCase();
      const name = document.createElement('strong');
      name.textContent = user.username;
      userBox.append(avatar, name);
      userCell.append(userBox);

      [
        formatDate(user.createdAt),
        formatNumber(user.documentCount),
        formatNumber(user.messageCount),
        formatNumber(user.aiRequestsToday),
        formatDate(user.lastActivityAt, true)
      ].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      row.prepend(userCell);
      fragment.append(row);
    });
    elements.userTableBody.append(fragment);
  }

  async function logout() {
    stopRefresh();
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
    } finally {
      state.admin = null;
      state.stats = null;
      state.feedback = {
        items: [],
        total: 0,
        totalAll: 0,
        unreadCount: 0,
        status: 'all',
        category: 'all',
        loaded: false,
        loading: false
      };
      elements.app.hidden = true;
      elements.gate.hidden = false;
      showGate();
      elements.password.value = '';
    }
  }

  function startRefresh() {
    stopRefresh();
    state.refreshTick = 0;
    state.refreshTimer = setInterval(() => {
      if (!document.hidden) {
        loadStats();
        state.refreshTick += 1;
        if (state.refreshTick % 6 === 0) {
          loadFeedback({ reset: true, quiet: true });
        }
      }
    }, 5000);
  }

  function stopRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
  }

  function hideError() {
    elements.error.hidden = true;
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3000);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
  }

  function formatDate(value, includeTime = false) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
      }).format(new Date(value));
    } catch {
      return '—';
    }
  }

  function formatTime(value) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(value));
    } catch {
      return '—';
    }
  }

  function escapeHTML(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
