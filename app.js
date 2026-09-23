(() => {
  'use strict';

  const STORAGE_KEY = 'todo_list.tasks.v1';
  const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  const $ = (sel) => document.querySelector(sel);
  const form = $('#task-form');
  const titleInput = $('#task-title');
  const categoryInput = $('#task-category');
  const priorityInput = $('#task-priority');
  const dueInput = $('#task-due');
  const list = $('#task-list');
  const empty = $('#empty');
  const summary = $('#summary');
  const template = $('#task-template');
  const searchInput = $('#search');
  const categoryFilter = $('#filter-category');
  const sortSelect = $('#sort');

  const state = {
    tasks: load(),
    status: 'all',
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch {
      // ストレージが使えない環境ではメモリ上だけで動作する
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDue(due) {
    if (!due) return '';
    const today = todayStr();
    const [, m, d] = due.split('-');
    const label = `${Number(m)}/${Number(d)}`;
    if (due === today) return `今日 (${label})`;
    const diff = Math.round((new Date(due) - new Date(today)) / 86400000);
    if (diff === 1) return `明日 (${label})`;
    if (diff < 0) return `${label}（${-diff}日超過）`;
    return `${label}（あと${diff}日）`;
  }

  function addTasks(items) {
    const now = Date.now();
    items.forEach(({ title, category, priority, due }, i) => {
      state.tasks.push({
        id: newId(),
        title,
        category,
        priority,
        due: due || null,
        done: false,
        createdAt: now + i,
      });
    });
    save();
    render();
  }

  function updateTask(id, changes) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    Object.assign(task, changes);
    save();
    render();
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id);
    save();
    render();
  }

  function visibleTasks() {
    const q = searchInput.value.trim().toLowerCase();
    const cat = categoryFilter.value;
    const sort = sortSelect.value;

    const filtered = state.tasks.filter((t) => {
      if (state.status === 'active' && t.done) return false;
      if (state.status === 'done' && !t.done) return false;
      if (cat !== 'all' && t.category !== cat) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });

    const byDue = (a, b) => {
      if (a.due === b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    };
    const byPriority = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const byCreated = (a, b) => a.createdAt - b.createdAt;

    const chain = {
      due: [byDue, byPriority, byCreated],
      priority: [byPriority, byDue, byCreated],
      created: [byCreated],
    }[sort];

    return filtered.sort((a, b) => {
      // 未完了を常に上に
      if (a.done !== b.done) return a.done ? 1 : -1;
      for (const cmp of chain) {
        const r = cmp(a, b);
        if (r !== 0) return r;
      }
      return 0;
    });
  }

  function render() {
    const today = todayStr();
    list.replaceChildren();

    for (const task of visibleTasks()) {
      const node = template.content.firstElementChild.cloneNode(true);
      const overdue = !task.done && task.due && task.due < today;

      node.dataset.id = task.id;
      node.dataset.priority = task.priority;
      node.classList.toggle('done', task.done);
      node.classList.toggle('overdue', overdue);

      node.querySelector('.task-check').checked = task.done;
      node.querySelector('.task-title').textContent = task.title;
      node.querySelector('.category').textContent = task.category;

      const pr = node.querySelector('.priority');
      pr.textContent = `優先度: ${PRIORITY_LABEL[task.priority]}`;
      pr.classList.add(task.priority);

      const due = node.querySelector('.due');
      if (task.due) {
        due.textContent = `期限: ${formatDue(task.due)}`;
        due.classList.toggle('overdue', overdue);
        due.classList.toggle('today', !task.done && task.due === today);
      }

      list.appendChild(node);
    }

    empty.hidden = list.children.length > 0;

    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.done).length;
    const overdueCount = state.tasks.filter((t) => !t.done && t.due && t.due < today).length;
    summary.textContent = total === 0
      ? 'タスクを追加してみましょう'
      : `全${total}件 ・ 未完了${total - done}件 ・ 完了${done}件` +
        (overdueCount ? ` ・ 期限切れ${overdueCount}件` : '');
  }

  function startEdit(li) {
    const titleEl = li.querySelector('.task-title');
    const id = li.dataset.id;
    const original = titleEl.textContent;

    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.getSelection().selectAllChildren(titleEl);

    const finish = (commit) => {
      titleEl.removeEventListener('blur', onBlur);
      titleEl.removeEventListener('keydown', onKey);
      titleEl.contentEditable = 'false';
      const value = titleEl.textContent.trim();
      if (commit && value && value !== original) {
        updateTask(id, { title: value });
      } else {
        titleEl.textContent = original;
      }
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    titleEl.addEventListener('blur', onBlur);
    titleEl.addEventListener('keydown', onKey);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    addTasks([{ title, category: categoryInput.value, priority: priorityInput.value, due: dueInput.value }]);
    titleInput.value = '';
    dueInput.value = '';
    titleInput.focus();
  });

  list.addEventListener('change', (e) => {
    if (!e.target.classList.contains('task-check')) return;
    const li = e.target.closest('.task');
    updateTask(li.dataset.id, { done: e.target.checked });
  });

  list.addEventListener('click', (e) => {
    const li = e.target.closest('.task');
    if (!li) return;
    if (e.target.closest('.delete')) {
      const task = state.tasks.find((t) => t.id === li.dataset.id);
      if (task && confirm(`「${task.title}」を削除しますか？`)) deleteTask(task.id);
    } else if (e.target.closest('.edit')) {
      startEdit(li);
    }
  });

  list.addEventListener('dblclick', (e) => {
    if (e.target.classList.contains('task-title')) startEdit(e.target.closest('.task'));
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.status = tab.dataset.status;
      render();
    });
  });

  searchInput.addEventListener('input', render);
  categoryFilter.addEventListener('change', render);
  sortSelect.addEventListener('change', render);

  $('#clear-done').addEventListener('click', () => {
    const count = state.tasks.filter((t) => t.done).length;
    if (count === 0) return;
    if (!confirm(`完了済みのタスク${count}件を削除しますか？`)) return;
    state.tasks = state.tasks.filter((t) => !t.done);
    save();
    render();
  });

  // ---- 写真から追加 ----
  const photoInput = $('#photo-input');
  const ocrDialog = $('#ocr-dialog');
  const ocrPreview = $('#ocr-preview');
  const ocrStatus = $('#ocr-status');
  const ocrStatusText = $('#ocr-status-text');
  const ocrProgress = $('#ocr-progress');
  const ocrError = $('#ocr-error');
  const ocrResult = $('#ocr-result');
  const ocrCandidates = $('#ocr-candidates');
  const ocrConfirm = $('#ocr-confirm');
  let ocrRun = 0;

  function candidateRow({ title, due }) {
    const li = document.createElement('li');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = true;
    check.setAttribute('aria-label', '追加する');
    const text = document.createElement('input');
    text.type = 'text';
    text.value = title;
    text.maxLength = 200;
    text.setAttribute('aria-label', 'タスク名');
    const date = document.createElement('input');
    date.type = 'date';
    date.value = due || '';
    date.setAttribute('aria-label', '期限');
    li.append(check, text, date);
    return li;
  }

  function updateConfirm() {
    let count = 0;
    for (const li of ocrCandidates.children) {
      const [check, text] = li.querySelectorAll('input');
      li.classList.toggle('unchecked', !check.checked);
      if (check.checked && text.value.trim()) count++;
    }
    ocrConfirm.disabled = count === 0;
    ocrConfirm.textContent = count ? `${count}件を追加` : '追加';
  }

  async function readPhoto(file) {
    const run = ++ocrRun;
    if (ocrPreview.src) URL.revokeObjectURL(ocrPreview.src);
    ocrPreview.src = URL.createObjectURL(file);
    ocrStatus.hidden = false;
    ocrStatusText.textContent = '準備中…';
    ocrProgress.removeAttribute('value');
    ocrError.hidden = true;
    ocrResult.hidden = true;
    ocrCandidates.replaceChildren();
    updateConfirm();
    ocrDialog.showModal();

    try {
      const text = await window.TaskOCR.recognize(file, (label, progress) => {
        if (run !== ocrRun) return;
        ocrStatusText.textContent = `${label}… ${Math.round(progress * 100)}%`;
        ocrProgress.value = progress;
      });
      if (run !== ocrRun) return;
      const candidates = window.TaskOCR.parseTasks(text);
      ocrStatus.hidden = true;
      ocrResult.hidden = false;
      if (candidates.length === 0) {
        ocrError.textContent = '文字を読み取れませんでした。明るい場所で、文字が大きく写るように撮り直すか、下の「行を追加」から手入力してください。';
        ocrError.hidden = false;
      }
      ocrCandidates.append(...candidates.map(candidateRow));
      updateConfirm();
    } catch (err) {
      if (run !== ocrRun) return;
      ocrStatus.hidden = true;
      ocrError.textContent = err && err.message ? err.message : '読み取りに失敗しました。';
      ocrError.hidden = false;
    }
  }

  $('#photo-btn').addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    photoInput.value = '';
    if (file) readPhoto(file);
  });

  ocrCandidates.addEventListener('input', updateConfirm);

  $('#ocr-add-line').addEventListener('click', () => {
    const li = candidateRow({ title: '', due: null });
    ocrCandidates.appendChild(li);
    ocrError.hidden = true;
    li.querySelector('input[type="text"]').focus();
    updateConfirm();
  });

  ocrConfirm.addEventListener('click', () => {
    const items = [];
    for (const li of ocrCandidates.children) {
      const [check, text, date] = li.querySelectorAll('input');
      const title = text.value.trim();
      if (!check.checked || !title) continue;
      items.push({ title, category: categoryInput.value, priority: priorityInput.value, due: date.value });
    }
    if (items.length) addTasks(items);
    ocrDialog.close();
  });

  // 閉じたら進行中の読み取り結果は捨てる
  ocrDialog.addEventListener('close', () => { ocrRun++; });

  render();
})();
