(function () {
  'use strict';

  var OT_CATS = ['ot_rta', 'ot_sched', 'dayoff_rta', 'dayoff_sched'];
  var DAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var CAT_LABELS = {
    ot_rta: 'OT by RTA',
    ot_sched: 'OT by Scheduling',
    dayoff_rta: 'Day-off OT by RTA',
    dayoff_sched: 'Day-off OT by Scheduling'
  };
  var CAT_COLORS = {
    ot_rta: '#4A90D9',
    ot_sched: '#7B68EE',
    dayoff_rta: '#E8833A',
    dayoff_sched: '#E05D5D'
  };

  function fmt(hrs) { return hrs.toFixed(2); }
  function toHrs(min) { return Math.round((min / 60) * 100) / 100; }
  function money(n) { return 'EGP ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

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

  function parseShortDate(str) {
    var m = str && str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    var year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  }

  function formatShortDate(date) {
    var year = String(date.getFullYear()).slice(-2);
    return (date.getMonth() + 1) + '/' + date.getDate() + '/' + year;
  }

  function nextDateKey(dateStr) {
    var date = parseShortDate(dateStr);
    if (!date) return null;
    date.setDate(date.getDate() + 1);
    return formatShortDate(date);
  }

  function loadSettings(cb) {
    chrome.storage.sync.get({ hourlyRate: 50, weekStart: 'Mon', bonusThreshold: 9, bonusAmount: 1 }, function (items) { cb(items); });
  }

  function saveSettings(settings, cb) {
    chrome.storage.sync.set(settings, cb);
  }

  function injectedParser() {
    function getDirectRows(table) {
      var rows = [];
      for (var i = 0; i < table.children.length; i++) {
        var child = table.children[i];
        var tag = child.tagName.toUpperCase();
        if (tag === 'TR') rows.push(child);
        else if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') {
          for (var j = 0; j < child.children.length; j++) {
            if (child.children[j].tagName.toUpperCase() === 'TR') rows.push(child.children[j]);
          }
        }
      }
      return rows;
    }

    function getDirectCells(row) {
      var cells = [];
      for (var i = 0; i < row.children.length; i++) {
        var tag = row.children[i].tagName.toUpperCase();
        if (tag === 'TD' || tag === 'TH') cells.push(row.children[i]);
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

    var weekRange = 'Current Week';
    var wrPat = /([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*-\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/;
    var bodyAll = document.body.innerText || '';
    var wm = bodyAll.match(wrPat);
    if (wm) weekRange = wm[1] + ' - ' + wm[2];

    return { days: bestDays, weekRange: weekRange };
  }

  function rotateDays(days, weekStart) {
    var startIndex = DAY_ORDER.indexOf(weekStart);
    if (startIndex === -1) return days.slice();
    return days.slice().sort(function (a, b) {
      var ai = DAY_ORDER.indexOf(a.day);
      var bi = DAY_ORDER.indexOf(b.day);
      var ar = (ai - startIndex + 7) % 7;
      var br = (bi - startIndex + 7) % 7;
      return ar - br;
    });
  }

  function applyWeekStart(data, weekStart) {
    return {
      weekRange: data.weekRange,
      weekStart: weekStart,
      days: rotateDays(data.days || [], weekStart)
    };
  }

  function applyCalendarRule(data) {
    var sourceDays = data.days || [];
    var clonedDays = [];
    var dayMap = {};

    for (var i = 0; i < sourceDays.length; i++) {
      var srcDay = sourceDays[i];
      var clonedDay = { day: srcDay.day, date: srcDay.date, label: srcDay.label, activities: [] };
      clonedDays.push(clonedDay);
      dayMap[srcDay.date] = clonedDay;
    }

    for (var d = 0; d < sourceDays.length; d++) {
      var day = sourceDays[d];
      var lastStartMin = -1;
      var rolloverDays = 0;

      for (var a = 0; a < day.activities.length; a++) {
        var act = day.activities[a];
        var startMin = parseTime12h(act.start);
        var endMin = parseTime12h(act.end);

        if (startMin === null || endMin === null) continue;

        // Detect if the time has wrapped around midnight relative to the previous activity
        if (lastStartMin !== -1 && startMin < lastStartMin) {
          rolloverDays++;
        }
        lastStartMin = startMin;

        // Calculate absolute day offsets for start and end times
        var actStartRollover = rolloverDays;
        var actEndRollover = rolloverDays;
        if (endMin < startMin) {
          actEndRollover++;
        }

        // Helper to get or create target day (ensures no spillovers are discarded)
        function getOrCreateTargetDay(offset) {
          var targetDate = parseShortDate(day.date);
          if (!targetDate) return null;
          targetDate.setDate(targetDate.getDate() + offset);
          var targetKey = formatShortDate(targetDate);
          
          if (!dayMap[targetKey]) {
            var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var dayName = dayNames[targetDate.getDay()];
            var newDay = {
              day: dayName,
              date: targetKey,
              label: dayName + ' ' + targetKey,
              activities: []
            };
            clonedDays.push(newDay);
            dayMap[targetKey] = newDay;
          }
          return dayMap[targetKey];
        }

        if (actStartRollover === actEndRollover) {
          var targetDay = getOrCreateTargetDay(actStartRollover);
          if (targetDay) {
            targetDay.activities.push(act);
          }
        } else {
          // Split at midnight
          var firstDay = getOrCreateTargetDay(actStartRollover);
          if (firstDay) {
            firstDay.activities.push({
              name: act.name,
              start: act.start,
              end: '12:00 AM',
              category: act.category,
              minutes: 1440 - startMin
            });
          }
          var secondDay = getOrCreateTargetDay(actEndRollover);
          if (secondDay) {
            secondDay.activities.push({
              name: act.name,
              start: '12:00 AM',
              end: act.end,
              category: act.category,
              minutes: endMin
            });
          }
        }
      }
    }

    // Chronologically sort activities inside each day to merge rollover work seamlessly
    for (var k = 0; k < clonedDays.length; k++) {
      clonedDays[k].activities.sort(function (a, b) {
        return parseTime12h(a.start) - parseTime12h(b.start);
      });
    }

    return {
      weekRange: data.weekRange,
      weekStart: data.weekStart,
      days: clonedDays
    };
  }

  function calculate(data) {
    var totals = { ot_rta: 0, ot_sched: 0, dayoff_rta: 0, dayoff_sched: 0 };
    var dayRows = [];
    for (var d = 0; d < data.days.length; d++) {
      var day = data.days[d];
      var dt = { ot_rta: 0, ot_sched: 0, dayoff_rta: 0, dayoff_sched: 0 };
      var otActs = [];
      for (var a = 0; a < day.activities.length; a++) {
        var act = day.activities[a];
        if (OT_CATS.indexOf(act.category) !== -1) {
          dt[act.category] += act.minutes;
          totals[act.category] += act.minutes;
          otActs.push(act);
        }
      }
      dayRows.push({ label: day.label, totals: dt, totalMin: dt.ot_rta + dt.ot_sched + dt.dayoff_rta + dt.dayoff_sched, activities: otActs });
    }
    return { totals: totals, grand: totals.ot_rta + totals.ot_sched + totals.dayoff_rta + totals.dayoff_sched, dayRows: dayRows };
  }

  function render(data, settings) {
    var res = calculate(data);
    var grandHrs = toHrs(res.grand);
    var bonusThresholdMin = Math.max(1, Math.round(settings.bonusThreshold * 60));
    var bonusUnitMin = Math.max(1, Math.round(settings.bonusAmount * 60));
    var bonusMin = Math.floor(res.grand / bonusThresholdMin) * bonusUnitMin;
    var bonusHrs = toHrs(bonusMin);
    var payableHrs = toHrs(res.grand + bonusMin);
    var totalPay = payableHrs * settings.hourlyRate;
    var h = '';

    h += '<div class="section-title">OT Breakdown</div>';
    for (var i = 0; i < OT_CATS.length; i++) {
      var cat = OT_CATS[i];
      var mins = res.totals[cat];
      var hrs = toHrs(mins);
      var pct = res.grand > 0 ? Math.round((mins / res.grand) * 100) : 0;
      h += '<div class="cat-row"><span class="cat-dot" style="background:' + CAT_COLORS[cat] + '"></span><span class="cat-label">' + esc(CAT_LABELS[cat]) + '</span><span class="cat-val">' + fmt(hrs) + 'h</span></div>';
      h += '<div class="bar-bg"><div class="bar" style="width:' + pct + '%;background:' + CAT_COLORS[cat] + '"></div></div>';
    }

    h += '<div class="summary">';
    h += '<div class="sum-row"><span>Total OT</span><span class="sum-big">' + fmt(grandHrs) + ' hrs</span></div>';
    h += '<div class="sum-row"><span>Bonus Hours</span><span>' + fmt(bonusHrs) + ' hrs</span></div>';
    h += '<div class="sum-row"><span>Payable Hours</span><span>' + fmt(payableHrs) + ' hrs</span></div>';
    h += '<div class="sum-row"><span>Rate</span><span>' + money(settings.hourlyRate) + '/hr</span></div>';
    h += '<div class="sum-row"><span>Bonus Threshold</span><span>' + fmt(settings.bonusThreshold) + ' hrs</span></div>';
    h += '<div class="sum-row"><span>Bonus Amount</span><span>' + fmt(settings.bonusAmount) + ' hrs</span></div>';
    h += '<div class="sum-row"><span>Week starts</span><span>' + esc(data.weekStart) + '</span></div>';
    h += '</div>';
    h += '<div class="pay-box"><span>Total Pay</span><span class="pay-val">' + money(totalPay) + '</span></div>';

    h += '<div class="section-title" style="margin-top:12px">Daily Breakdown</div>';
    for (var d = 0; d < res.dayRows.length; d++) {
      var dr = res.dayRows[d];
      var hasOT = dr.totalMin > 0;
      h += '<div class="day-row' + (hasOT ? ' day-has-ot' : '') + '" data-idx="' + d + '">';
      h += '<span class="day-arrow">' + (hasOT ? '\u25B6' : '\u25CB') + '</span>';
      h += '<span class="day-label">' + esc(dr.label) + '</span>';
      h += '<span class="day-val">' + (hasOT ? fmt(toHrs(dr.totalMin)) + 'h' : '-') + '</span>';
      h += '</div>';
      h += '<div class="day-detail" id="day-' + d + '">';
      if (hasOT) {
        for (var ai = 0; ai < dr.activities.length; ai++) {
          var act = dr.activities[ai];
          h += '<div class="act-row"><span class="act-name" style="color:' + CAT_COLORS[act.category] + '">' + esc(act.name) + '</span><span class="act-time">' + esc(act.start) + '-' + esc(act.end) + '</span><span class="act-dur">' + fmt(toHrs(act.minutes)) + 'h</span></div>';
        }
      }
      h += '</div>';
    }

    document.getElementById('weekRange').textContent = data.weekRange;
    document.getElementById('results').innerHTML = h;

    var dayHeaders = document.querySelectorAll('.day-row.day-has-ot');
    for (var dh = 0; dh < dayHeaders.length; dh++) {
      (function (el) {
        el.addEventListener('click', function () {
          var idx = el.getAttribute('data-idx');
          var det = document.getElementById('day-' + idx);
          var arrow = el.querySelector('.day-arrow');
          if (det.classList.contains('open')) {
            det.classList.remove('open');
            arrow.textContent = '\u25B6';
          } else {
            det.classList.add('open');
            arrow.textContent = '\u25BC';
          }
        });
      })(dayHeaders[dh]);
    }
  }

  function showError(msg) {
    document.getElementById('weekRange').textContent = '';
    document.getElementById('results').innerHTML = '<div class="error">' + esc(msg) + '</div>';
  }

  function setActiveTab(tabId) {
    var buttons = document.querySelectorAll('.tab-btn');
    var panels = document.querySelectorAll('.tab-panel');
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.toggle('active', buttons[i].getAttribute('data-tab') === tabId);
    for (var j = 0; j < panels.length; j++) panels[j].classList.toggle('active', panels[j].id === tabId);
  }

  function fetchAndRender(settings) {
    document.getElementById('results').innerHTML = '<div class="loading">Scanning schedule...</div>';

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) { showError('No active tab found.'); return; }
      var tab = tabs[0];
      if (!tab.url || tab.url.indexOf('nicecloudsvc.com') === -1) {
        showError('Open the NICE WFM schedule page first, then click this icon.');
        return;
      }

      if (chrome.scripting && chrome.scripting.executeScript) {
        chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: injectedParser }, function (results) {
          if (chrome.runtime.lastError) {
            showError('Cannot read page: ' + chrome.runtime.lastError.message);
            return;
          }
          var best = null;
          for (var r = 0; r < results.length; r++) {
            var res = results[r].result;
            if (!res || !res.days) continue;
            if (!best || res.days.length > best.days.length) best = res;
          }
          handleResult(best || { days: [], weekRange: '' }, settings);
        });
      } else {
        chrome.tabs.sendMessage(tab.id, { action: 'parseSchedule' }, function (response) {
          if (chrome.runtime.lastError) {
            showError('Cannot read page. Reload the extension and refresh the schedule page.');
            return;
          }
          handleResult(response, settings);
        });
      }
    });
  }

  function handleResult(data, settings) {
    if (!data) { showError('No data returned from page.'); return; }
    if (!data.days || data.days.length === 0) {
      showError('No schedule found.');
      return;
    }
    render(applyCalendarRule(applyWeekStart(data, settings.weekStart)), settings);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var rateInput = document.getElementById('hourlyRate');
    var weekStartInput = document.getElementById('weekStart');
    var bonusThresholdInput = document.getElementById('bonusThreshold');
    var bonusAmountInput = document.getElementById('bonusAmount');
    var saveBtn = document.getElementById('saveBtn');
    var statusMsg = document.getElementById('statusMsg');
    var tabButtons = document.querySelectorAll('.tab-btn');

    for (var i = 0; i < tabButtons.length; i++) {
      tabButtons[i].addEventListener('click', function () {
        setActiveTab(this.getAttribute('data-tab'));
      });
    }

    loadSettings(function (settings) {
      rateInput.value = settings.hourlyRate;
      weekStartInput.value = settings.weekStart;
      bonusThresholdInput.value = settings.bonusThreshold;
      bonusAmountInput.value = settings.bonusAmount;
      fetchAndRender(settings);
    });

    saveBtn.addEventListener('click', function () {
      var rate = parseFloat(rateInput.value);
      var weekStart = weekStartInput.value;
      var bonusThreshold = parseFloat(bonusThresholdInput.value);
      var bonusAmount = parseFloat(bonusAmountInput.value);
      if (isNaN(rate) || rate < 0) {
        statusMsg.textContent = 'Enter a valid rate.';
        statusMsg.className = 'status-msg err';
        return;
      }
      if (isNaN(bonusThreshold) || bonusThreshold <= 0) {
        statusMsg.textContent = 'Enter a valid bonus threshold.';
        statusMsg.className = 'status-msg err';
        return;
      }
      if (isNaN(bonusAmount) || bonusAmount <= 0) {
        statusMsg.textContent = 'Enter a valid bonus amount.';
        statusMsg.className = 'status-msg err';
        return;
      }
      saveSettings({ hourlyRate: rate, weekStart: weekStart, bonusThreshold: bonusThreshold, bonusAmount: bonusAmount }, function () {
        statusMsg.textContent = 'Saved!';
        statusMsg.className = 'status-msg ok';
        setTimeout(function () { statusMsg.textContent = ''; }, 2000);
        fetchAndRender({ hourlyRate: rate, weekStart: weekStart, bonusThreshold: bonusThreshold, bonusAmount: bonusAmount });
        setActiveTab('resultsTab');
      });
    });

    // --- MANUAL UPDATER ---
    var extVersionEl = document.getElementById('extVersion');
    var checkUpdateBtn = document.getElementById('checkUpdateBtn');
    var updateStatusMsg = document.getElementById('updateStatusMsg');

    if (extVersionEl && chrome.runtime.getManifest) {
      extVersionEl.textContent = chrome.runtime.getManifest().version;
    }

    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', function () {
        updateStatusMsg.textContent = 'Checking...';
        updateStatusMsg.className = 'status-msg';

        fetch('https://raw.githubusercontent.com/HokageZ/TP-OT-Calculator/master/manifest.json')
          .then(function (r) { return r.json(); })
          .then(function (remote) {
            var current = chrome.runtime.getManifest().version;
            if (remote.version !== current) {
              updateStatusMsg.textContent = 'Update available: v' + remote.version + '. Open Chrome Extensions page to update.';
              updateStatusMsg.className = 'status-msg ok';
            } else {
              updateStatusMsg.textContent = 'Up to date!';
              updateStatusMsg.className = 'status-msg ok';
              setTimeout(function () { updateStatusMsg.textContent = ''; }, 3000);
            }
          })
          .catch(function (err) {
            updateStatusMsg.textContent = 'Check failed. Reload and try again.';
            updateStatusMsg.className = 'status-msg err';
          });
      });
    }

    rateInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveBtn.click();
    });
  });
})();
