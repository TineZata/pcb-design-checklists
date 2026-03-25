// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Tine Zata

/* PCB Design Checklists — CSV Loader
 * Fetches a CSV file, parses it, and renders a filterable grouped table
 * with editable status dropdowns that persist to localStorage.
 * Usage: PCBChecklists.renderChecklist(config)
 */
(function (global) {
  'use strict';

  /* ── CSV Parser (RFC 4180) ───────────────────────────────────────────── */
  function parseCSV(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Strip comment lines (SPDX headers etc.) before parsing
    text = text.split('\n').filter(function(l) { return l.charAt(0) !== '#'; }).join('\n');
    if (text[text.length - 1] !== '\n') text += '\n';

    var rows = [], fields = [], field = '', inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"')                    { inQuotes = false; }
        else                                   { field += c; }
      } else {
        if      (c === '"')  { inQuotes = true; }
        else if (c === ',')  { fields.push(field.trim()); field = ''; }
        else if (c === '\n') {
          fields.push(field.trim());
          field = '';
          if (fields.some(function(f){ return f !== ''; })) rows.push(fields);
          fields = [];
        } else { field += c; }
      }
    }

    if (rows.length < 2) return [];

    var headers = rows[0].map(function(h){ return h.trim(); });
    return rows.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(h, i){ obj[h] = (row[i] || '').trim(); });
      return obj;
    });
  }

  /* ── Fetch + parse ───────────────────────────────────────────────────── */
  function fetchCSV(url) {
    return fetch(url).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' loading ' + url);
      return res.text();
    }).then(parseCSV);
  }

  /* ── Group array of objects by a key ─────────────────────────────────── */
  function groupBy(arr, key) {
    var map = new Map();
    arr.forEach(function(item) {
      var k = item[key] || 'Uncategorised';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  }

  /* ── Status badge helpers ────────────────────────────────────────────── */
  var STATUS_OPTIONS = ['', 'PASS', 'FAIL', 'N/A', 'PENDING'];

  var BADGE_CLASS = {
    'PASS':    'badge-pass',
    'FAIL':    'badge-fail',
    'N/A':     'badge-na',
    'PENDING': 'badge-pending'
  };

  function badgeClass(value) {
    var v = (value || '').trim().toUpperCase();
    return BADGE_CLASS[v] || (v === '' ? 'badge-empty' : 'badge-na');
  }

  /* Editable <select> styled as a badge */
  function statusSelectHTML(value, rowId, fieldKey) {
    var v   = (value || '').trim();
    var cls = badgeClass(v);
    var opts = STATUS_OPTIONS.map(function(opt) {
      var sel = (opt.toUpperCase() === v.toUpperCase()) ? ' selected' : '';
      return '<option value="' + opt + '"' + sel + '>' + (opt || '\u2014') + '</option>';
    }).join('');
    return (
      '<select class="status-select ' + cls + '" ' +
      'data-rowid="' + rowId + '" data-field="' + _esc(fieldKey) + '" ' +
      'aria-label="Status">' + opts + '</select>'
    );
  }

  /* ── Stats calculation ───────────────────────────────────────────────── */
  function calcStats(rows, statusKeys) {
    var c = { PASS: 0, FAIL: 0, NA: 0, pending: 0 };
    rows.forEach(function(row) {
      statusKeys.forEach(function(sk) {
        var v = (row[sk.key] || '').trim().toUpperCase();
        if      (v === 'PASS') c.PASS++;
        else if (v === 'FAIL') c.FAIL++;
        else if (v === 'N/A')  c.NA++;
        else                   c.pending++;
      });
    });
    return c;
  }

  /* ── Stats bar (initial HTML with addressable ids) ───────────────────── */
  function statsBarHTML(c, total) {
    var pct = total > 0 ? Math.round((c.PASS / total) * 100) : 0;
    return [
      '<div class="stats-bar" id="cs-stats-bar">',
      '  <div class="stats-counts">',
      '    <span class="stat-item"><span class="badge badge-pass"    id="cs-stat-pass">'    + c.PASS    + '</span> Pass</span>',
      '    <span class="stat-item"><span class="badge badge-fail"    id="cs-stat-fail">'    + c.FAIL    + '</span> Fail</span>',
      '    <span class="stat-item"><span class="badge badge-na"      id="cs-stat-na">'      + c.NA      + '</span> N/A</span>',
      '    <span class="stat-item"><span class="badge badge-pending" id="cs-stat-pending">' + c.pending + '</span> Pending</span>',
      '    <span class="stat-item total" id="cs-stat-total">' + total + ' status checks total</span>',
      '  </div>',
      '  <div class="progress-wrap">',
      '    <div class="progress-bar" id="cs-progress-bar" style="width:' + pct + '%" title="' + pct + '% pass"></div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ── Live stats refresh (called after every select change) ───────────── */
  function refreshStats(container) {
    var g = { PASS: 0, FAIL: 0, NA: 0, pending: 0 };
    var total = 0;

    container.querySelectorAll('.cat-group').forEach(function(group) {
      var cat = { PASS: 0, FAIL: 0, NA: 0, pending: 0 };
      var catTotal = 0;

      group.querySelectorAll('tbody tr').forEach(function(tr) {
        var selects = tr.querySelectorAll('.status-select');
        var vals    = [];
        selects.forEach(function(sel) {
          var v = (sel.value || '').trim().toUpperCase();
          if      (v === 'PASS') { cat.PASS++;    g.PASS++; }
          else if (v === 'FAIL') { cat.FAIL++;    g.FAIL++; }
          else if (v === 'N/A')  { cat.NA++;      g.NA++;   }
          else                   { cat.pending++; g.pending++; }
          catTotal++; total++;
          if (v) vals.push(v);
        });
        /* Keep data-status in sync for the filter to work */
        tr.dataset.status = vals.join(' ');
      });

      /* Update the % pass badge inside the category header */
      var catPct   = catTotal > 0 ? Math.round((cat.PASS / catTotal) * 100) : 0;
      var pctBadge = group.querySelector('.cat-meta .badge');
      if (pctBadge) {
        pctBadge.textContent = catPct + '% pass';
        pctBadge.className   = 'badge ' + (cat.FAIL > 0 ? 'badge-fail' : (catPct === 100 ? 'badge-pass' : 'badge-na'));
      }
    });

    /* Update global stats bar */
    var pct = total > 0 ? Math.round((g.PASS / total) * 100) : 0;
    var el;
    if ((el = document.getElementById('cs-stat-pass')))    el.textContent = g.PASS;
    if ((el = document.getElementById('cs-stat-fail')))    el.textContent = g.FAIL;
    if ((el = document.getElementById('cs-stat-na')))      el.textContent = g.NA;
    if ((el = document.getElementById('cs-stat-pending'))) el.textContent = g.pending;
    if ((el = document.getElementById('cs-stat-total')))   el.textContent = total + ' status checks total';
    if ((el = document.getElementById('cs-progress-bar'))) {
      el.style.width = pct + '%';
      el.title = pct + '% pass';
    }
  }

  /* ── localStorage helpers ────────────────────────────────────────────── */
  function lsPrefix(csvUrl) { return 'pcb-cl:' + csvUrl + ':'; }

  function loadOverrides(csvUrl, rows, statusKeys, extraCols) {
    try {
      var prefix = lsPrefix(csvUrl);
      rows.forEach(function(row, idx) {
        statusKeys.forEach(function(sk) {
          var saved = localStorage.getItem(prefix + idx + ':' + sk.key);
          if (saved !== null) row[sk.key] = saved;
        });
        extraCols.forEach(function(ec) {
          var saved = localStorage.getItem(prefix + idx + ':' + ec.key);
          if (saved !== null) row[ec.key] = saved;
        });
      });
    } catch (e) { /* localStorage may be unavailable (e.g. private browsing with strict settings) */ }
  }

  function saveOverride(csvUrl, rowId, fieldKey, value) {
    try { localStorage.setItem(lsPrefix(csvUrl) + rowId + ':' + fieldKey, value); } catch (e) {}
  }

  function clearOverrides(csvUrl) {
    try {
      var prefix = lsPrefix(csvUrl);
      Object.keys(localStorage)
        .filter(function(k) { return k.indexOf(prefix) === 0; })
        .forEach(function(k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  /* ── Main render function ────────────────────────────────────────────── */
  function renderChecklist(config) {
    var csvUrl      = config.csvUrl;
    var groupKey    = config.groupKey;
    var textKey     = config.textKey;
    var statusKeys  = config.statusKeys  || [];
    var extraCols   = config.extraCols   || [];
    var containerId = config.containerId || 'checklist-container';

    var container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<p class="loading">Loading checklist data…</p>';

    fetchCSV(csvUrl).then(function(rows) {

      /* Apply any saved overrides before rendering */
      loadOverrides(csvUrl, rows, statusKeys, extraCols);

      var grouped   = groupBy(rows, groupKey);
      var allStats  = calcStats(rows, statusKeys);
      var statTotal = rows.length * (statusKeys.length || 1);

      var statusTH = statusKeys.map(function(sk) {
        return '<th class="col-status">' + sk.label + '</th>';
      }).join('');
      var extraTH = extraCols.map(function(ec) {
        return '<th class="col-extra">' + ec.label + '</th>';
      }).join('');

      var html = [
        statsBarHTML(allStats, statTotal),
        '<div class="controls">',
        '  <input type="search" id="cs-search" placeholder="Search items…" aria-label="Search">',
        '  <select id="cs-status-filter" aria-label="Filter by status">',
        '    <option value="">All statuses</option>',
        '    <option value="PASS">Pass</option>',
        '    <option value="FAIL">Fail</option>',
        '    <option value="N/A">N/A</option>',
        '    <option value="PENDING">Pending / blank</option>',
        '  </select>',
        '  <a href="' + csvUrl + '" download class="btn-download">&#8659; Download CSV</a>',
        '  <button type="button" class="btn-reset" id="cs-reset" title="Clear all edits and restore CSV defaults">&#8635; Reset</button>',
        '</div>',
        '<div id="cs-groups">'
      ];

      /* Global row index for stable localStorage keys */
      var globalRowIdx = 0;
      var catIdx = 0;

      grouped.forEach(function(catRows, cat) {
        var cs     = calcStats(catRows, statusKeys);
        var catTot = catRows.length * (statusKeys.length || 1);
        var pct    = catTot > 0 ? Math.round((cs.PASS / catTot) * 100) : 0;
        var pctCls = cs.FAIL > 0 ? 'badge-fail' : (pct === 100 ? 'badge-pass' : 'badge-na');
        var bodyId = 'cs-cat-' + (catIdx++);

        html.push(
          '<div class="cat-group" data-cat="' + _esc(cat) + '">',
          '  <button class="cat-header" aria-expanded="true" aria-controls="' + bodyId + '">',
          '    <span class="cat-name">' + _esc(cat) + '</span>',
          '    <span class="cat-meta">',
          '      <span class="cat-count">' + catRows.length + ' items</span>',
          '      <span class="badge ' + pctCls + '">' + pct + '% pass</span>',
          '      <span class="cat-chevron">&#9662;</span>',
          '    </span>',
          '  </button>',
          '  <div class="cat-body" id="' + bodyId + '">',
          '    <table class="checklist-table">',
          '      <thead><tr>',
          '        <th class="col-num">#</th>',
          '        <th class="col-text">Item</th>',
          statusTH, extraTH,
          '      </tr></thead>',
          '      <tbody>'
        );

        catRows.forEach(function(row, i) {
          var rowId = globalRowIdx++;
          var statusVals = statusKeys.map(function(sk) {
            return (row[sk.key] || '').toUpperCase();
          }).join(' ');

          var statusTD = statusKeys.map(function(sk) {
            return '<td class="col-status">' + statusSelectHTML(row[sk.key], rowId, sk.key) + '</td>';
          }).join('');

          var extraTD = extraCols.map(function(ec) {
            var v = row[ec.key] || '';
            return (
              '<td class="col-extra">' +
              '<textarea class="note-edit" rows="2" ' +
              'data-rowid="' + rowId + '" data-field="' + _esc(ec.key) + '" ' +
              'aria-label="' + _esc(ec.label) + '" ' +
              'placeholder="Add a note…">' + _esc(v) + '</textarea>' +
              '</td>'
            );
          }).join('');

          html.push(
            '<tr data-text="' + (row[textKey] || '').toLowerCase().replace(/"/g, '') + '" data-status="' + statusVals + '">',
            '  <td class="col-num">' + (i + 1) + '</td>',
            '  <td class="col-text">' + _esc(row[textKey] || '') + '</td>',
            statusTD, extraTD,
            '</tr>'
          );
        });

        html.push('      </tbody>', '    </table>', '  </div>', '</div>');
      });

      html.push('</div>'); /* #cs-groups */
      container.innerHTML = html.join('\n');

      /* ── Note textarea save handler ────────────────────────────────── */
      container.querySelectorAll('.note-edit').forEach(function(ta) {
        ta.addEventListener('change', function() {
          saveOverride(csvUrl, ta.dataset.rowid, ta.dataset.field, ta.value);
        });
      });

      /* ── Status select change handler ──────────────────────────────── */
      container.querySelectorAll('.status-select').forEach(function(sel) {
        sel.addEventListener('change', function() {
          var newVal = sel.value;
          sel.className = 'status-select ' + badgeClass(newVal);
          saveOverride(csvUrl, sel.dataset.rowid, sel.dataset.field, newVal);
          refreshStats(container);
        });
      });

      /* ── Reset button ──────────────────────────────────────────────── */
      var resetBtn = document.getElementById('cs-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', function() {
          if (window.confirm('Reset all edits (status and notes) to the original CSV values?')) {
            clearOverrides(csvUrl);
            location.reload();
          }
        });
      }

      /* ── Expand / collapse ─────────────────────────────────────────── */
      container.querySelectorAll('.cat-header').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var open   = btn.getAttribute('aria-expanded') === 'true';
          var bodyEl = document.getElementById(btn.getAttribute('aria-controls'));
          btn.setAttribute('aria-expanded', String(!open));
          bodyEl.style.display = open ? 'none' : '';
          btn.querySelector('.cat-chevron').innerHTML = open ? '&#9656;' : '&#9662;';
        });
      });

      /* ── Search + status filter ────────────────────────────────────── */
      function applyFilters() {
        var query     = document.getElementById('cs-search').value.toLowerCase();
        var statusVal = document.getElementById('cs-status-filter').value.toUpperCase();

        container.querySelectorAll('.cat-group').forEach(function(group) {
          var visible = 0;
          group.querySelectorAll('tbody tr').forEach(function(row) {
            var textMatch   = !query || (row.dataset.text || '').includes(query);
            var statusMatch = true;
            if (statusVal) {
              var s = row.dataset.status || '';
              if (statusVal === 'PENDING') {
                statusMatch = !s.includes('PASS') && !s.includes('FAIL') && !s.includes('N/A');
              } else {
                statusMatch = s.includes(statusVal);
              }
            }
            var show = textMatch && statusMatch;
            row.style.display = show ? '' : 'none';
            if (show) visible++;
          });
          group.style.display = (visible === 0 && (query || statusVal)) ? 'none' : '';
        });

        var allHidden = container.querySelectorAll('.cat-group:not([style*="none"])').length === 0;
        var existing  = container.querySelector('.no-results');
        if (allHidden && (query || statusVal)) {
          if (!existing) {
            var msg = document.createElement('p');
            msg.className = 'no-results';
            msg.textContent = 'No items match your search.';
            document.getElementById('cs-groups').appendChild(msg);
          }
        } else if (existing) {
          existing.remove();
        }
      }

      document.getElementById('cs-search').addEventListener('input',  applyFilters);
      document.getElementById('cs-status-filter').addEventListener('change', applyFilters);

    }).catch(function(err) {
      container.innerHTML = '<p class="error">&#9888; Could not load checklist data: ' + err.message + '<br><small>If viewing locally, open via a web server (e.g. VS Code Live Server) rather than directly from the filesystem.</small></p>';
    });
  }

  /* ── HTML entity escape ──────────────────────────────────────────────── */
  function _esc(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;');
  }

  /* ── Public API ──────────────────────────────────────────────────────── */
  global.PCBChecklists = { renderChecklist: renderChecklist };

}(window));
