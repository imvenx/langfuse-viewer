(function () {
  const $ = (s) => document.querySelector(s);
  const f = $('#f');
  const pub = $('#pub');
  const sec = $('#sec');
  const err = $('#err');

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const publicKey = pub.value.trim();
    const secretKey = sec.value.trim();
    if (!publicKey || !secretKey) {
      err.textContent = 'Both keys are required.';
      return;
    }
    try {
      await window.appBridge.saveKeys(publicKey, secretKey);
      window.close();
    } catch (e) {
      err.textContent = 'Failed to save keys: ' + (e?.message || e);
    }
  });
})();

