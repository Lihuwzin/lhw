// js/scrollspy.js
(function () {
  'use strict';

  const contentEl = document.querySelector('main.content');
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const sections = Array.from(document.querySelectorAll('.content-section'));
  const tocList = document.getElementById('toc-list');
  const currentSectionEl = document.getElementById('current-section');

  let tocObserver = null;

  function slugify(text) {
    return (text || '')
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  function setBreadcrumb(sectionTitle) {
    if (currentSectionEl) currentSectionEl.textContent = sectionTitle || 'Início';
  }

  function setActiveNav(sectionId) {
    navItems.forEach((i) => i.classList.toggle('active', i.dataset.section === sectionId));
  }

  function showSection(sectionId) {
    sections.forEach((s) => s.classList.toggle('active', s.id === sectionId));
  }

  function scrollContentToTop() {
    if (!contentEl) return;
    contentEl.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function ensureHeadingIds(headings) {
    const used = new Set(Array.from(document.querySelectorAll('[id]')).map((e) => e.id));
    headings.forEach((h) => {
      if (h.id) return;
      let base = slugify(h.textContent);
      if (!base) base = 'sec';
      let id = base;
      let n = 2;
      while (used.has(id)) {
        id = `${base}-${n++}`;
      }
      used.add(id);
      h.id = id;
    });
  }

  function clearTOC() {
    if (!tocList) return;
    tocList.innerHTML = '';
  }

  function buildTOC(sectionEl) {
    clearTOC();
    if (!tocList || !sectionEl) return;

    const headings = Array.from(sectionEl.querySelectorAll('h2, h3'));
    if (!headings.length) return;

    ensureHeadingIds(headings);

    headings.forEach((h) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent;
      a.dataset.target = h.id;
      if (h.tagName.toLowerCase() === 'h3') a.classList.add('toc-h3');

      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      li.appendChild(a);
      tocList.appendChild(li);
    });

    setupTOCObserver(headings);
  }

  function setupTOCObserver(headings) {
    if (!tocList) return;

    if (tocObserver) {
      tocObserver.disconnect();
      tocObserver = null;
    }

    const links = Array.from(tocList.querySelectorAll('a'));

    const setActiveLink = (id) => {
      links.forEach((l) => l.classList.toggle('active', l.dataset.target === id));
    };

    tocObserver = new IntersectionObserver(
      (entries) => {
        // pega o heading mais visível
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio - a.intersectionRatio))[0];

        if (visible && visible.target && visible.target.id) {
          setActiveLink(visible.target.id);
        }
      },
      {
        root: contentEl || null,
        threshold: [0.15, 0.3, 0.6]
      }
    );

    headings.forEach((h) => tocObserver.observe(h));

    // default
    if (headings[0]?.id) setActiveLink(headings[0].id);
  }

  function activateSection(sectionId) {
    const nav = navItems.find((n) => n.dataset.section === sectionId);
    const title = nav ? (nav.textContent || '').trim() : 'Início';

    setActiveNav(sectionId);
    showSection(sectionId);
    setBreadcrumb(title);

    // Atualiza TOC
    const activeSection = document.querySelector(`.content-section#${CSS.escape(sectionId)}`);
    buildTOC(activeSection);

    // Reset scroll
    if (contentEl) contentEl.scrollTop = 0;
  }

  // Clipboard com fallback (file:// não é "secure context")
  async function copyText(text) {
    if (!text) return false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // fallback abaixo
    }

    // Fallback: textarea temporário
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  function setupCopyButtons() {
    const buttons = Array.from(document.querySelectorAll('.copy-btn'));

    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const codeBlock = btn.closest('.code-block');
        let text = '';

        if (codeBlock) {
          const code = codeBlock.querySelector('pre code');
          if (code) text = code.innerText;
        } else {
          // tenta achar próximo pre
          const nextPre = btn.parentElement?.nextElementSibling?.matches('pre') ? btn.parentElement.nextElementSibling : null;
          if (nextPre) text = nextPre.innerText;
        }

        const ok = await copyText(text.trim());
        const old = btn.textContent.trim() || 'Copiar';
        btn.textContent = ok ? 'Copiado!' : 'Falhou';
        setTimeout(() => (btn.textContent = old), 1200);
      });
    });
  }

  function setupStepNavigation() {
    const navContainers = Array.from(document.querySelectorAll('.step-navigation'));
    navContainers.forEach((container) => {
      const steps = Array.from(container.querySelectorAll('.step'));
      if (!steps.length) return;

      const section = container.closest('.content-section');
      const sectionId = section ? section.id : 'global';
      const storageKey = `ptero_step_${sectionId}`;

      const contents = section ? Array.from(section.querySelectorAll('.step-content')) : [];

      function showStep(stepId) {
        steps.forEach((s) => s.classList.toggle('active', s.dataset.step === stepId));
        contents.forEach((c) => c.classList.toggle('active', c.dataset.step === stepId));
        localStorage.setItem(storageKey, stepId);
      }

      const saved = localStorage.getItem(storageKey);
      if (saved && steps.some((s) => s.dataset.step === saved)) {
        showStep(saved);
      } else {
        showStep(steps[0].dataset.step);
      }

      steps.forEach((s) => {
        s.addEventListener('click', () => showStep(s.dataset.step));
      });
    });
  }

  function setupChecklistPersistence() {
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"][id]'));
    checkboxes.forEach((cb) => {
      const key = `ptero_check_${cb.id}`;
      const saved = localStorage.getItem(key);
      if (saved === '1') cb.checked = true;

      cb.addEventListener('change', () => {
        localStorage.setItem(key, cb.checked ? '1' : '0');
      });
    });
  }

  function setupQuickActions() {
    const btnTop = document.getElementById('btn-top');
    if (btnTop) btnTop.addEventListener('click', scrollContentToTop);

    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        // imprime a página; o navegador permite selecionar (ou salvar PDF)
        window.print();
      });
    }
  }

  function setupNav() {
    navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const id = item.dataset.section;
        if (!id) return;
        activateSection(id);
        history.replaceState(null, '', `#${id}`);
      });
    });

    // suporte para abrir direto com hash
    const initial = (location.hash || '').replace('#', '');
    const id = initial && document.getElementById(initial) ? initial : 'home';
    activateSection(id);
  }

  function setupIconFallback() {
    // Para file:// alguns browsers bloqueiam <use> externo. Fallback: mostra <img>.
    const items = Array.from(document.querySelectorAll('.nav-item'));
    requestAnimationFrame(() => {
      items.forEach((item) => {
        const svg = item.querySelector('svg');
        const img = item.querySelector('img.nav-icon');
        if (!svg || !img) return;

        let ok = true;
        try {
          const bb = svg.getBBox();
          ok = bb && bb.width > 0 && bb.height > 0;
        } catch (_) {
          ok = false;
        }

        if (!ok) {
          svg.style.display = 'none';
          img.style.display = 'inline-block';
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupNav();
    setupCopyButtons();
    setupStepNavigation();
    setupChecklistPersistence();
    setupQuickActions();
    setupIconFallback();
  });
})();
