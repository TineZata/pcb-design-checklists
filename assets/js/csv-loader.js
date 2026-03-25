// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Tine Zata

/* PCB Design Checklists — CSV Loader
 * Fetches a CSV file, parses it, and renders a filterable grouped table.
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

  /* ── Status badge ────────────────────────────────────────────────────── */
  var BADGE_CLASS = {
    'PASS':    'badge-pass',
    'FAIL':    'badge-fail',
    'N/A':     'badge-na',
    'PENDING': 'badge-pending'
  };

  function badgeHTML(value) {
    var v   = (value || '').trim();
    var cls = BADGE_CLASS[v.toUpperCase()] || (v === '' ? 'badge-empty' : 'badge-na');
    return '<span class="badge ' + cls + '">' + (v || '—') + '</span>';
  }

  /* ── Stats calculation ───────────────────────────────────────────────── */
  function calcStats(rows, statusKeys) {
    var c = { PASS: 0, FAIL: 0, NA: 0, pending: 0 };
    rows.forEach(function(row) {
      statusKeys.forEach(function(sk) {
        var v = (row[sk.key] || '').trim().toUpperCase();
        if      (v === 'PASS')    c.PASS++;
        else if (v === 'FAIL')    c.FAIL++;
        else if (v === 'N/A')     c.NA++;
        else                      c.pending++;
      });
    });
    return c;
  }

  function statsBarHTML(c, total) {
    var pct = total > 0 ? Math.round((c.PASS / total) * 100) : 0;
    return [
      '<div class="stats-bar">',
      '  <div class="stats-counts">',
      '    <span class="stat-item"><span class="badge badge-pass">' + c.PASS    + '</span> Pass</span>',
      '    <span class="stat-item"><span class="badge badge-fail">' + c.FAIL    + '</span> Fail</span>',
      '    <span class="stat-item"><span class="badge badge-na">'   + c.NA      + '</span> N/A</span>',
      '    <span class="stat-item"><span class="badge badge-pending">' + c.pending + '</span> Pending</span>',
      '    <span class="stat-item total">' + total + ' status checks total</span>',
      '  </div>',
      '  <div class="progress-wrap">',
      '    <div class="progress-bar" style="width:' + pct + '%" title="' + pct + '% pass"></div>',
      '  </div>',
      '</div>'
    ].join('\n');
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

      var grouped  = groupBy(rows, groupKey);
      var allStats = calcStats(rows, statusKeys);
      var statTotal = rows.length * (statusKeys.length || 1);

      /* Build status column headers */
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
        '</div>',
        '<div id="cs-groups">'
      ];

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
          var statusVals = statusKeys.map(function(sk) {
            return (row[sk.key] || '').toUpperCase();
          }).join(' ');

          var statusTD = statusKeys.map(function(sk) {
            return '<td class="col-status">' + badgeHTML(row[sk.key]) + '</td>';
          }).join('');

          var extraTD = extraCols.map(function(ec) {
            var v = row[ec.key] || '';
            return '<td class="col-extra">' + (v ? '<span class="note-text">' + _esc(v) + '</span>' : '') + '</td>';
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

      /* ── Expand / collapse ─────────────────────────────────────────── */
      container.querySelectorAll('.cat-header').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var open   = btn.getAttribute('aria-expanded') === 'true';
          var bodyEl = document.getElementById(btn.getAttribute('aria-controls'));
          btn.setAttribute('aria-expanded', String(!open));
          bodyEl.style.display   = open ? 'none' : '';
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

        /* Show helpful message if everything is hidden */
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
