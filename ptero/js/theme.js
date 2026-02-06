// js/theme.js
(function () {
  'use strict';

  const STORAGE_KEY = 'ptero_theme';
  const root = document.documentElement;

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);

    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;

    const icon = btn.querySelector('.theme-icon');
    const text = btn.querySelector('.theme-text');

    if (theme === 'light') {
      if (icon) icon.textContent = '☀️';
      if (text) text.textContent = 'Modo Escuro';
    } else {
      if (icon) icon.textContent = '🌙';
      if (text) text.textContent = 'Modo Claro';
    }
  }

  function getInitialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;

    // Preferência do sistema (quando disponível)
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTheme(getInitialTheme());

    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      setTheme(current === 'light' ? 'dark' : 'light');
    });
  });
})();
