'use strict';

(() => {
  const state = {
    industries: [],
    resources: [],
    resourcesLoaded: false,
    industry: 'all',
    type: 'all',
    query: '',
    savedOnly: false,
    savedIds: readSavedIds(),
    activeResourceId: null,
    resourceReturnFocus: null,
    assistantReturnFocus: null,
    chatIndustry: 'all',
    chatMessages: [],
    chatLoading: false,
    aiConfigured: false,
    aiModel: '',
    toastTimer: null
  };

  const elements = {
    header: document.getElementById('site-header'),
    menuToggle: document.getElementById('menu-toggle'),
    mainNav: document.getElementById('main-nav'),
    heroSearch: document.getElementById('hero-search'),
    heroSearchInput: document.getElementById('hero-search-input'),
    librarySearchInput: document.getElementById('library-search-input'),
    clearSearch: document.getElementById('clear-search'),
    resourceGrid: document.getElementById('resource-grid'),
    emptyState: document.getElementById('empty-state'),
    resultsSummary: document.getElementById('results-summary'),
    resetFilters: document.getElementById('reset-filters'),
    savedFilter: document.getElementById('saved-filter'),
    savedCount: document.getElementById('saved-count'),
    resourceModal: document.getElementById('resource-modal'),
    resourceDialog: document.querySelector('.resource-dialog'),
    assistantOverlay: document.getElementById('assistant-overlay'),
    assistantPanel: document.querySelector('.assistant-panel'),
    assistantScroll: document.getElementById('chat-scroll'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    sendMessage: document.getElementById('send-message'),
    chatNotice: document.getElementById('chat-notice'),
    clearChat: document.getElementById('clear-chat'),
    toast: document.getElementById('toast'),
    navStatus: document.getElementById('nav-status'),
    apiStatusLight: document.getElementById('api-status-light'),
    apiStatusCopy: document.getElementById('api-status-copy'),
    chatStatusLight: document.getElementById('chat-status-light'),
    chatStatusCopy: document.getElementById('chat-status-copy'),
    dialogSave: document.getElementById('dialog-save'),
    askAboutResource: document.getElementById('ask-about-resource')
  };

  init();

  async function init() {
    bindGlobalEvents();
    updateSavedCount();
    setAssistantStatus('checking');
    await Promise.allSettled([loadResources(), loadStatus()]);
    setupSectionObserver();
  }

  function readSavedIds() {
    try {
      const value = JSON.parse(localStorage.getItem('industry-toolkit-saved') || '[]');
      return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
    } catch {
      return new Set();
    }
  }

  function persistSavedIds() {
    try {
      localStorage.setItem('industry-toolkit-saved', JSON.stringify([...state.savedIds]));
    } catch {
      showToast('浏览器未允许保存收藏');
    }
  }

  async function loadResources() {
    try {
      const response = await fetch('/api/resources', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.industries = Array.isArray(payload.industries) ? payload.industries : [];
      state.resources = Array.isArray(payload.resources) ? payload.resources : [];
      state.resourcesLoaded = true;

      const industryCounts = state.industries.reduce((counts, industry) => {
        counts[industry.id] = state.resources.filter((item) => item.industry === industry.id).length;
        return counts;
      }, {});
      setText('count-all', formatCount(state.resources.length));
      setText('count-food', formatCount(industryCounts.food || 0));
      setText('count-beauty', formatCount(industryCounts.beauty || 0));
      renderResources();
    } catch {
      state.resourcesLoaded = false;
      elements.resourceGrid.replaceChildren();
      const errorCard = document.createElement('div');
      errorCard.className = 'empty-state';
      errorCard.style.gridColumn = '1 / -1';
      const title = document.createElement('h3');
      title.textContent = '资料库加载失败';
      const copy = document.createElement('p');
      copy.textContent = '请确认本地服务正在运行，然后刷新页面。';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'button button-dark';
      retry.textContent = '重新加载';
      retry.addEventListener('click', () => window.location.reload());
      errorCard.append(title, copy, retry);
      elements.resourceGrid.append(errorCard);
      elements.resultsSummary.textContent = '资料库暂时不可用';
    }
  }

  async function loadStatus() {
    try {
      const response = await fetch('/api/status', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.aiConfigured = Boolean(payload.aiConfigured);
      state.aiModel = typeof payload.model === 'string' ? payload.model : '';
    } catch {
      state.aiConfigured = false;
      state.aiModel = '';
    }
    setAssistantStatus(state.aiConfigured ? 'ready' : 'offline');
  }

  function setAssistantStatus(status) {
    const ready = status === 'ready';
    const checking = status === 'checking';
    elements.navStatus.classList.toggle('is-ready', ready);
    elements.apiStatusLight.classList.toggle('is-ready', ready);
    elements.apiStatusLight.classList.toggle('is-offline', status === 'offline');
    elements.chatStatusLight.classList.toggle('is-ready', ready);
    elements.chatStatusLight.classList.toggle('is-offline', status === 'offline');

    const navLabel = ready ? 'AI 已配置' : checking ? 'AI 状态加载中' : 'AI 待配置';
    elements.navStatus.setAttribute('aria-label', navLabel);
    elements.apiStatusCopy.textContent = ready
      ? `AI 已配置${state.aiModel ? ` · ${state.aiModel}` : ''}`
      : checking
        ? '正在检查 AI 接入状态…'
        : 'API 待配置 · 阅读 README 接入';
    elements.chatStatusCopy.textContent = ready
      ? `已连接${state.aiModel ? ` · ${state.aiModel}` : ''}`
      : checking
        ? '正在检查接入状态'
        : 'API 待配置';

    if (checking) return;
    if (!ready) {
      elements.chatNotice.hidden = false;
      elements.chatNotice.innerHTML =
        '<strong>当前为界面预览。</strong> 请将 <code>.env.example</code> 复制为 <code>.env</code>，填写 API Key 与模型后重启服务。';
      elements.chatInput.disabled = true;
      elements.chatInput.placeholder = '配置 API 后即可对话';
      elements.sendMessage.disabled = true;
      elements.chatInput.style.height = '';
    } else {
      elements.chatNotice.hidden = true;
      elements.chatInput.disabled = false;
      elements.chatInput.placeholder = '描述你的门店问题…';
      elements.sendMessage.disabled = false;
    }
  }

  function formatCount(count) {
    return String(count).padStart(2, '0');
  }

  function matchesType(resource, type) {
    if (type === 'all') return true;
    if (type === '经营') {
      return ['方法论', '工具模板', '经营指南'].includes(resource.type);
    }
    return resource.type === type;
  }

  function getFilteredResources() {
    const query = state.query.trim().toLowerCase();
    return state.resources.filter((resource) => {
      const matchesIndustry = state.industry === 'all' || resource.industry === state.industry;
      const matchesResourceType = matchesType(resource, state.type);
      const matchesSaved = !state.savedOnly || state.savedIds.has(resource.id);
      const haystack = [
        resource.title,
        resource.summary,
        resource.type,
        resource.audience,
        resource.outcome,
        ...(resource.tags || [])
      ]
        .join(' ')
        .toLowerCase();
      return (
        matchesIndustry &&
        matchesResourceType &&
        matchesSaved &&
        (!query || haystack.includes(query))
      );
    });
  }

  function renderResources() {
    if (!state.resourcesLoaded) return;
    const filtered = getFilteredResources();
    elements.resourceGrid.replaceChildren();
    elements.resultsSummary.textContent = state.query
      ? `“${state.query}” 找到 ${filtered.length} 份资料`
      : `共 ${filtered.length} 份资料`;
    elements.clearSearch.hidden = !state.query;

    if (!filtered.length) {
      elements.emptyState.hidden = false;
      return;
    }

    elements.emptyState.hidden = true;
    const fragment = document.createDocumentFragment();
    filtered.forEach((resource, index) => fragment.append(createResourceCard(resource, index)));
    elements.resourceGrid.append(fragment);
  }

  function createResourceCard(resource, index) {
    const card = document.createElement('article');
    card.className = 'resource-card';
    card.dataset.industry = resource.industry;

    const top = document.createElement('div');
    top.className = 'card-top';
    const type = document.createElement('span');
    type.className = 'card-type';
    type.textContent = resource.type;
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'card-save';
    saveButton.dataset.saveResource = resource.id;
    saveButton.setAttribute('aria-label', '收藏资料');
    saveButton.setAttribute('aria-pressed', String(state.savedIds.has(resource.id)));
    saveButton.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-bookmark"></use></svg>';
    saveButton.classList.toggle('is-saved', state.savedIds.has(resource.id));
    top.append(type, saveButton);

    const sequence = document.createElement('span');
    sequence.className = 'card-sequence';
    sequence.textContent = String(index + 1).padStart(2, '0');

    const titleButton = document.createElement('button');
    titleButton.type = 'button';
    titleButton.className = 'card-title-button';
    titleButton.dataset.openResource = resource.id;
    titleButton.textContent = resource.title;

    const summary = document.createElement('p');
    summary.className = 'card-summary';
    summary.textContent = resource.summary;

    const tags = document.createElement('div');
    tags.className = 'card-tags';
    (resource.tags || []).slice(0, 3).forEach((tag) => {
      const item = document.createElement('span');
      item.textContent = tag;
      tags.append(item);
    });

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const meta = document.createElement('span');
    meta.textContent = `${resource.readTime} 分钟阅读 · ${getIndustryShortName(resource.industry)}`;
    const action = document.createElement('span');
    action.className = 'card-footer-action';
    action.innerHTML =
      '查看详情 <svg class="icon" aria-hidden="true"><use href="#icon-arrow-up-right"></use></svg>';
    footer.append(meta, action);

    card.append(top, sequence, titleButton, summary, tags, footer);
    return card;
  }

  function getIndustryShortName(id) {
    return id === 'beauty' ? '美业' : '餐饮';
  }

  function getIndustryName(id) {
    const industry = state.industries.find((item) => item.id === id);
    return industry ? industry.name : id === 'beauty' ? '美容美发' : '餐饮行业';
  }

  function setIndustry(industry) {
    if (!['all', 'food', 'beauty'].includes(industry)) return;
    state.industry = industry;
    document.querySelectorAll('.industry-tab').forEach((button) => {
      const active = button.dataset.industry === industry;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderResources();
  }

  function setType(type) {
    state.type = type;
    document.querySelectorAll('.type-filter').forEach((button) => {
      button.classList.toggle('active', button.dataset.type === type);
    });
    renderResources();
  }

  function updateQuery(query) {
    state.query = String(query || '').trim();
    elements.librarySearchInput.value = state.query;
    renderResources();
  }

  function searchAndScroll(term) {
    updateQuery(term);
    document.getElementById('library').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetFilters() {
    state.type = 'all';
    state.savedOnly = false;
    setIndustry('all');
    elements.savedFilter.setAttribute('aria-pressed', 'false');
    document.querySelectorAll('.type-filter').forEach((button) => {
      button.classList.toggle('active', button.dataset.type === 'all');
    });
    updateQuery('');
  }

  function toggleSaved(resourceId, forceValue) {
    const isSaved = state.savedIds.has(resourceId);
    const nextValue = typeof forceValue === 'boolean' ? forceValue : !isSaved;
    if (nextValue) state.savedIds.add(resourceId);
    else state.savedIds.delete(resourceId);
    persistSavedIds();
    updateSavedCount();
    syncSaveControls(resourceId);
    renderResources();
  }

  function syncSaveControls(resourceId) {
    const isSaved = state.savedIds.has(resourceId);
    document.querySelectorAll(`[data-save-resource="${cssEscape(resourceId)}"]`).forEach((button) => {
      button.classList.toggle('is-saved', isSaved);
      button.setAttribute('aria-pressed', String(isSaved));
      button.setAttribute('aria-label', isSaved ? '取消收藏资料' : '收藏资料');
    });
    if (state.activeResourceId === resourceId) {
      elements.dialogSave.classList.toggle('is-saved', isSaved);
      elements.dialogSave.setAttribute('aria-label', isSaved ? '取消收藏资料' : '收藏资料');
    }
  }

  function updateSavedCount() {
    elements.savedCount.textContent = String(state.savedIds.size);
  }

  function openResource(resourceId) {
    const resource = state.resources.find((item) => item.id === resourceId);
    if (!resource) return;
    if (!elements.assistantOverlay.hidden) closeAssistant();

    state.activeResourceId = resourceId;
    state.resourceReturnFocus = document.activeElement;
    setText('dialog-industry', getIndustryName(resource.industry));
    setText('dialog-type', resource.type);
    setText('resource-dialog-title', resource.title);
    setText('dialog-summary', resource.summary);
    setText('dialog-updated', `更新于 ${formatDate(resource.updatedAt)}`);

    const meta = document.getElementById('dialog-meta');
    meta.replaceChildren(
      createMetaItem('适用对象', resource.audience),
      createMetaItem('建议频率', resource.frequency),
      createMetaItem('预期产出', resource.outcome)
    );

    const tags = document.getElementById('dialog-tags');
    tags.replaceChildren(
      ...(resource.tags || []).map((tag) => {
        const span = document.createElement('span');
        span.textContent = tag;
        return span;
      })
    );

    setText('dialog-callout', resource.callout);
    renderSections(resource.sections || []);
    renderChecklist(resource.checklist || []);
    syncSaveControls(resource.id);

    elements.resourceModal.hidden = false;
    document.body.classList.add('no-scroll');
    requestAnimationFrame(() => elements.resourceDialog.focus());
  }

  function createMetaItem(label, value) {
    const wrapper = document.createElement('div');
    const heading = document.createElement('span');
    heading.textContent = label;
    const copy = document.createElement('strong');
    copy.textContent = value;
    wrapper.append(heading, copy);
    return wrapper;
  }

  function renderSections(sections) {
    const container = document.getElementById('dialog-sections');
    container.replaceChildren();
    sections.forEach((section) => {
      const article = document.createElement('section');
      article.className = 'dialog-section';
      const title = document.createElement('h3');
      title.textContent = section.title;
      article.append(title);
      (section.paragraphs || []).forEach((paragraph) => {
        const p = document.createElement('p');
        p.textContent = paragraph;
        article.append(p);
      });
      if (section.bullets && section.bullets.length) {
        const list = document.createElement('ul');
        section.bullets.forEach((item) => {
          const li = document.createElement('li');
          li.textContent = item;
          list.append(li);
        });
        article.append(list);
      }
      container.append(article);
    });
  }

  function renderChecklist(items) {
    const container = document.getElementById('dialog-checklist-items');
    container.replaceChildren(
      ...items.map((item) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'dialog-check-item';
        const mark = document.createElement('i');
        mark.textContent = '✓';
        const text = document.createElement('span');
        text.textContent = item;
        wrapper.append(mark, text);
        return wrapper;
      })
    );
  }

  function formatDate(value) {
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : value || '—';
  }

  function closeResource({ restoreFocus = true } = {}) {
    if (elements.resourceModal.hidden) return;
    elements.resourceModal.hidden = true;
    state.activeResourceId = null;
    if (!elements.assistantOverlay.hidden) return;
    document.body.classList.remove('no-scroll');
    if (restoreFocus && state.resourceReturnFocus instanceof HTMLElement) {
      state.resourceReturnFocus.focus();
    }
    state.resourceReturnFocus = null;
  }

  function openAssistant() {
    if (!elements.resourceModal.hidden) closeResource({ restoreFocus: false });
    state.assistantReturnFocus = document.activeElement;
    elements.assistantOverlay.hidden = false;
    document.body.classList.add('no-scroll');
    const initialIndustry = ['food', 'beauty'].includes(state.industry) ? state.industry : 'all';
    setChatIndustry(initialIndustry);
    requestAnimationFrame(() => {
      elements.assistantPanel.focus();
      if (state.aiConfigured) elements.chatInput.focus();
    });
  }

  function closeAssistant({ restoreFocus = true } = {}) {
    if (elements.assistantOverlay.hidden) return;
    elements.assistantOverlay.hidden = true;
    if (elements.resourceModal.hidden) document.body.classList.remove('no-scroll');
    if (restoreFocus && state.assistantReturnFocus instanceof HTMLElement) {
      state.assistantReturnFocus.focus();
    }
    state.assistantReturnFocus = null;
  }

  function setChatIndustry(industry) {
    state.chatIndustry = ['food', 'beauty', 'all'].includes(industry) ? industry : 'all';
    document.querySelectorAll('[data-chat-industry]').forEach((button) => {
      button.classList.toggle('active', button.dataset.chatIndustry === state.chatIndustry);
    });
  }

  function renderChat() {
    const scrollTop = elements.assistantScroll.scrollTop;
    elements.assistantScroll.replaceChildren();

    const divider = document.createElement('div');
    divider.className = 'chat-date-divider';
    const dividerText = document.createElement('span');
    dividerText.textContent = '今天';
    divider.append(dividerText);
    elements.assistantScroll.append(divider);

    appendAssistantMessage({
      content:
        '你好，我是行业 AI 助理。你可以告诉我门店类型、当前问题和已尝试的方法，我会结合站内资料帮你拆解下一步。',
      time: '现在',
      greeting: true
    });

    state.chatMessages.forEach((message) => {
      if (message.role === 'user') appendUserMessage(message.content);
      else appendAssistantMessage(message);
    });

    if (state.chatLoading) appendTypingMessage();

    if (!state.chatMessages.some((message) => message.role === 'user') && !state.chatLoading) {
      elements.assistantScroll.append(createSuggestions());
    }
    elements.assistantScroll.scrollTop = scrollTop === 0 ? elements.assistantScroll.scrollHeight : elements.assistantScroll.scrollHeight;
  }

  function appendAssistantMessage({ content, time = '现在', isError = false }) {
    const row = document.createElement('div');
    row.className = 'message-row assistant-row';
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-spark"></use></svg>';
    const contentWrap = document.createElement('div');
    contentWrap.className = 'message-content';
    const bubble = document.createElement('div');
    bubble.className = `message-bubble${isError ? ' message-error' : ''}`;
    bubble.append(renderMarkdown(content));
    const timeNode = document.createElement('span');
    timeNode.className = 'message-time';
    timeNode.textContent = time;
    contentWrap.append(bubble, timeNode);
    row.append(avatar, contentWrap);
    elements.assistantScroll.append(row);
  }

  function appendUserMessage(content) {
    const row = document.createElement('div');
    row.className = 'message-row user-row';
    const contentWrap = document.createElement('div');
    contentWrap.className = 'message-content';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const p = document.createElement('p');
    p.textContent = content;
    bubble.append(p);
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = '现在';
    contentWrap.append(bubble, time);
    row.append(contentWrap);
    elements.assistantScroll.append(row);
  }

  function appendTypingMessage() {
    const row = document.createElement('div');
    row.className = 'message-row assistant-row';
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-spark"></use></svg>';
    const contentWrap = document.createElement('div');
    contentWrap.className = 'message-content';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble typing-bubble';
    bubble.setAttribute('aria-label', 'AI 正在思考');
    bubble.innerHTML = '<i></i><i></i><i></i>';
    contentWrap.append(bubble);
    row.append(avatar, contentWrap);
    elements.assistantScroll.append(row);
    elements.assistantScroll.scrollTop = elements.assistantScroll.scrollHeight;
  }

  function createSuggestions() {
    const panel = document.createElement('div');
    panel.className = 'suggestion-panel';
    const label = document.createElement('span');
    label.textContent = '可以这样问';
    panel.append(label);
    const prompts = [
      '我们餐厅最近高峰期出餐慢、顾客催单多。请帮我定位瓶颈，给一份今天就能执行的改进清单。',
      '我想优化餐饮门店的食品安全日检。请根据站内资料，帮我设计一份适合店长每天使用的检查表。',
      '美容美发门店的顾客经常在服务结束后对效果有分歧。请帮我优化咨询确认流程，并列出服务前必须确认的信息。'
    ];
    prompts.forEach((prompt) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.prompt = prompt;
      button.innerHTML =
        `${escapeHTML(prompt.slice(0, 18))}… <svg class="icon" aria-hidden="true"><use href="#icon-arrow-up-right"></use></svg>`;
      panel.append(button);
    });
    return panel;
  }

  function renderMarkdown(text) {
    const fragment = document.createDocumentFragment();
    const blocks = String(text || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    blocks.forEach((block) => {
      const lines = block.split('\n').filter((line) => line.trim());
      if (!lines.length) return;
      if (/^#{1,4}\s+/.test(lines[0])) {
        const heading = document.createElement('h3');
        appendInline(heading, lines[0].replace(/^#{1,4}\s+/, '').replace(/^#+\s*/, ''));
        fragment.append(heading);
        const rest = lines.slice(1);
        if (rest.length) appendMarkdownLines(fragment, rest);
        return;
      }
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        const list = document.createElement('ul');
        lines.forEach((line) => {
          const item = document.createElement('li');
          appendInline(item, line.replace(/^[-*]\s+/, ''));
          list.append(item);
        });
        fragment.append(list);
        return;
      }
      if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
        const list = document.createElement('ol');
        lines.forEach((line) => {
          const item = document.createElement('li');
          appendInline(item, line.replace(/^\d+[.)]\s+/, ''));
          list.append(item);
        });
        fragment.append(list);
        return;
      }
      if (lines.every((line) => /^>\s?/.test(line))) {
        const quote = document.createElement('blockquote');
        lines.forEach((line) => {
          appendInline(quote, line.replace(/^>\s?/, ''));
          quote.append(document.createElement('br'));
        });
        fragment.append(quote);
        return;
      }
      appendMarkdownLines(fragment, lines);
    });

    if (!fragment.childNodes.length) {
      const p = document.createElement('p');
      p.textContent = String(text || '');
      fragment.append(p);
    }
    return fragment;
  }

  function appendMarkdownLines(fragment, lines) {
    const paragraph = document.createElement('p');
    lines.forEach((line, index) => {
      if (index > 0) paragraph.append(document.createElement('br'));
      appendInline(paragraph, line);
    });
    fragment.append(paragraph);
  }

  function appendInline(parent, text) {
    const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    parts.forEach((part) => {
      if (!part) return;
      if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.append(strong);
      } else if (part.startsWith('`') && part.endsWith('`')) {
        const code = document.createElement('code');
        code.textContent = part.slice(1, -1);
        parent.append(code);
      } else {
        parent.append(document.createTextNode(part));
      }
    });
  }

  async function sendChatMessage(messageOverride) {
    if (!state.aiConfigured || state.chatLoading) return;
    const content = String(messageOverride ?? elements.chatInput.value).trim();
    if (!content) return;
    if (content.length > 4000) {
      showToast('单条消息不能超过 4000 个字符');
      return;
    }

    state.chatMessages.push({ role: 'user', content });
    elements.chatInput.value = '';
    elements.chatInput.style.height = '';
    state.chatLoading = true;
    elements.sendMessage.disabled = true;
    renderChat();
    elements.assistantScroll.scrollTop = elements.assistantScroll.scrollHeight;

    const requestMessages = state.chatMessages
      .filter((message) => !message.isError)
      .slice(-MAX_CHAT_HISTORY)
      .map(({ role, content: text }) => ({
        role,
        content: text
      }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          messages: requestMessages,
          industry: state.chatIndustry
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getChatErrorMessage(response.status, payload.code, payload.error));
      }
      state.chatMessages.push({
        role: 'assistant',
        content: payload.message || 'AI 没有返回有效内容。',
        time: '现在'
      });
    } catch (error) {
      state.chatMessages.push({
        role: 'assistant',
        content: `暂时没能完成回答：${error.message || '请稍后再试。'}`,
        time: '发送失败',
        isError: true
      });
    } finally {
      state.chatLoading = false;
      elements.sendMessage.disabled = false;
      renderChat();
      elements.assistantScroll.scrollTop = elements.assistantScroll.scrollHeight;
      if (state.aiConfigured) elements.chatInput.focus();
    }
  }

  const MAX_CHAT_HISTORY = 10;

  function getChatErrorMessage(status, code, fallback) {
    const messages = {
      AI_NOT_CONFIGURED: 'AI 服务尚未配置，请填写 .env 后重启服务。',
      AI_AUTH_FAILED: 'API 认证失败，请检查 AI_API_KEY 是否正确。',
      AI_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
      AI_UPSTREAM_UNREACHABLE: '无法连接 AI 服务，请检查 AI_BASE_URL 和网络。',
      RATE_LIMITED: '请求过于频繁，请等待一分钟后再试。',
      CONVERSATION_TOO_LONG: '当前对话过长，请清空对话后重新开始。'
    };
    return messages[code] || fallback || `请求失败（HTTP ${status}）`;
  }

  function clearChat() {
    state.chatMessages = [];
    state.chatLoading = false;
    elements.sendMessage.disabled = !state.aiConfigured;
    renderChat();
    showToast('对话已清空');
    if (state.aiConfigured) elements.chatInput.focus();
  }

  function bindGlobalEvents() {
    document.querySelectorAll('[data-open-assistant]').forEach((button) => {
      button.addEventListener('click', openAssistant);
    });
    document.querySelectorAll('[data-close-assistant]').forEach((button) => {
      button.addEventListener('click', () => closeAssistant());
    });
    document.querySelectorAll('[data-close-resource]').forEach((button) => {
      button.addEventListener('click', () => closeResource());
    });

    elements.menuToggle.addEventListener('click', () => {
      const open = elements.mainNav.classList.toggle('is-open');
      elements.menuToggle.setAttribute('aria-expanded', String(open));
      elements.menuToggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    });

    elements.mainNav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        elements.mainNav.classList.remove('is-open');
        elements.menuToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    elements.heroSearch.addEventListener('submit', (event) => {
      event.preventDefault();
      searchAndScroll(elements.heroSearchInput.value);
    });

    document.querySelectorAll('[data-search-term]').forEach((button) => {
      button.addEventListener('click', () => searchAndScroll(button.dataset.searchTerm));
    });

    document.querySelector('.industry-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('[data-industry]');
      if (button) setIndustry(button.dataset.industry);
    });

    document.querySelector('.type-filters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-type]');
      if (button) setType(button.dataset.type);
    });

    elements.librarySearchInput.addEventListener('input', () => {
      updateQuery(elements.librarySearchInput.value);
    });

    elements.clearSearch.addEventListener('click', () => {
      updateQuery('');
      elements.librarySearchInput.focus();
    });

    elements.savedFilter.addEventListener('click', () => {
      state.savedOnly = !state.savedOnly;
      elements.savedFilter.setAttribute('aria-pressed', String(state.savedOnly));
      renderResources();
    });

    elements.resetFilters.addEventListener('click', resetFilters);

    elements.resourceGrid.addEventListener('click', (event) => {
      const openButton = event.target.closest('[data-open-resource]');
      if (openButton) {
        openResource(openButton.dataset.openResource);
        return;
      }
      const saveButton = event.target.closest('[data-save-resource]');
      if (saveButton) {
        event.stopPropagation();
        toggleSaved(saveButton.dataset.saveResource);
      }
    });

    elements.dialogSave.addEventListener('click', () => {
      if (state.activeResourceId) toggleSaved(state.activeResourceId);
    });

    elements.askAboutResource.addEventListener('click', () => {
      const resource = state.resources.find((item) => item.id === state.activeResourceId);
      if (!resource) return;
      closeResource({ restoreFocus: false });
      openAssistant();
      setChatIndustry(resource.industry);
      elements.chatInput.value = `请结合《${resource.title}》帮我拆解如何在我们门店落地。先向我确认最关键的 3 个背景问题。`;
      if (state.aiConfigured) {
        elements.chatInput.focus();
        autoResizeTextarea();
      }
    });

    document.querySelectorAll('[data-chat-industry]').forEach((button) => {
      button.addEventListener('click', () => setChatIndustry(button.dataset.chatIndustry));
    });

    elements.assistantScroll.addEventListener('click', (event) => {
      const promptButton = event.target.closest('[data-prompt]');
      if (promptButton) {
        elements.chatInput.value = promptButton.dataset.prompt;
        autoResizeTextarea();
        sendChatMessage(promptButton.dataset.prompt);
      }
    });

    elements.chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      sendChatMessage();
    });

    elements.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        elements.chatForm.requestSubmit();
      }
    });

    elements.chatInput.addEventListener('input', autoResizeTextarea);
    elements.clearChat.addEventListener('click', clearChat);

    document.addEventListener('keydown', handleKeydown);
  }

  function handleScroll() {
    elements.header.classList.toggle('is-scrolled', window.scrollY > 12);
  }

  function autoResizeTextarea() {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 130)}px`;
  }

  function handleKeydown(event) {
    const activeLayer = !elements.assistantOverlay.hidden
      ? elements.assistantOverlay
      : !elements.resourceModal.hidden
        ? elements.resourceModal
        : null;

    if (event.key === 'Escape') {
      if (!elements.assistantOverlay.hidden) {
        event.preventDefault();
        closeAssistant();
      } else if (!elements.resourceModal.hidden) {
        event.preventDefault();
        closeResource();
      }
      return;
    }

    if (event.key === 'Tab' && activeLayer) {
      trapFocus(event, activeLayer);
    }
  }

  function trapFocus(event, layer) {
    const focusable = [
      ...layer.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setupSectionObserver() {
    if (!('IntersectionObserver' in window)) return;
    const sectionMap = {
      home: 'a[href="#home"]',
      library: 'a[href="#library"]',
      assistant: 'a[href="/assistant.html"]',
      about: 'a[href="#about"]'
    };
    const links = [...document.querySelectorAll('.main-nav .nav-link')];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.remove('active'));
          const selector = sectionMap[entry.target.id];
          if (selector) document.querySelector(`.main-nav ${selector}`)?.classList.add('active');
        });
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 }
    );
    ['home', 'library', 'assistant', 'about'].forEach((id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2600);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
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
