/**
 * utils.js
 * Funções utilitárias genéricas usadas por todo o dashboard.
 * Não depende de nenhum outro módulo da aplicação.
 */
'use strict';

const Utils = (() => {

  /* ---------- Formatação ---------- */

  function formatCurrency(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatNumber(value, decimals = 0) {
    const n = Number(value) || 0;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function formatPercent(value, decimals = 1) {
    const n = Number(value) || 0;
    return `${n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
  }

  function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return '—';
    return date.toLocaleDateString('pt-BR');
  }

  function formatDateTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return '—';
    return date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** Aceita datas em formato BR (dd/mm/aaaa), ISO (aaaa-mm-dd) ou serial do Excel. */
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value) ? null : value;

    if (typeof value === 'number') {
      // Número serial de data do Excel (dias desde 1899-12-30)
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + value * 86400000);
      return isNaN(d) ? null : d;
    }

    const str = String(value).trim();
    if (!str) return null;

    // dd/mm/aaaa ou dd-mm-aaaa
    let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = `20${y}`;
      const dt = new Date(Number(y), Number(mo) - 1, Number(d));
      return isNaN(dt) ? null : dt;
    }

    // aaaa-mm-dd (ISO)
    m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const [, y, mo, d] = m;
      const dt = new Date(Number(y), Number(mo) - 1, Number(d));
      return isNaN(dt) ? null : dt;
    }

    const generic = new Date(str);
    return isNaN(generic) ? null : generic;
  }

  function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function isSameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  /* ---------- Animação de números (contadores) ---------- */

  /**
   * Anima um elemento de texto de um valor numérico até outro.
   * @param {HTMLElement} el
   * @param {number} from
   * @param {number} to
   * @param {(v:number)=>string} formatter
   * @param {number} duration ms
   */
  function animateValue(el, from, to, formatter, duration = 800) {
    if (!el) return;
    const start = performance.now();
    const diff = to - from;

    if (Math.abs(diff) < 0.0001) {
      el.textContent = formatter(to);
      return;
    }

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function step(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = from + diff * eased;
      el.textContent = formatter(current);
      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = formatter(to);
      }
    }
    requestAnimationFrame(step);
  }

  /* ---------- Debounce ---------- */

  function debounce(fn, wait = 250) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ---------- Toasts (mensagens amigáveis) ---------- */

  let toastContainer = null;

  function getToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      toastContainer.setAttribute('role', 'status');
      toastContainer.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  function showToast(message, type = 'info', duration = 4000) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const icons = { success: '✔', error: '✖', warning: '⚠', info: 'ℹ' };
    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || icons.info}</span>
      <span class="toast__message"></span>
      <button class="toast__close" aria-label="Fechar">&times;</button>
    `;
    toast.querySelector('.toast__message').textContent = message;

    const close = () => {
      toast.classList.add('toast--leaving');
      setTimeout(() => toast.remove(), 250);
    };
    toast.querySelector('.toast__close').addEventListener('click', close);

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));

    if (duration > 0) setTimeout(close, duration);
    return toast;
  }

  /* ---------- Exportação CSV ---------- */

  function downloadTextFile(filename, content, mime = 'text/plain') {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function arrayToCSV(rows, columns) {
    const escapeCell = (value) => {
      const str = value === null || value === undefined ? '' : String(value);
      if (/[",;\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = columns.map(c => escapeCell(c.label)).join(';');
    const lines = rows.map(row => columns.map(c => escapeCell(c.value(row))).join(';'));
    return [header, ...lines].join('\r\n');
  }

  function exportToCSV(filename, rows, columns) {
    const csv = arrayToCSV(rows, columns);
    // BOM para o Excel reconhecer acentuação em UTF-8 corretamente
    downloadTextFile(filename, '﻿' + csv, 'text/csv');
  }

  /* ---------- Status / cores de indicadores ---------- */

  const STATUS_COLORS = {
    entregue: 'var(--color-success)',
    dentro_prazo: 'var(--color-warning)',
    vencido: 'var(--color-danger)',
    sem_info: 'var(--color-neutral)'
  };

  function getStatusColorVar(statusKey) {
    return STATUS_COLORS[statusKey] || STATUS_COLORS.sem_info;
  }

  /* ---------- Outros ---------- */

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(v => v !== null && v !== undefined && v !== '')))
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }

  function sum(arr, getter) {
    return arr.reduce((acc, item) => acc + (Number(getter(item)) || 0), 0);
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  return {
    formatCurrency, formatNumber, formatPercent, formatDate, formatDateTime,
    parseDate, startOfDay, isSameMonth, MONTH_NAMES,
    animateValue, debounce, showToast,
    downloadTextFile, arrayToCSV, exportToCSV,
    getStatusColorVar, uniqueSorted, sum, groupBy
  };
})();
