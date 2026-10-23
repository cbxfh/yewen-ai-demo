'use strict';

(() => {
  const MAX_FILES_PER_IMPORT = 20;
  const MAX_FILE_BYTES = 500 * 1024;
  const MAX_DOCUMENT_CHARS = 250000;
  const MAX_SELECTED_DOCS = 6;
  const MAX_DOCUMENT_CONTEXT_CHARS = 12000;
  const MAX_TOTAL_CONTEXT_CHARS = 24000;
  const SELECTED_STORAGE_PREFIX = 'industry-ai-selected-documents';
  const ACCEPTED_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm']);

  const state = {
    user: null,
    api: null,
    localConfigAllowed: false,
    documents: [],
    selectedIds: new Set(),
    knowledgeQuery: '',
    chatMessages: [],
    chatLoading: false,
    chatIndustry: 'all',
    activeModal: null,
    modalReturnFocus: null,
    toastTimer: null
  };

  const elements = {
    authLoading: document.getElementById('auth-loading'),
    currentUsername: document.getElementById('current-username'),
    userAvatar: document.getElementById('user-avatar'),
    logoutUser: document.getElementById('logout-user'),
    headerApiDot: document.getElementById('header-api-dot'),
    chatApiDot: document.getElementById('chat-api-dot'),
    chatApiStatus: document.getElementById('chat-api-status'),
    chatConfigNotice: document.getElementById('chat-config-notice'),
    openApiSettings: document.getElementById('open-api-settings'),
    welcomeApiConfig: document.getElementById('welcome-api-config'),
    noticeApiConfig: document.getElementById('notice-api-config'),
    settingsModal: document.getElementById('api-settings-modal'),
    settingsDialog: document.querySelector('.settings-dialog'),
    settingsForm: document.getElementById('api-settings-form'),
    settingsStatusCard: document.getElementById('settings-status-card'),
    settingsApiDot: document.getElementById('settings-api-dot'),
    settingsStatusTitle: document.getElementById('settings-status-title'),
    settingsStatusCopy: document.getElementById('settings-status-copy'),
    apiBaseUrl: document.getElementById('api-base-url'),
    apiModel: document.getElementById('api-model'),
    apiKey: document.getElementById('api-key'),
    apiMaxTokens: document.getElementById('api-max-tokens'),
    apiKeyHelp: document.getElementById('api-key-help'),
    localConfigNote: document.getElementById('local-config-note'),
    saveApiConfig: document.getElementById('save-api-config'),
    testApiConfig: document.getElementById('test-api-config'),
    clearApiConfig: document.getElementById('clear-api-config'),
    fileInput: document.getElementById('file-input'),
    chooseFiles: document.getElementById('choose-files'),
    welcomeImport: document.getElementById('welcome-import'),
    dropZone: document.getElementById('drop-zone'),
    openPaste: document.getElementById('open-paste'),
    pasteModal: document.getElementById('paste-modal'),
    pasteDialog: document.querySelector('.paste-dialog'),
    pasteForm: document.getElementById('paste-form'),
    pasteTitle: document.getElementById('paste-title-input'),
    pasteContent: document.getElementById('paste-content-input'),
    previewModal: document.getElementById('preview-modal'),
    previewDialog: document.querySelector('.preview-dialog'),
    previewTitle: document.getElementById('preview-title'),
    previewMeta: document.getElementById('preview-meta'),
    previewContent: document.getElementById('preview-content'),
    knowledgePanel: document.getElementById('knowledge-panel'),
    knowledgeBackdrop: document.getElementById('knowledge-backdrop'),
    openKnowledgePanel: document.getElementById('open-knowledge-panel'),
    closeKnowledgePanel: document.getElementById('close-knowledge-panel'),
    manageContext: document.getElementById('manage-context'),
    knowledgeSearch: document.getElementById('knowledge-search'),
    selectAllKnowledge: document.getElementById('select-all-knowledge'),
    knowledgeList: document.getElementById('knowledge-list'),
    clearAllKnowledge: document.getElementById('clear-all-knowledge'),
    selectedDocCount: document.getElementById('selected-doc-count'),
    selectedCharCount: document.getElementById('selected-char-count'),
    contextMeterFill: document.getElementById('context-meter-fill'),
    activeContextText: document.getElementById('active-context-text'),
    contextSendHint: document.getElementById('context-send-hint'),
    chatStream: document.getElementById('chat-stream'),
    welcomeBlock: document.getElementById('welcome-block'),
    chatForm: document.getElementById('workspace-chat-form'),
    chatInput: document.getElementById('workspace-chat-input'),
    sendButton: document.getElementById('workspace-send'),
    clearChat: document.getElementById('clear-chat'),
    toast: document.getElementById('toast')
  };

  init();

  async function init() {
    bindEvents();
    const authenticated = await loadAuthSession();
    if (!authenticated) return;
    state.selectedIds = readSelectedIds(state.user.id);
    await Promise.allSettled([loadApiStatus(), loadDocuments(), loadChatHistory()]);
    renderKnowledge();
    updateContextSummary();
    renderChatState();
    elements.authLoading.hidden = true;

    if (shouldOpenSettings()) openSettings();
  }

  function bindEvents() {
    elements.logoutUser.addEventListener('click', logout);
    elements.openApiSettings.addEventListener('click', openSettings);
    elements.welcomeApiConfig.addEventListener('click', openSettings);
    elements.noticeApiConfig.addEventListener('click', openSettings);
    document.querySelectorAll('[data-close-settings]').forEach((element) => {
      element.addEventListener('click', () => closeModal(elements.settingsModal));
    });
    elements.settingsForm.addEventListener('submit', saveSettings);
    elements.testApiConfig.addEventListener('click', testCurrentSettings);
    elements.clearApiConfig.addEventListener('click', clearSettings);

    elements.chooseFiles.addEventListener('click', () => elements.fileInput.click());
    elements.welcomeImport.addEventListener('click', () => {
      if (window.innerWidth <= 900) openKnowledgePanel();
      elements.fileInput.click();
    });
    elements.fileInput.addEventListener('change', () => importFiles([...elements.fileInput.files]));
    elements.dropZone.addEventListener('dragenter', handleDragEnter);
    elements.dropZone.addEventListener('dragover', handleDragEnter);
    elements.dropZone.addEventListener('dragleave', handleDragLeave);
    elements.dropZone.addEventListener('drop', handleDrop);

    elements.openPaste.addEventListener('click', openPasteModal);
    document.querySelectorAll('[data-close-paste]').forEach((element) => {
      element.addEventListener('click', () => closeModal(elements.pasteModal));
    });
    elements.pasteForm.addEventListener('submit', savePastedDocument);
    document.querySelectorAll('[data-close-preview]').forEach((element) => {
      element.addEventListener('click', () => closeModal(elements.previewModal));
    });

    elements.knowledgeSearch.addEventListener('input', () => {
      state.knowledgeQuery = elements.knowledgeSearch.value.trim().toLowerCase();
      renderKnowledge();
    });
    elements.selectAllKnowledge.addEventListener('click', toggleSelectAll);
    elements.knowledgeList.addEventListener('click', handleKnowledgeClick);
    elements.clearAllKnowledge.addEventListener('click', clearAllDocuments);

    elements.openKnowledgePanel.addEventListener('click', openKnowledgePanel);
    elements.closeKnowledgePanel.addEventListener('click', closeKnowledgePanel);
    elements.manageContext.addEventListener('click', openKnowledgePanel);
    elements.knowledgeBackdrop.addEventListener('click', closeKnowledgePanel);

    document.querySelectorAll('[data-chat-industry]').forEach((button) => {
      button.addEventListener('click', () => setChatIndustry(button.dataset.chatIndustry));
    });
    document.querySelectorAll('[data-starter-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        elements.chatInput.value = button.dataset.starterPrompt;
        autoResizeComposer();
        if (!state.api || !state.api.aiConfigured) {
          openSettings();
          return;
        }
        elements.chatInput.focus();
      });
    });
    elements.chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      sendChatMessage();
    });
    elements.chatInput.addEventListener('keydown', handleComposerKeydown);
    elements.chatInput.addEventListener('input', autoResizeComposer);
    elements.clearChat.addEventListener('click', clearChat);

    document.addEventListener('keydown', handleGlobalKeydown);
  }

  async function loadAuthSession() {
    try {
      const response = await fetch('/api/auth/session', {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('无法读取登录状态');
      const payload = await response.json();
      if (!payload.authenticated || !payload.user) {
        redirectToLogin();
        return false;
      }
      state.user = payload.user;
      elements.currentUsername.textContent = payload.user.username;
      elements.userAvatar.textContent = payload.user.username.slice(0, 1).toUpperCase();
      return true;
    } catch {
      elements.authLoading.querySelector('strong').textContent = '账号验证失败';
      elements.authLoading.querySelector('p').textContent = '请刷新页面；如果问题持续，请检查服务是否运行。';
      return false;
    }
  }

  function redirectToLogin() {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login.html?next=${encodeURIComponent(next)}`);
  }

  async function logout() {
    elements.logoutUser.disabled = true;
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
    } finally {
      window.location.replace('/login.html');
    }
  }

  function shouldOpenSettings() {
    const params = new URLSearchParams(window.location.search);
    return params.get('settings') === '1' || window.location.hash === '#api-settings';
  }

  async function loadApiStatus() {
    try {
      const response = await fetch('/api/status', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.api = payload;
      state.localConfigAllowed = Boolean(payload.localConfigAllowed);
      applyApiStatus(payload);
    } catch {
      state.api = { aiConfigured: false, localConfigAllowed: false };
      state.localConfigAllowed = false;
      applyApiStatus(state.api);
      showToast('无法读取 API 状态，请确认本地服务正在运行');
    }
  }

  function applyApiStatus(status) {
    const configured = Boolean(status.aiConfigured);
    elements.headerApiDot.className = `api-status-dot${configured ? ' is-ready' : ' is-error'}`;
    elements.chatApiDot.className = `api-status-dot${configured ? ' is-ready' : ' is-error'}`;
    elements.settingsApiDot.className = `api-status-dot${configured ? ' is-ready' : ' is-error'}`;
    elements.headerApiDot.setAttribute(
      'aria-label',
      configured ? 'API 已连接' : 'API 尚未配置'
    );

    const sourceText =
      status.configSource === 'environment'
        ? '由环境变量管理'
        : status.configSource === 'local'
          ? '本机配置'
          : '尚未配置';
    elements.chatApiStatus.textContent = configured
      ? `已连接 · ${status.model || '模型已配置'} · ${sourceText}`
      : 'API 尚未配置';
    elements.settingsStatusTitle.textContent = configured ? 'AI 服务可以对话' : '还没有配置 AI 服务';
    elements.settingsStatusCopy.textContent = configured
      ? `${status.model || '已配置模型'}${status.apiHost ? ` · ${status.apiHost}` : ''} · ${sourceText}`
      : '填写 API 地址、模型和密钥后即可启用对话。';
    const apiSetupStep = elements.welcomeApiConfig.closest('.setup-step');
    const importSetupStep = elements.welcomeImport.closest('.setup-step');
    elements.openApiSettings.hidden = !state.localConfigAllowed;
    apiSetupStep.hidden = !state.localConfigAllowed;
    importSetupStep.querySelector(':scope > span').textContent = state.localConfigAllowed ? '02' : '01';

    elements.chatConfigNotice.hidden = configured;
    elements.chatInput.disabled = !configured || state.chatLoading;
    elements.sendButton.disabled = !configured || state.chatLoading;
    elements.chatInput.placeholder = configured
      ? '输入一个门店问题，或让 AI 分析你选中的资料…'
      : '请先完成 API 设置';

    if (!configured && !state.localConfigAllowed) {
      elements.chatConfigNotice.querySelector('strong').textContent = 'AI 服务暂时不可用';
      elements.chatConfigNotice.querySelector('span').textContent =
        '站点服务端尚未配置 AI 服务，请联系站点管理员。';
      elements.noticeApiConfig.hidden = true;
      elements.chatInput.placeholder = 'AI 服务暂时不可用';
    } else {
      elements.chatConfigNotice.querySelector('strong').textContent = '还差一步就能开始对话';
      elements.chatConfigNotice.querySelector('span').textContent =
        '完成 API 设置后，AI 助手即可结合你的知识库回答问题。';
      elements.noticeApiConfig.hidden = false;
    }
  }

  async function openSettings() {
    openModal(elements.settingsModal, elements.settingsDialog);
    await refreshSettingsForm();
  }

  async function refreshSettingsForm() {
    if (!state.localConfigAllowed) {
      elements.settingsStatusTitle.textContent = '当前不是本机访问';
      elements.settingsStatusCopy.textContent =
        '为避免远程修改 API 密钥，网页设置只允许从 127.0.0.1 或 localhost 打开。部署环境请使用 .env。';
      elements.settingsForm.querySelectorAll('input, button').forEach((element) => {
        element.disabled = true;
      });
      return;
    }

    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '无法读取本机配置');
      elements.apiBaseUrl.value = payload.baseUrl || '';
      elements.apiModel.value = payload.model || '';
      elements.apiMaxTokens.value = payload.maxTokens || 1200;
      elements.apiKey.value = '';
      elements.apiKeyHelp.textContent = payload.hasApiKey
        ? '已保存密钥。留空会保持原值，输入新值则替换。'
        : '密钥只提交给本机服务端，不会返回到浏览器。';
      elements.settingsForm
        .querySelectorAll('input, button')
        .forEach((element) => {
          element.disabled = false;
        });

      if (payload.source === 'environment') {
        elements.settingsStatusTitle.textContent = '配置由 .env 管理';
        elements.settingsStatusCopy.textContent =
          '当前配置来自环境变量。网页展示只读信息；如需修改，请编辑 .env 并重启服务。';
        [elements.apiBaseUrl, elements.apiModel, elements.apiMaxTokens, elements.saveApiConfig, elements.clearApiConfig].forEach(
          (element) => {
            element.disabled = true;
          }
        );
      }
    } catch (error) {
      elements.settingsStatusTitle.textContent = '读取配置失败';
      elements.settingsStatusCopy.textContent = error.message;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    await persistSettings({ closeAfter: false, showSuccess: true });
  }

  async function persistSettings({ closeAfter = false, showSuccess = false } = {}) {
    if (!state.localConfigAllowed) {
      showToast('请在本机打开页面后配置 API');
      return false;
    }
    const formData = new FormData(elements.settingsForm);
    const payload = {
      baseUrl: String(formData.get('baseUrl') || '').trim(),
      model: String(formData.get('model') || '').trim(),
      apiKey: String(formData.get('apiKey') || '').trim(),
      maxTokens: Number(formData.get('maxTokens')) || 1200
    };
    setSettingsBusy(true);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '保存 API 配置失败');
      await loadApiStatus();
      elements.apiKey.value = '';
      if (showSuccess) showToast('API 配置已保存');
      if (closeAfter) closeModal(elements.settingsModal);
      return true;
    } catch (error) {
      showToast(error.message);
      return false;
    } finally {
      setSettingsBusy(false);
    }
  }

  async function testCurrentSettings() {
    if (state.api && state.api.configSource !== 'environment') {
      const saved = await persistSettings({ closeAfter: false, showSuccess: false });
      if (!saved) return;
    }
    setSettingsBusy(true);
    elements.settingsStatusTitle.textContent = '正在测试连接';
    elements.settingsStatusCopy.textContent = '服务端正在向模型供应商发送一条极短测试请求…';
    try {
      const response = await fetch('/api/config/test', {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '连接测试失败');
      elements.settingsApiDot.className = 'api-status-dot is-ready';
      elements.settingsStatusTitle.textContent = '连接测试成功';
      elements.settingsStatusCopy.textContent = `模型：${result.model || '已配置'} · 已收到有效回复`;
      showToast('API 连接测试成功');
    } catch (error) {
      elements.settingsApiDot.className = 'api-status-dot is-error';
      elements.settingsStatusTitle.textContent = '连接测试失败';
      elements.settingsStatusCopy.textContent = error.message;
      showToast(error.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function clearSettings() {
    if (!state.localConfigAllowed) return;
    if (!window.confirm('确定清除保存在本机的 API 地址、模型和密钥吗？')) return;
    try {
      const response = await fetch('/api/config', {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '清除配置失败');
      elements.apiBaseUrl.value = '';
      elements.apiModel.value = '';
      elements.apiKey.value = '';
      await loadApiStatus();
      await refreshSettingsForm();
      showToast('本机 API 配置已清除');
    } catch (error) {
      showToast(error.message);
    }
  }

  function setSettingsBusy(busy) {
    [elements.saveApiConfig, elements.testApiConfig, elements.clearApiConfig].forEach((button) => {
      button.disabled = busy;
    });
  }

  function setChatIndustry(industry) {
    state.chatIndustry = ['all', 'food', 'beauty'].includes(industry) ? industry : 'all';
    document.querySelectorAll('[data-chat-industry]').forEach((button) => {
      button.classList.toggle('active', button.dataset.chatIndustry === state.chatIndustry);
    });
  }

  function handleDragEnter(event) {
    event.preventDefault();
    elements.dropZone.classList.add('is-dragging');
  }

  function handleDragLeave(event) {
    if (event.target === elements.dropZone) elements.dropZone.classList.remove('is-dragging');
  }

  function handleDrop(event) {
    event.preventDefault();
    elements.dropZone.classList.remove('is-dragging');
    importFiles([...event.dataTransfer.files]);
  }

  async function importFiles(files) {
    if (!files.length) return;
    if (files.length > MAX_FILES_PER_IMPORT) {
      showToast(`一次最多导入 ${MAX_FILES_PER_IMPORT} 个文件`);
      files = files.slice(0, MAX_FILES_PER_IMPORT);
    }

    elements.chooseFiles.disabled = true;
    let imported = 0;
    const errors = [];
    for (const file of files) {
      try {
        const documentInput = await parseFile(file);
        const document = await uploadDocument(documentInput);
        state.documents.push(document);
        if (state.selectedIds.size < MAX_SELECTED_DOCS) state.selectedIds.add(document.id);
        imported += 1;
      } catch (error) {
        errors.push(`${file.name}：${error.message}`);
      }
    }
    persistSelectedIds();
    state.documents.sort(sortDocuments);
    renderKnowledge();
    updateContextSummary();
    elements.fileInput.value = '';
    elements.chooseFiles.disabled = false;

    if (imported) {
      showToast(`已导入 ${imported} 份资料${errors.length ? `，${errors.length} 份失败` : ''}`);
      if (window.innerWidth <= 900) closeKnowledgePanel();
    } else {
      showToast(errors[0] || '没有可导入的资料');
    }
    if (errors.length) console.warn('[knowledge-import]', errors);
  }

  async function parseFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      throw new Error('暂不支持此格式');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error('文件不能超过 500KB');
    }
    let content = await file.text();
    if (extension === 'html' || extension === 'htm') {
      content = extractHTMLText(content);
    } else if (extension === 'json') {
      try {
        content = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        // Keep malformed JSON source available as plain text for review.
      }
    }
    content = normalizeDocumentContent(content);
    if (!content) throw new Error('文件没有可读取的文本');
    if (content.length > MAX_DOCUMENT_CHARS) {
      throw new Error(`文本超过 ${MAX_DOCUMENT_CHARS.toLocaleString()} 字`);
    }
    return {
      name: file.name,
      type: extension === 'htm' ? 'html' : extension,
      content,
      size: file.size
    };
  }

  function extractHTMLText(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script, style, noscript, iframe, svg').forEach((node) => node.remove());
    return parsed.body.innerText || parsed.body.textContent || '';
  }

  function normalizeDocumentContent(content) {
    return String(content || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  async function savePastedDocument(event) {
    event.preventDefault();
    const name = elements.pasteTitle.value.trim();
    const content = normalizeDocumentContent(elements.pasteContent.value);
    if (!name || !content) {
      showToast('请填写资料名称和内容');
      return;
    }
    if (content.length > MAX_DOCUMENT_CHARS) {
      showToast(`文本不能超过 ${MAX_DOCUMENT_CHARS.toLocaleString()} 字`);
      return;
    }
    try {
      const document = await uploadDocument({ name, type: 'pasted', content });
      state.documents.push(document);
      if (state.selectedIds.size < MAX_SELECTED_DOCS) state.selectedIds.add(document.id);
      persistSelectedIds();
      state.documents.sort(sortDocuments);
      renderKnowledge();
      updateContextSummary();
      elements.pasteForm.reset();
      closeModal(elements.pasteModal);
      showToast('资料已保存到个人知识库');
    } catch (error) {
      showToast(error.message || '保存资料失败');
    }
  }

  async function uploadDocument(documentInput) {
    const response = await fetch('/api/knowledge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(documentInput)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      redirectToLogin();
      throw new Error('登录已过期，请重新登录');
    }
    if (!response.ok) throw new Error(payload.error || '保存资料失败');
    return payload.document;
  }

  function sortDocuments(a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  }

  function renderKnowledge() {
    const query = state.knowledgeQuery;
    const filtered = state.documents.filter((document) => {
      return !query || document.name.toLowerCase().includes(query);
    });
    elements.knowledgeList.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'knowledge-empty';
      const title = document.createElement('strong');
      title.textContent = state.documents.length ? '没有匹配的资料' : '还没有个人资料';
      const copy = document.createElement('p');
      copy.textContent = state.documents.length
        ? '换一个名称继续搜索。'
        : '先导入一份门店制度、会议纪要或产品说明。';
      empty.append(title, copy);
      elements.knowledgeList.append(empty);
      elements.selectAllKnowledge.textContent = '全选';
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((document) => fragment.append(createKnowledgeItem(document)));
    elements.knowledgeList.append(fragment);
    updateSelectAllButton(filtered);
  }

  function createKnowledgeItem(knowledgeDocument) {
    const selected = state.selectedIds.has(knowledgeDocument.id);
    const item = document.createElement('article');
    item.className = `knowledge-item${selected ? ' is-selected' : ''}`;
    item.dataset.documentId = knowledgeDocument.id;

    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'document-check';
    check.dataset.selectDocument = knowledgeDocument.id;
    check.setAttribute('aria-label', selected ? '取消选择资料' : '选择资料');
    check.setAttribute('aria-pressed', String(selected));
    check.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-check"></use></svg>';

    const main = document.createElement('div');
    main.className = 'document-main';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'document-title';
    title.dataset.previewDocument = knowledgeDocument.id;
    title.textContent = knowledgeDocument.name;
    title.title = knowledgeDocument.name;
    const meta = document.createElement('div');
    meta.className = 'document-meta';
    const type = document.createElement('span');
    type.className = 'document-type';
    type.textContent = knowledgeDocument.type.toUpperCase();
    const chars = document.createElement('span');
    chars.textContent = `${knowledgeDocument.charCount.toLocaleString()} 字`;
    meta.append(type, chars);
    main.append(title, meta);

    const tools = document.createElement('div');
    tools.className = 'document-tools';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'document-tool';
    preview.dataset.previewDocument = knowledgeDocument.id;
    preview.setAttribute('aria-label', '预览资料');
    preview.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-eye"></use></svg>';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'document-tool';
    remove.dataset.deleteDocument = knowledgeDocument.id;
    remove.setAttribute('aria-label', '删除资料');
    remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-trash"></use></svg>';
    tools.append(preview, remove);

    item.append(check, main, tools);
    return item;
  }

  function handleKnowledgeClick(event) {
    const select = event.target.closest('[data-select-document]');
    if (select) {
      toggleDocumentSelection(select.dataset.selectDocument);
      return;
    }
    const preview = event.target.closest('[data-preview-document]');
    if (preview) {
      openPreview(preview.dataset.previewDocument);
      return;
    }
    const remove = event.target.closest('[data-delete-document]');
    if (remove) deleteDocument(remove.dataset.deleteDocument);
  }

  function toggleDocumentSelection(documentId) {
    if (state.selectedIds.has(documentId)) {
      state.selectedIds.delete(documentId);
    } else {
      if (state.selectedIds.size >= MAX_SELECTED_DOCS) {
        showToast(`AI 单次最多参考 ${MAX_SELECTED_DOCS} 份资料`);
        return;
      }
      state.selectedIds.add(documentId);
    }
    persistSelectedIds();
    renderKnowledge();
    updateContextSummary();
  }

  function toggleSelectAll() {
    const visible = state.documents.filter((document) => {
      return !state.knowledgeQuery || document.name.toLowerCase().includes(state.knowledgeQuery);
    });
    const allSelected = visible.length > 0 && visible.every((document) => state.selectedIds.has(document.id));
    if (allSelected) {
      visible.forEach((document) => state.selectedIds.delete(document.id));
    } else {
      state.selectedIds = new Set(visible.slice(0, MAX_SELECTED_DOCS).map((document) => document.id));
      if (visible.length > MAX_SELECTED_DOCS) {
        showToast(`已选择前 ${MAX_SELECTED_DOCS} 份资料`);
      }
    }
    persistSelectedIds();
    renderKnowledge();
    updateContextSummary();
  }

  function updateSelectAllButton(visible = state.documents) {
    const allSelected = visible.length > 0 && visible.every((document) => state.selectedIds.has(document.id));
    elements.selectAllKnowledge.textContent = allSelected ? '取消全选' : '全选';
  }

  async function openPreview(documentId) {
    const metadata = state.documents.find((item) => item.id === documentId);
    if (!metadata) return;
    elements.previewTitle.textContent = metadata.name;
    elements.previewMeta.textContent = `${metadata.type.toUpperCase()} · ${metadata.charCount.toLocaleString()} 字 · 导入于 ${formatDate(metadata.createdAt)}`;
    elements.previewContent.textContent = '正在读取账号资料…';
    openModal(elements.previewModal, elements.previewDialog);
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(documentId)}`, {
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || '资料读取失败');
      const document = payload.document;
      const maxPreview = 30000;
      elements.previewContent.textContent =
        document.content.length > maxPreview
          ? `${document.content.slice(0, maxPreview)}\n\n… 预览已截取，完整内容仍保存在你的账号空间。`
          : document.content;
    } catch (error) {
      elements.previewContent.textContent = error.message || '资料读取失败';
    }
  }

  async function deleteDocument(documentId) {
    const document = state.documents.find((item) => item.id === documentId);
    if (!document) return;
    if (!window.confirm(`确定从你的账号中删除《${document.name}》吗？`)) return;
    try {
      const response = await fetch(`/api/knowledge/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || '删除资料失败');
      state.documents = state.documents.filter((item) => item.id !== documentId);
      state.selectedIds.delete(documentId);
      persistSelectedIds();
      renderKnowledge();
      updateContextSummary();
      showToast('资料已删除');
    } catch (error) {
      showToast(error.message || '删除资料失败');
    }
  }

  async function clearAllDocuments() {
    if (!state.documents.length) return;
    if (!window.confirm('确定清空当前账号中的全部个人资料吗？此操作无法撤销。')) return;
    try {
      const response = await fetch('/api/knowledge', {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || '清空知识库失败');
      state.documents = [];
      state.selectedIds.clear();
      persistSelectedIds();
      renderKnowledge();
      updateContextSummary();
      showToast('个人知识库已清空');
    } catch (error) {
      showToast(error.message || '清空知识库失败');
    }
  }

  function buildKnowledgeContext() {
    const selectedDocuments = state.documents.filter((document) => state.selectedIds.has(document.id));
    let remaining = MAX_TOTAL_CONTEXT_CHARS;
    let totalChars = 0;
    let truncated = false;
    const documents = [];

    for (const document of selectedDocuments) {
      if (remaining <= 0 || documents.length >= MAX_SELECTED_DOCS) {
        truncated = true;
        break;
      }
      const allowance = Math.min(MAX_DOCUMENT_CONTEXT_CHARS, remaining, document.charCount);
      if (allowance <= 0) continue;
      documents.push({ id: document.id, name: document.name, charCount: allowance });
      totalChars += allowance;
      remaining -= allowance;
      if (allowance < document.charCount) truncated = true;
    }

    return { documents, ids: documents.map((document) => document.id), totalChars, truncated };
  }

  function updateContextSummary() {
    const context = buildKnowledgeContext();
    const selectedCount = state.selectedIds.size;
    elements.selectedDocCount.textContent = `已选 ${selectedCount} 份`;
    elements.selectedCharCount.textContent = `${context.totalChars.toLocaleString()} / ${MAX_TOTAL_CONTEXT_CHARS.toLocaleString()} 字`;
    const percentage = Math.min(100, (context.totalChars / MAX_TOTAL_CONTEXT_CHARS) * 100);
    elements.contextMeterFill.style.width = `${percentage}%`;
    elements.contextMeterFill.classList.toggle(
      'is-full',
      context.truncated || context.totalChars >= MAX_TOTAL_CONTEXT_CHARS
    );

    if (!selectedCount) {
      elements.activeContextText.textContent = '当前使用站内专业资料';
      elements.contextSendHint.textContent = '当前未选择个人资料';
    } else {
      const truncatedText = context.truncated ? ' · 已按长度截取' : '';
      elements.activeContextText.textContent = `将参考 ${context.documents.length} 份个人资料 · ${context.totalChars.toLocaleString()} 字${truncatedText}`;
      elements.contextSendHint.textContent = `将发送 ${context.documents.length} 份资料摘录`;
    }
  }

  function openKnowledgePanel() {
    if (!elements.knowledgePanel.classList.contains('is-open')) {
      state.modalReturnFocus = document.activeElement;
    }
    elements.knowledgePanel.classList.add('is-open');
    elements.knowledgeBackdrop.hidden = false;
    requestAnimationFrame(() => elements.closeKnowledgePanel.focus());
  }

  function closeKnowledgePanel() {
    elements.knowledgePanel.classList.remove('is-open');
    elements.knowledgeBackdrop.hidden = true;
    if (state.modalReturnFocus instanceof HTMLElement) state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  function openPasteModal() {
    elements.pasteModal.hidden = false;
    saveActiveModal(elements.pasteModal, elements.pasteDialog);
  }

  function openModal(modal, dialog) {
    if (!modal.hidden) return;
    state.modalReturnFocus = document.activeElement;
    modal.hidden = false;
    state.activeModal = modal;
    requestAnimationFrame(() => dialog.focus());
  }

  function saveActiveModal(modal, dialog) {
    state.modalReturnFocus = document.activeElement;
    state.activeModal = modal;
    requestAnimationFrame(() => dialog.focus());
  }

  function closeModal(modal) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    if (state.activeModal === modal) state.activeModal = null;
    if (state.modalReturnFocus instanceof HTMLElement) state.modalReturnFocus.focus();
    state.modalReturnFocus = null;
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape') {
      const visibleModal = [elements.settingsModal, elements.pasteModal, elements.previewModal].find(
        (modal) => !modal.hidden
      );
      if (visibleModal) {
        event.preventDefault();
        closeModal(visibleModal);
        return;
      }
      if (elements.knowledgePanel.classList.contains('is-open')) {
        event.preventDefault();
        closeKnowledgePanel();
      }
      return;
    }

    if (event.key === 'Tab') {
      const modal = [elements.settingsModal, elements.pasteModal, elements.previewModal].find(
        (candidate) => !candidate.hidden
      );
      if (modal) trapFocus(event, modal);
      else if (elements.knowledgePanel.classList.contains('is-open') && window.innerWidth <= 900) {
        trapFocus(event, elements.knowledgePanel);
      }
    }
  }

  function trapFocus(event, container) {
    const focusable = [
      ...container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  function handleComposerKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  }

  function autoResizeComposer() {
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 180)}px`;
  }

  async function sendChatMessage() {
    if (!state.api || !state.api.aiConfigured) {
      openSettings();
      return;
    }
    if (state.chatLoading) return;
    const content = elements.chatInput.value.trim();
    if (!content) return;
    if (content.length > 4000) {
      showToast('单条消息不能超过 4,000 字');
      return;
    }

    const knowledgeContext = buildKnowledgeContext();
    state.chatMessages.push({ role: 'user', content, knowledgeCount: knowledgeContext.documents.length });
    elements.chatInput.value = '';
    elements.chatInput.style.height = '';
    state.chatLoading = true;
    elements.chatInput.disabled = true;
    elements.sendButton.disabled = true;
    hideWelcome();
    appendUserMessage(content, knowledgeContext.documents.length);
    const typing = appendTypingMessage();
    scrollChatToBottom();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          message: content,
          industry: state.chatIndustry,
          knowledgeIds: knowledgeContext.ids
        })
      });
      const payload = await response.json().catch(() => ({}));
      typing.remove();
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) {
        throw new Error(getChatErrorMessage(response.status, payload.code, payload.error));
      }
      const assistantMessage = {
        role: 'assistant',
        content: payload.message || 'AI 没有返回有效内容。',
        knowledgeCount: knowledgeContext.documents.length
      };
      state.chatMessages.push(assistantMessage);
      appendAssistantMessage(assistantMessage);
    } catch (error) {
      typing.remove();
      const errorMessage = {
        role: 'assistant',
        content: `暂时没能完成回答：${error.message || '请稍后再试。'}`,
        isError: true
      };
      state.chatMessages.push(errorMessage);
      appendAssistantMessage(errorMessage);
    } finally {
      state.chatLoading = false;
      elements.chatInput.disabled = !state.api.aiConfigured;
      elements.sendButton.disabled = !state.api.aiConfigured;
      scrollChatToBottom();
      if (state.api.aiConfigured) elements.chatInput.focus();
    }
  }

  function getChatErrorMessage(status, code, fallback) {
    const messages = {
      AI_NOT_CONFIGURED: 'API 尚未配置，请打开“API 设置”。',
      AI_AUTH_FAILED: 'API 认证失败，请检查 API Key 是否正确。',
      AI_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
      AI_UPSTREAM_UNREACHABLE: '无法连接 AI 服务，请检查 API 地址和网络。',
      RATE_LIMITED: '请求过于频繁，请等待一分钟后再试。',
      DAILY_LIMIT_REACHED: '今日公开 AI 使用额度已用完，请明天再试。',
      USER_DAILY_LIMIT_REACHED: '今日个人 AI 使用额度已用完，请明天再试。',
      AUTH_REQUIRED: '登录已过期，请重新登录。',
      CONVERSATION_TOO_LONG: '当前对话较长，请清空对话后重新开始。',
      KNOWLEDGE_TOO_LONG: '选中的个人资料过长，请减少资料或缩短内容。'
    };
    return messages[code] || fallback || `请求失败（HTTP ${status}）`;
  }

  function hideWelcome() {
    if (!elements.welcomeBlock.hidden) elements.welcomeBlock.hidden = true;
  }

  function appendUserMessage(content, knowledgeCount) {
    const row = document.createElement('div');
    row.className = 'message user-message';
    const main = document.createElement('div');
    main.className = 'message-main';
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = '你';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const paragraph = document.createElement('p');
    paragraph.textContent = content;
    bubble.append(paragraph);
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = knowledgeCount ? `已附加 ${knowledgeCount} 份个人资料` : '使用站内专业资料';
    main.append(label, bubble, meta);
    row.append(main);
    elements.chatStream.append(row);
  }

  function appendAssistantMessage(message) {
    const row = document.createElement('div');
    row.className = `message assistant-message${message.isError ? ' message-error' : ''}`;
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-spark"></use></svg>';
    const main = document.createElement('div');
    main.className = 'message-main';
    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = '行业 AI 助手';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.append(renderMarkdown(message.content));
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const time = document.createElement('span');
    time.textContent = '刚刚';
    meta.append(time);
    if (message.knowledgeCount) {
      const chip = document.createElement('span');
      chip.className = 'context-source-chip';
      chip.textContent = `参考 ${message.knowledgeCount} 份个人资料`;
      meta.append(chip);
    }
    main.append(label, bubble, meta);
    row.append(avatar, main);
    elements.chatStream.append(row);
  }

  function appendTypingMessage() {
    const row = document.createElement('div');
    row.className = 'message assistant-message';
    const avatar = document.createElement('span');
    avatar.className = 'message-avatar';
    avatar.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-spark"></use></svg>';
    const main = document.createElement('div');
    main.className = 'message-main';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble typing-bubble';
    bubble.setAttribute('aria-label', 'AI 正在思考');
    bubble.innerHTML = '<i></i><i></i><i></i>';
    main.append(bubble);
    row.append(avatar, main);
    elements.chatStream.append(row);
    return row;
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
        appendInline(heading, lines[0].replace(/^#{1,4}\s+/, ''));
        fragment.append(heading);
        if (lines.length > 1) appendMarkdownLines(fragment, lines.slice(1));
        return;
      }
      if (lines.length >= 2 && lines[0].includes('|') && /^\|?[\s:-]+\|/.test(lines[1])) {
        fragment.append(renderMarkdownTable(lines));
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
      const paragraph = document.createElement('p');
      paragraph.textContent = String(text || '');
      fragment.append(paragraph);
    }
    return fragment;
  }

  function renderMarkdownTable(lines) {
    const rows = lines.map((line) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
    );
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    rows[0].forEach((cell) => {
      const th = document.createElement('th');
      appendInline(th, cell);
      headRow.append(th);
    });
    head.append(headRow);
    const body = document.createElement('tbody');
    rows.slice(2).forEach((cells) => {
      const row = document.createElement('tr');
      cells.forEach((cell) => {
        const td = document.createElement('td');
        appendInline(td, cell);
        row.append(td);
      });
      body.append(row);
    });
    table.append(head, body);
    return table;
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

  async function clearChat() {
    if (!state.chatMessages.length) {
      showToast('当前没有对话记录');
      return;
    }
    try {
      const response = await fetch('/api/chat/history', {
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || '清空对话失败');
      state.chatMessages = [];
      state.chatLoading = false;
      const preservedWelcome = elements.welcomeBlock;
      elements.chatStream.replaceChildren(preservedWelcome);
      preservedWelcome.hidden = false;
      applyApiStatus(state.api || {});
      showToast('对话已清空');
    } catch (error) {
      showToast(error.message || '清空对话失败');
    }
  }

  function renderChatState() {
    if (!state.chatMessages.length) return;
    hideWelcome();
    state.chatMessages.forEach((message) => {
      if (message.role === 'user') appendUserMessage(message.content, 0);
      else if (message.role === 'assistant') appendAssistantMessage(message);
    });
    scrollChatToBottom();
  }

  function hideWelcomeIfMessages() {
    if (state.chatMessages.length) elements.welcomeBlock.hidden = true;
  }

  function scrollChatToBottom() {
    requestAnimationFrame(() => {
      elements.chatStream.scrollTop = elements.chatStream.scrollHeight;
    });
  }

  async function loadDocuments() {
    try {
      const response = await fetch('/api/knowledge', {
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || '无法读取账号知识库');
      state.documents = Array.isArray(payload.documents) ? payload.documents : [];
      state.documents.sort(sortDocuments);
      const existingIds = new Set(state.documents.map((document) => document.id));
      state.selectedIds = new Set([...state.selectedIds].filter((id) => existingIds.has(id)));
      persistSelectedIds();
    } catch (error) {
      state.documents = [];
      showToast(error.message || '无法读取账号知识库');
    }
  }

  async function loadChatHistory() {
    try {
      const response = await fetch('/api/chat/history', {
        headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        redirectToLogin();
        return;
      }
      if (!response.ok) throw new Error(payload.error || '无法读取对话记录');
      state.chatMessages = Array.isArray(payload.messages) ? payload.messages : [];
    } catch (error) {
      state.chatMessages = [];
      showToast(error.message || '无法读取对话记录');
    }
  }

  function readSelectedIds(userId) {
    try {
      const key = `${SELECTED_STORAGE_PREFIX}:${userId}`;
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  function persistSelectedIds() {
    if (!state.user) return;
    try {
      const key = `${SELECTED_STORAGE_PREFIX}:${state.user.id}`;
      localStorage.setItem(key, JSON.stringify([...state.selectedIds]));
    } catch {
      // Selection persistence is optional; documents remain in the account storage.
    }
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3200);
  }
})();
