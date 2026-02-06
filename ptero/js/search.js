// js/search.js
(function () {
  'use strict';

  const searchData = [
    { title: "Início", section: "home" },
    { title: "Visão Geral", section: "visao-geral" },
    { title: "Instalação Panel", section: "instalacao-panel" },
    { title: "Instalação Wings", section: "instalacao-wings" },
    { title: "Config Proxy", section: "configuracao-proxy" },
    { title: "Config Backend", section: "configuracao-backend" },
    { title: "Segurança", section: "seguranca" },
    { title: "Custos", section: "custos" },
    { title: "FAQ", section: "faq" },
    { title: "Monitoramento", section: "monitoramento" },
    { title: "Backup", section: "backup" },
    { title: "Links Úteis", section: "links" }
  ];

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function renderResults(container, results) {
    container.innerHTML = '';
    if (!results.length) {
      container.classList.add('hidden');
      return;
    }

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.margin = '0.5rem 0 0';
    ul.style.padding = '0';
    ul.style.border = '1px solid var(--border-color)';
    ul.style.borderRadius = '8px';
    ul.style.overflow = 'hidden';
    ul.style.background = 'var(--bg-card)';
    ul.style.boxShadow = 'var(--shadow)';

    results.slice(0, 8).forEach((r) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = r.title;
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.padding = '0.75rem 0.9rem';
      btn.style.border = 'none';
      btn.style.background = 'transparent';
      btn.style.color = 'var(--text-primary)';
      btn.style.cursor = 'pointer';
      btn.addEventListener('mouseenter', () => (btn.style.background = 'var(--bg-tertiary)'));
      btn.addEventListener('mouseleave', () => (btn.style.background = 'transparent'));
      btn.addEventListener('click', () => {
        const nav = document.querySelector(`.nav-item[data-section="${r.section}"]`);
        if (nav) nav.click();
        container.classList.add('hidden');
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });

    container.appendChild(ul);
    container.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('search-input');
    const button = document.getElementById('search-button');
    const resultsEl = document.getElementById('search-results');

    if (!input || !button || !resultsEl) return;

    function runSearch() {
      const q = normalize(input.value).trim();
      if (!q) {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
        return;
      }
      const results = searchData.filter((item) => normalize(item.title).includes(q));
      renderResults(resultsEl, results);
    }

    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSearch();
      } else if (e.key === 'Escape') {
        resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
      }
    });

    button.addEventListener('click', runSearch);

    document.addEventListener('click', (e) => {
      if (!resultsEl.contains(e.target) && e.target !== input && e.target !== button) {
        resultsEl.classList.add('hidden');
      }
    });
  });
})();
