(function () {
  'use strict';

  console.log('[OT-Calc] Content script loaded in:', location.href.substring(0, 80));

  /* ── Get DIRECT child rows of a table (skipping nested tables) ── */
  function getDirectRows(table) {
    var rows = [];
    for (var i = 0; i < table.children.length; i++) {
      var child = table.children[i];
      var tag = child.tagName.toUpperCase();
      if (tag === 'TR') {
        rows.push(child);
      } else if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') {
        for (var j = 0; j < child.children.length; j++) {
          if (child.children[j].tagName.toUpperCase() === 'TR') {
            rows.push(child.children[j]);
          }
        }
      }
    }
    return rows;
  }

  /* ── Get DIRECT child cells of a row ── */
  function getDirectCells(row) {
    var cells = [];
    for (var i = 0; i < row.children.length; i++) {
      var tag = row.children[i].tagName.toUpperCase();
      if (tag === 'TD' || tag === 'TH') {
        cells.push(row.children[i]);
      }
    }
    return cells;
  }

  function parseTime12h(str) {
    if (!str) return null;
    str = str.replace(/\s+/g, ' ').trim();
    var m = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var ampm = m[3].toUpperCase();
    if (ampm === 'AM' && h === 12) h = 0;
    if (ampm === 'PM' && h !== 12) h += 12;
    return h * 60 + min;
  }

  function dur(s, e) {
    var sv = parseTime12h(s), ev = parseTime12h(e);
    if (sv === null || ev === null) return 0;
    var d = ev - sv;
    if (d <= 0) d += 1440;
    return d;
  }

  function norm(t) { return t.replace(/\s+/g, ' ').trim().toLowerCase(); }

  function classify(raw) {
    var n = norm(raw);
    if (n.indexOf('not work time') !== -1) return 'skip';
    if (n === 'closed' || n === 'off') return 'skip';
    if (n === 'open' || n === 'open eyg') return 'regular';
    if (n === 'break' || n === 'lunch') return 'regular';
    if (n.indexOf('late arrival') === 0) return 'skip';
    if ((n.indexOf('overtime in a day off') !== -1 || n.indexOf('ot in a day off') !== -1) && n.indexOf('by rta') !== -1) return 'dayoff_rta';
    if ((n.indexOf('overtime in a day off') !== -1 || n.indexOf('ot in a day off') !== -1) && n.indexOf('by scheduling') !== -1) return 'dayoff_sched';
    if ((n.indexOf('over time') !== -1 || n.indexOf('ot') === 0) && n.indexOf('by rta') !== -1) return 'ot_rta';
    if ((n.indexOf('over time') !== -1 || n.indexOf('ot') === 0) && n.indexOf('by scheduling') !== -1) return 'ot_sched';
    if (n === 'break ot rta' || n === 'lunch ot rta') return 'ot_rta';
    if (n === 'break ot' || n === 'lunch ot') return 'dayoff_sched';
    return 'regular';
  }

  function parseSchedule() {
    var dayPat = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/;

    var allTables = document.querySelectorAll('table');
    var bestDays = [];
    var bestActs = 0;

    for (var t = 0; t < allTables.length; t++) {
      var tblRows = getDirectRows(allTables[t]);
      if (tblRows.length === 0) continue;

      var hdrCells = getDirectCells(tblRows[0]);
      var hdrCellCount = hdrCells.length;

      var cols = { day: -1, activity: -1, start: -1, end: -1 };
      for (var c = 0; c < hdrCells.length; c++) {
        var ct = hdrCells[c].textContent.replace(/\s+/g, ' ').trim().toUpperCase();
        if (ct === 'DAY') cols.day = c;
        else if (ct === 'ACTIVITY') cols.activity = c;
        else if (ct === 'START') cols.start = c;
        else if (ct === 'END') cols.end = c;
      }

      if (cols.activity === -1 || cols.start === -1 || cols.end === -1) continue;

      var tblDays = [];
      var curDay = null;
      var seenDates = {};
      var actCount = 0;

      for (var ri = 1; ri < tblRows.length; ri++) {
        var rCells = getDirectCells(tblRows[ri]);
        if (rCells.length < 3) continue;

        var offset = hdrCellCount - rCells.length;

        // Try offset-adjusted day index first
        var dayIdx = cols.day - offset;
        var foundDay = false;
        if (dayIdx >= 0 && dayIdx < rCells.length) {
          var dTxt = rCells[dayIdx].textContent.replace(/\s+/g, ' ').trim();
          var dm = dTxt.match(dayPat);
          if (dm) {
            foundDay = true;
            if (!seenDates[dm[2]]) {
              seenDates[dm[2]] = true;
              curDay = { day: dm[1], date: dm[2], label: dm[1] + ' ' + dm[2], activities: [] };
              tblDays.push(curDay);
            } else {
              for (var sd = 0; sd < tblDays.length; sd++) {
                if (tblDays[sd].date === dm[2]) { curDay = tblDays[sd]; break; }
              }
            }
          }
        }

        // Fallback: scan all cells for day pattern
        if (!foundDay) {
          for (var fc = 0; fc < rCells.length; fc++) {
            var fTxt = rCells[fc].textContent.replace(/\s+/g, ' ').trim();
            var fm = fTxt.match(dayPat);
            if (fm) {
              if (!seenDates[fm[2]]) {
                seenDates[fm[2]] = true;
                curDay = { day: fm[1], date: fm[2], label: fm[1] + ' ' + fm[2], activities: [] };
                tblDays.push(curDay);
              } else {
                for (var sd2 = 0; sd2 < tblDays.length; sd2++) {
                  if (tblDays[sd2].date === fm[2]) { curDay = tblDays[sd2]; break; }
                }
              }
              break;
            }
          }
        }

        if (!curDay) continue;

        var actIdx = cols.activity - offset;
        var staIdx = cols.start - offset;
        var endIdx = cols.end - offset;
        var aT = actIdx >= 0 && actIdx < rCells.length ? rCells[actIdx].textContent.replace(/\s+/g, ' ').trim() : '';
        var sT = staIdx >= 0 && staIdx < rCells.length ? rCells[staIdx].textContent.replace(/\s+/g, ' ').trim() : '';
        var eT = endIdx >= 0 && endIdx < rCells.length ? rCells[endIdx].textContent.replace(/\s+/g, ' ').trim() : '';

        if (aT && parseTime12h(sT) !== null && parseTime12h(eT) !== null) {
          curDay.activities.push({ name: aT, start: sT, end: eT, category: classify(aT), minutes: dur(sT, eT) });
          actCount++;
        }
      }

      if (actCount > bestActs) {
        bestActs = actCount;
        bestDays = tblDays;
      }
    }

    var days = bestDays;

    // Week range
    var weekRange = 'Current Week';
    var wrPat = /([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*-\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/;
    var bodyAll = document.body.innerText || '';
    var wm = bodyAll.match(wrPat);
    if (wm) weekRange = wm[1] + ' - ' + wm[2];

    return { days: days, weekRange: weekRange, debug: ['contentScript', 'tables:' + allTables.length, 'days:' + days.length] };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === 'parseSchedule') {
      sendResponse(parseSchedule());
    }
    return true;
  });
})();
