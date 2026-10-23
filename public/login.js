'use strict';

(() => {
  const state = {
    mode: 'login',
    submitting: false
  };

  const elements = {
    form: document.getElementById('auth-form'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    confirmPassword: document.getElementById('confirm-password'),
    confirmField: document.getElementById('confirm-password-field'),
    showPassword: document.getElementById('show-password'),
    submit: document.getElementById('auth-submit'),
    error: document.getElementById('auth-error'),
    note: document.getElementById('auth-note'),
    title: document.getElementById('auth-title'),
    toast: document.getElementById('toast')
  };

  init();

  async function init() {
    bindEvents();
    const session = await fetchSession();
    if (session && session.authenticated) {
      window.location.replace(getNextUrl());
      return;
    }
    if (!session) showError('无法连接账号服务，请稍后刷新重试。');
  }

  function bindEvents() {
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => setMode(button.dataset.authMode));
    });
    elements.form.addEventListener('submit', submitAuth);
    elements.showPassword.addEventListener('click', () => {
      const showing = elements.password.type === 'text';
      elements.password.type = showing ? 'password' : 'text';
      elements.confirmPassword.type = elements.password.type;
      elements.showPassword.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
    });
    [elements.username, elements.password, elements.confirmPassword].forEach((input) => {
      input.addEventListener('input', hideError);
    });
  }

  function setMode(mode) {
    state.mode = mode === 'register' ? 'register' : 'login';
    const isRegister = state.mode === 'register';
    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      const active = button.dataset.authMode === state.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    elements.confirmField.hidden = !isRegister;
    elements.confirmPassword.required = isRegister;
    elements.password.autocomplete = isRegister ? 'new-password' : 'current-password';
    elements.title.textContent = isRegister ? '创建业问账号' : '欢迎使用业问';
    elements.submit.firstChild.textContent = isRegister ? '注册并进入 ' : '登录 ';
    elements.note.textContent = isRegister
      ? '注册后将自动登录。当前版本不提供邮箱找回密码，请妥善保存账号信息。'
      : '首次使用请先注册。当前版本使用用户名和密码登录，不提供邮箱找回密码。';
    hideError();
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (state.submitting) return;
    hideError();
    const username = elements.username.value.trim();
    const password = elements.password.value;
    const confirmPassword = elements.confirmPassword.value;

    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) {
      showError('用户名需为 3–24 个汉字、字母、数字、下划线或短横线。');
      elements.username.focus();
      return;
    }
    if (password.length < 8) {
      showError('密码至少需要 8 个字符。');
      elements.password.focus();
      return;
    }
    if (state.mode === 'register' && password !== confirmPassword) {
      showError('两次输入的密码不一致。');
      elements.confirmPassword.focus();
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${state.mode}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ username, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '登录失败，请稍后再试。');
      showToast(state.mode === 'register' ? '账号已创建' : '登录成功');
      window.setTimeout(() => window.location.replace(getNextUrl()), 250);
    } catch (error) {
      showError(error.message);
      elements.password.focus();
    } finally {
      setSubmitting(false);
    }
  }

  function setSubmitting(submitting) {
    state.submitting = submitting;
    elements.submit.disabled = submitting;
    elements.submit.firstChild.textContent = submitting
      ? '请稍候 '
      : state.mode === 'register'
        ? '注册并进入 '
        : '登录 ';
  }

  async function fetchSession() {
    try {
      const response = await fetch('/api/auth/session', { headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  function getNextUrl() {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
    return '/assistant.html';
  }

  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = false;
  }

  function hideError() {
    elements.error.hidden = true;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
  }
})();
