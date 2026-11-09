'use strict';

// Keep in sync with DEFAULTS in content.js.
const DEFAULTS = {
  enabled: true,
  hideCarousels: true,
  blockPlayer: true,
  hideNavTab: true,
  hideAllVideoPosts: false,
};

const master = document.getElementById('enabled');
const options = [...document.querySelectorAll('input[data-key]')];
const status = document.getElementById('status');
const count = document.getElementById('count');
const reset = document.getElementById('reset');

function reflectMaster() {
  const on = master.checked;
  document.body.classList.toggle('off', !on);
  options.forEach((input) => (input.disabled = !on));
  status.textContent = on ? 'On for LinkedIn' : 'Paused';
}

function renderCount(n) {
  n = n || 0;
  count.textContent = n === 0 ? 'Nothing blocked yet' : `${n.toLocaleString()} blocked so far`;
  reset.hidden = n === 0;
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  master.checked = s.enabled;
  options.forEach((input) => (input.checked = !!s[input.dataset.key]));
  reflectMaster();
});

master.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: master.checked });
  reflectMaster();
});

options.forEach((input) =>
  input.addEventListener('change', () => {
    chrome.storage.sync.set({ [input.dataset.key]: input.checked });
  })
);

chrome.storage.local.get({ blockedCount: 0 }, (v) => renderCount(v.blockedCount));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.blockedCount) renderCount(changes.blockedCount.newValue);
});

reset.addEventListener('click', () => chrome.storage.local.set({ blockedCount: 0 }));
