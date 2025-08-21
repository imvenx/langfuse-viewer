(function () {
  const qs = (s) => document.querySelector(s);
  const limitEl = qs('#limit');
  const pageEl = qs('#page');
  const rowsEl = qs('#rows');
  const detailsEl = qs('#details');
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
    detailsEl.textContent = 'Loading details…';
    try {
      const data = await fetchJSON(`/api/sessions/${encodeURIComponent(id)}`);
      detailsEl.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
      detailsEl.textContent = 'Failed to load details.';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  loadBtn.onclick = () => load();
  prevBtn.onclick = () => { if (state.page > 1) { setState({ page: state.page - 1 }); load(); } };
  nextBtn.onclick = () => { if (state.page < state.totalPages) { setState({ page: state.page + 1 }); load(); } };

  // Initial load
  load();
})();

