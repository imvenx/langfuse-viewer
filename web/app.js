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
    // Sort chronologically by timestamp/createdAt
    traces.sort((a, b) => new Date(a.timestamp || a.createdAt || 0) - new Date(b.timestamp || b.createdAt || 0));
    const turns = [];
    const seenToolCalls = new Set();
    const seenToolMsgs = new Set();

    for (const t of traces) {
      const meta = { traceId: t.id, name: t.name, timestamp: t.timestamp || t.createdAt, provider: t.metadata?.ls_provider, model: t.metadata?.ls_model_name, raw: t };

      // Case 1: ChatOpenAI style: input: [{role, content}], output: {role, content}
      if (Array.isArray(t.input) && t.output && typeof t.output === 'object') {
        const lastUser = [...t.input].reverse().find(m => m && (m.role === 'user' || !m.role));
        if (lastUser?.content) turns.push({ role: lastUser.role || 'user', content: lastUser.content, meta });
        if (t.output?.content || t.output?.tool_calls || t.output?.toolCalls) {
          const tc = t.output?.tool_calls || t.output?.toolCalls || undefined;
          // Assistant message
          if (t.output?.content) {
            turns.push({ role: t.output.role || 'assistant', content: t.output.content, meta });
          }
          // Inline tool calls between assistant and next messages
          const toolTurns = normalizeToolCalls(tc, meta);
          for (const tt of toolTurns) turns.push(tt);
        }
        continue;
      }

      // Case 2: LangGraph style: input.messages[], output.messages[]
      const inMsgs = t.input?.messages;
      const outMsgs = t.output?.messages;
      if (Array.isArray(inMsgs) || Array.isArray(outMsgs)) {
        const lastUser = Array.isArray(inMsgs) && inMsgs.length ? inMsgs[inMsgs.length - 1] : null;
        if (lastUser?.content) turns.push({ role: 'user', content: pickContent(lastUser), meta });

        // Take only the last assistant answer to avoid giant repeats
        const lastAssistant = Array.isArray(outMsgs) && outMsgs.length ? outMsgs[outMsgs.length - 1] : null;
        if (lastAssistant?.content || lastAssistant?.tool_calls || lastAssistant?.toolCalls || lastAssistant?.lc_kwargs?.tool_calls) {
          const usage = lastAssistant?.usage_metadata || lastAssistant?.lc_kwargs?.usage_metadata || t.metadata?.usage;
          // Assistant message first
          if (lastAssistant?.content) turns.push({ role: 'assistant', content: pickContent(lastAssistant), usage, meta });
        }

        // Collect all tool calls present anywhere in outMsgs and add unseen ones inline
        if (Array.isArray(outMsgs)) {
          const allToolCalls = [];
          for (const m of outMsgs) {
            const toolCalls = extractToolCalls(m);
            if (toolCalls?.length) allToolCalls.push(...toolCalls);
          }
          const toolTurns = normalizeToolCalls(allToolCalls, meta, seenToolCalls);
          for (const tt of toolTurns) turns.push(tt);

          // Also render explicit tool role messages as results if unseen
          for (const m of outMsgs) {
            if (m?.role === 'tool' && m?.content) {
              const key = m.id || JSON.stringify({ c: m.content, n: m.name });
              if (seenToolMsgs.has(key)) continue;
              seenToolMsgs.add(key);
              turns.push({ role: 'tool', content: pickContent(m), toolCall: { name: m.name || 'tool_result' }, meta });
            }
          }
        }
        continue;
      }

      // Fallback: try generic input/output strings
      const inputStr = typeof t.input === 'string' ? t.input : undefined;
      if (inputStr) turns.push({ role: 'user', content: inputStr, meta });
      const outputStr = typeof t.output === 'string' ? t.output : undefined;
      if (outputStr) turns.push({ role: 'assistant', content: outputStr, meta });
    }

    // Compact repeated adjacent content from same role (common with frameworks)
    const compact = [];
    for (const m of turns) {
      const prev = compact[compact.length - 1];
      if (prev && prev.role === m.role && prev.content === m.content) continue;
      compact.push(m);
    }
    return compact;
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
      bubble.textContent = t.content;

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


  // Initial load
  load();
})();
