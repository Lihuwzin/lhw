// js/tooltips.js
(function () {
  'use strict';

  const tooltip = document.getElementById('tooltip');

  const termDefinitions = {
    "Pterodactyl Panel": "Interface web principal para gerenciar servidores, nodes, usuários e permissões.",
    "Wings": "Daemon/Agente do Pterodactyl no Node que executa containers Docker e reporta ao Panel.",
    "Node": "Máquina/VPS que roda o Wings e executa os servidores Minecraft.",
    "Egg": "Template de instalação/execução de um tipo de servidor (Velocity, Paper, etc) dentro do Pterodactyl.",
    "Nest": "Coleção de Eggs organizada por categoria.",
    "Allocation": "IP/porta reservados no Pterodactyl para um servidor usar.",
    "Daemon": "Serviço em background que executa tarefas (no caso, o Wings).",
    "SFTP": "Protocolo seguro para transferir arquivos via SSH.",
    "SSL": "Criptografia TLS para proteger o tráfego HTTPS e conexões seguras.",
    "Reverse Proxy": "Servidor (ex: Nginx) que recebe tráfego externo e encaminha para serviços internos com regras e SSL.",
    "Velocity": "Proxy moderno para Minecraft, conecta jogadores a vários backends.",
    "SportPaper": "Fork otimizada do Paper (foco 1.8.8) para desempenho em PvP/minigames.",
    "BungeeCord": "Proxy tradicional para Minecraft; Velocity é alternativa moderna.",
    "Plugin": "Extensão do servidor/proxy Minecraft para adicionar funcionalidades.",
    "VPS": "Servidor virtual privado (máquina virtual) em um provedor.",
    "DNS": "Sistema que resolve domínios para IPs.",
    "Cloudflare": "CDN e serviços de proteção/DNS; útil para o Panel e sites.",
    "Fail2ban": "Ferramenta que bane IPs após tentativas repetidas de login (brute force).",
    "Docker": "Plataforma de containers usada pelo Wings para isolamento e execução.",
    "MongoDB": "Banco de dados NoSQL (útil para dados flexíveis e logs).",
    "Redis": "Banco em memória (cache, sessões, filas, rate limit)."
  };

  // Termos para realce automático (em texto), incluindo os que já existem no glossário.
  const terms = Object.keys(termDefinitions)
    .sort((a, b) => b.length - a.length);

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Evita highlight dentro de palavras maiores (acentos inclusos)
  const boundary = '[A-Za-z0-9À-ÿ_]';
  const termPattern = terms.map(escapeRegex).join('|');
  const termRegex = new RegExp(`(?<!${boundary})(?:${termPattern})(?!${boundary})`, 'g');

  function shouldSkip(node) {
    if (!node || !node.parentElement) return true;

    const p = node.parentElement;

    // Não mexer em blocos que não devem ser reescritos
    if (p.closest('pre, code, .code-block, .sidebar-left, .sidebar-right, .breadcrumb, nav, button, a, input, textarea, select, [data-term]')) {
      return true;
    }
    // Não mexer em nós já realçados
    if (p.closest('.term-highlight')) return true;

    return false;
  }

  function wrapTerms(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
          if (!termRegex.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
          termRegex.lastIndex = 0; // reset
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((textNode) => {
      const text = textNode.nodeValue;
      termRegex.lastIndex = 0;

      let match;
      let lastIndex = 0;
      const frag = document.createDocumentFragment();

      while ((match = termRegex.exec(text)) !== null) {
        const term = match[0];
        const start = match.index;
        const end = start + term.length;

        if (start > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
        }

        const span = document.createElement('span');
        span.className = 'term-highlight';
        span.setAttribute('data-term', term);
        span.textContent = term;
        frag.appendChild(span);

        lastIndex = end;
      }

      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function showTooltip(text, x, y) {
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.classList.add('active');

    // Posicionamento com margem
    const margin = 12;
    const rect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x + margin;
    let top = y + margin;

    if (left + rect.width + margin > vw) left = x - rect.width - margin;
    if (top + rect.height + margin > vh) top = y - rect.height - margin;

    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('active');
  }

  function bindTooltipHandlers(container) {
    container.addEventListener('mousemove', (e) => {
      const el = e.target.closest('[data-term]');
      if (!el) return;
      const term = el.getAttribute('data-term');
      const def = termDefinitions[term];
      if (!def) return;
      showTooltip(def, e.clientX, e.clientY);
    });

    container.addEventListener('mouseenter', (e) => {
      const el = e.target.closest('[data-term]');
      if (!el) return;
      const term = el.getAttribute('data-term');
      const def = termDefinitions[term];
      if (!def) return;
      showTooltip(def, e.clientX, e.clientY);
    }, true);

    container.addEventListener('mouseleave', (e) => {
      const el = e.target.closest('[data-term]');
      if (!el) return;
      hideTooltip();
    }, true);

document.addEventListener('scroll', hideTooltip, { passive: true });
    const main = document.querySelector('main.content');
    if (main) main.addEventListener('scroll', hideTooltip, { passive: true });
    window.addEventListener('resize', hideTooltip);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main.content');
    if (!main) return;

    // Realça termos em texto sem destruir estrutura/handlers
    wrapTerms(main);

    // Tooltip em elementos data-term e itens do glossário
    bindTooltipHandlers(document.body);
  });
})();
