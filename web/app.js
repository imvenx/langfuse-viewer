(function () {
  const qs = (s) => document.querySelector(s);
  const limitEl = qs('#limit');
  const pageEl = qs('#page');
  const rowsEl = qs('#rows');
  const detailsEl = qs('#details');
  const chatEl = qs('#chat');
  const toggleRawBtn = qs('#toggle-raw');
  const summaryEl = qs('#summary');
  const loadBtn = qs('#load');
  const prevBtn = qs('#prev');
  const nextBtn = qs('#next');
  const setKeysBtn = qs('#set-keys');

  let state = { page: 1, limit: 50, totalPages: 1 };

  function setState(patch) {
    state = { ...state, ...patch };
    limitEl.value = state.limit;
    pageEl.value = state.page;
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= state.totalPages;
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    setState({ limit: Number(limitEl.value) || 50, page: Number(pageEl.value) || 1 });
    const url = `/api/sessions?limit=${encodeURIComponent(state.limit)}&page=${encodeURIComponent(state.page)}`;
    summaryEl.textContent = 'Loading…';
    try {
      const data = await fetchJSON(url);
      renderTable(data.data || []);
      setState({ totalPages: data?.meta?.totalPages || 1 });
      summaryEl.textContent = `Items ${data.data?.length ?? 0} • Page ${state.page} / ${state.totalPages}`;
    } catch (e) {
      console.error(e);
      summaryEl.textContent = 'Failed to load sessions.';
    }
  }

  function renderTable(items) {
    rowsEl.innerHTML = '';
    for (const item of items) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.createdAt || '')}</td>
        <td>${escapeHtml(item.environment || '')}</td>
      `;
      tr.onclick = () => loadDetails(item.id);
      rowsEl.appendChild(tr);
    }
  }

  async function loadDetails(id) {
    qs('#details-title').textContent = `Session: ${id}`;
    chatEl.textContent = 'Loading conversation…';
    detailsEl.textContent = 'Loading JSON…';
    try {
      const data = await fetchJSON(`/api/sessions/${encodeURIComponent(id)}`);
      // Raw JSON
      detailsEl.textContent = JSON.stringify(data, null, 2);
      // Render chat transcript
      const convo = buildConversationFromSession(data);
      renderChat(convo);
    } catch (e) {
      chatEl.textContent = 'Failed to load details.';
      detailsEl.textContent = 'Failed to load JSON.';
    }
  }

  function buildConversationFromSession(session) {
    const traces = Array.isArray(session?.traces) ? session.traces.slice() : [];
    if (!traces.length) return [];
    // Pick the latest trace as the canonical conversation to avoid duplicates across traces
    traces.sort((a, b) => new Date(a.updatedAt || a.timestamp || a.createdAt || 0) - new Date(b.updatedAt || b.timestamp || b.createdAt || 0));
    const t = traces[traces.length - 1];

    const turns = [];
    const seenToolCalls = new Set();
    const seenMessages = new Set();

    const meta = { traceId: t.id, name: t.name, timestamp: t.timestamp || t.createdAt, provider: t.metadata?.ls_provider, model: t.metadata?.ls_model_name, raw: t };

    // Build a set of known user inputs from ALL traces to better classify short messages like "asd"
    const userCorpus = new Set();
    for (const tr of traces) {
      // LangGraph style
      const im = tr?.input?.messages;
      if (Array.isArray(im)) {
        for (const m of im) {
          const c = pickContent(m);
          if (c) userCorpus.add(normalizeText(c));
        }
      }
      // ChatOpenAI style
      if (Array.isArray(tr?.input)) {
        for (const m of tr.input) {
          if ((m?.role === 'user' || !m?.role) && m?.content) userCorpus.add(normalizeText(m.content));
        }
      }
    }

    function messageKey(m, fallbackRole) {
      const role = m?.role || fallbackRole || 'assistant';
      const content = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content || '');
      return `${role}:${hashString(normalizeText(content))}`;
    }

    function pushTurn(turn, key) {
      if (key && seenMessages.has(key)) return;
      if (key) seenMessages.add(key);
      turns.push(turn);
    }

    function hashString(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return h.toString(36); }

    // Iterate output messages in order
    const outMsgs = Array.isArray(t.output?.messages) ? t.output.messages : [];
    for (const m of outMsgs) {
      if (!m) continue;
      const content = pickContent(m);
      const toolCalls = extractToolCalls(m);

      // Tool result messages
      if (m.role === 'tool' || m.tool_call_id || m.lc_direct_tool_output) {
        const key = messageKey({ role: 'tool', content }, 'tool');
        pushTurn({ role: 'tool', content, toolCall: { name: m.name || 'tool_result' }, meta }, key);
        continue;
      }

      // Assistant message that emits tool calls (content may be empty)
      if (toolCalls && toolCalls.length) {
        const key = messageKey({ role: 'assistant', content: content || '[tool calls]' }, 'assistant');
        if (content) pushTurn({ role: 'assistant', content, meta }, key);
        const toolTurns = normalizeToolCalls(toolCalls, meta, seenToolCalls);
        for (const tt of toolTurns) turns.push(tt);
        continue;
      }

      // Regular user or assistant message
      if (content) {
        const role = userCorpus.has(normalizeText(content)) ? 'user' : (m.role || 'assistant');
        const key = messageKey({ role, content }, role);
        pushTurn({ role, content, meta }, key);
        continue;
      }
    }

    // Also show any remaining top-level tool calls (rare), keeping de-dupe via normalizeToolCalls
    if (Array.isArray(t.output?.tool_calls) && t.output.tool_calls.length) {
      const extra = normalizeToolCalls(t.output.tool_calls, meta, seenToolCalls);
      for (const tt of extra) turns.push(tt);
    }

    // Compact adjacent identical bubbles
    const compact = [];
    for (const m of turns) {
      const prev = compact[compact.length - 1];
      if (prev && prev.role === m.role && prev.content === m.content) continue;
      compact.push(m);
    }
    return compact;
  }

  function normalizeText(s) {
    if (s == null) return '';
    return String(s)
      .replace(/\r\n/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .trim();
  }


  function normalizeToolCalls(toolCalls, meta, seen = new Set()) {
    const out = [];
    if (!Array.isArray(toolCalls) || !toolCalls.length) return out;
    for (const call of toolCalls) {
      // OpenAI function tool call shape
      const name = call.function?.name || call.name || call.tool_name || 'tool';
      let args = call.function?.arguments ?? call.arguments ?? call.input ?? call.params ?? '';
      const id = call.id || call.tool_call_id || call.function?.name + ':' + (typeof args === 'string' ? args : JSON.stringify(args));
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      if (typeof args !== 'string') args = JSON.stringify(args, null, 2);
      // Try to surface result if embedded (not common)
      const result = call.result ?? call.output ?? call.response;
      let preview = args;
      if (preview.length > 400) preview = preview.slice(0, 397) + '...';
      const content = result ? `${name}(${preview})\n→ ${typeof result === 'string' ? result : JSON.stringify(result).slice(0, 200)}` : `${name}(${preview})`;
      out.push({ role: 'tool', content, toolCall: call, meta });
    }
    return out;
  }

  function extractToolCalls(msg) {
    if (!msg || typeof msg !== 'object') return [];
    const arr = [];
    const pushAll = (v) => { if (Array.isArray(v)) arr.push(...v); };
    pushAll(msg.tool_calls);
    pushAll(msg.toolCalls);
    pushAll(msg.additional_kwargs?.tool_calls);
    pushAll(msg.response_metadata?.tool_calls);
    pushAll(msg.lc_kwargs?.tool_calls);
    return arr;
  }

  function pickContent(msg) {
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      // Some providers use array content (e.g., tool + text). Join text parts.
      return msg.content.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').filter(Boolean).join('\n');
    }
    // LangChain lc_kwargs.content fallback
    if (msg.lc_kwargs && typeof msg.lc_kwargs.content === 'string') return msg.lc_kwargs.content;
    return JSON.stringify(msg);
  }

  function renderChat(turns) {
    chatEl.innerHTML = '';
    if (!turns.length) {
      chatEl.textContent = 'No conversation turns parsed.';
      return;
    }
    for (const t of turns) {
      const wrap = document.createElement('div');
      wrap.className = `msg ${t.role}`;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const stamp = t.meta?.timestamp ? new Date(t.meta.timestamp).toLocaleString() : '';
      const model = t.role === 'tool' ? (t.toolCall?.function?.name || t.toolCall?.name || 'tool') : (t.meta?.model || t.meta?.name || '');
      meta.textContent = [t.role.toUpperCase(), model, stamp].filter(Boolean).join(' • ');

      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const maybeJson = parseJsonIfLikely(t.content);
      if (maybeJson) {
        bubble.textContent = 'JSON payload';
        const det = document.createElement('details');
        det.className = 'tools';
        const sum = document.createElement('summary');
        sum.textContent = 'View JSON';
        const pre = document.createElement('pre');
        pre.className = 'code';
        pre.textContent = JSON.stringify(maybeJson, null, 2);
        det.appendChild(sum);
        det.appendChild(pre);
        bubble.appendChild(det);
      } else {
        bubble.textContent = t.content;
      }

      wrap.appendChild(meta);
      wrap.appendChild(bubble);

      if (t.toolCalls || t.toolCall || t.usage || t.meta) {
        const det = document.createElement('details');
        det.className = 'tools';
        const sum = document.createElement('summary');
        sum.textContent = 'Details';
        det.appendChild(sum);
        const pre = document.createElement('pre');
        pre.className = 'code';
        const payload = { tool_call: t.toolCall, tool_calls: t.toolCalls, usage: t.usage, meta: { model: t.meta?.model, provider: t.meta?.provider, traceId: t.meta?.traceId, name: t.meta?.name, timestamp: t.meta?.timestamp } };
        pre.textContent = JSON.stringify(payload, null, 2);
        det.appendChild(pre);
        wrap.appendChild(det);
      }

      chatEl.appendChild(wrap);
    }
  }

  toggleRawBtn.onclick = () => {
    const d = document.querySelector('details.raw');
    d.open = !d.open;
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  loadBtn.onclick = () => load();
  prevBtn.onclick = () => { if (state.page > 1) { setState({ page: state.page - 1 }); load(); } };
  nextBtn.onclick = () => { if (state.page < state.totalPages) { setState({ page: state.page + 1 }); load(); } };

  // Show Set Keys button if running in desktop (Electron) with bridge
  if (window.appBridge && typeof window.appBridge.openSetup === 'function') {
    setKeysBtn.style.display = '';
    setKeysBtn.onclick = () => {
      window.appBridge.openSetup();
    };
    if (typeof window.appBridge.onKeysUpdated === 'function') {
      window.appBridge.onKeysUpdated(() => {
        // Re-load current page of sessions after keys update
        load();
      });
    }
  }


  // Initial load
  load();
  
  function parseJsonIfLikely(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (!(s.startsWith('{') || s.startsWith('['))) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
})();
