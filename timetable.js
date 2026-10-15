(() => {
  "use strict";
  const KEY = "tgu-personal-timetable-2026-v1";
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const terms = ["春学期", "秋学期", "通年", "第1ターム", "第2ターム", "第3ターム", "第4ターム"];
  const $ = id => document.getElementById(id);
  let entries = [], courses = [], editId = null, storageError = "";
  const valid = item => item && typeof item.id === "string" && terms.includes(item.term)
    && days.slice(1).includes(item.day) && Number.isInteger(item.period) && item.period >= 1 && item.period <= 7
    && typeof item.name === "string" && item.name.length <= 150 && typeof item.room === "string" && item.room.length <= 80;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(saved) || !saved.every(valid)) throw new Error("invalid data");
    entries = saved;
  } catch { storageError = "保存済みの時間割を読み込めませんでした。ブラウザの保存設定をご確認ください。"; }

  const dialog = document.createElement("dialog");
  dialog.className = "room-dialog timetable-dialog";
  dialog.setAttribute("aria-labelledby", "timetableTitle");
  dialog.innerHTML = `<form method="dialog"><button class="dialog-close" aria-label="閉じる">×</button></form>
    <div class="dialog-head"><h2 id="timetableTitle">時間割を登録・編集</h2></div>
    <div class="timetable-body">
      <label class="field">授業データから探す<input id="courseSearch" type="search" maxlength="100" placeholder="授業名・教室・科目コード"></label>
      <p id="courseSearchNote" class="term-auto-note">読み込み中です。手入力でも登録できます。</p><div id="courseMatches"></div>
      <form id="timetableForm" class="timetable-fields">
        <label class="field">開講期<select id="personalTerm">${terms.map(t => `<option>${t}</option>`).join("")}</select></label>
        <label class="field">曜日<select id="personalDay">${days.slice(1).map(d => `<option>${d}</option>`).join("")}</select></label>
        <label class="field">時限<select id="personalPeriod">${Object.keys(PERIOD_TIMES).map(p => `<option value="${p}">${p}限</option>`).join("")}</select></label>
        <label class="field">授業名<input id="personalName" required maxlength="150"></label>
        <label class="field">教室<input id="personalRoom" required maxlength="80" placeholder="例：N203"></label>
        <button class="now-button" id="savePersonal" type="submit">追加する</button><button id="cancelPersonalEdit" type="button" hidden>編集をやめる</button>
      </form>
      <p id="personalMessage" role="status"></p><div id="personalEntries"></div>
      <button id="clearTimetable" type="button">時間割をすべて削除</button>
      <p class="term-auto-note">2026年度用。同じ端末・ブラウザで利用できます。サイトデータの削除で時間割も消えます。</p>
    </div>`;
  document.body.append(dialog);
  function persist(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch { $("personalMessage").textContent = "保存できませんでした。ブラウザの保存設定や空き容量をご確認ください。"; return false; }
    entries = next; storageError = ""; renderEntries(); renderUpcoming(); return true;
  }
  function resetForm() { editId = null; $("timetableForm").reset(); $("savePersonal").textContent = "追加する"; $("cancelPersonalEdit").hidden = true; }
  function renderEntries() {
    $("personalEntries").innerHTML = entries.length ? entries.map(e => `<div class="personal-entry"><div><strong>${escapeHtml(e.name)}</strong><br>${escapeHtml(e.term)}・${e.day}曜${e.period}限 ／ ${escapeHtml(e.room)}</div><div><button type="button" data-edit="${escapeHtml(e.id)}">編集</button> <button type="button" data-delete="${escapeHtml(e.id)}">削除</button></div></div>`).join("") : "<p>時間割はまだ登録されていません。</p>";
    $("clearTimetable").disabled = !entries.length;
  }
  function renderUpcoming(date = new Date()) {
    if (storageError) { $("personalUpcoming").textContent = storageError; return; }
    if (!entries.length) { $("personalUpcoming").textContent = "「登録・編集」から時間割を登録すると、次の授業と教室を表示します。"; return; }
    const parts = tokyoParts(date), resolved = resolveTerm(date);
    if (!resolved.isInSession || !(Number(parts.year) === 2026 || (Number(parts.year) === 2027 && Number(parts.month) <= 2))) {
      $("personalUpcoming").textContent = "2026年度の授業期間外です。登録した時間割は「登録・編集」から確認できます。"; return;
    }
    const today = days.indexOf(japaneseDay(date)), minute = Number(parts.hour) * 60 + Number(parts.minute);
    const todayDate = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+09:00`);
    const events = [];
    for (let offset = 0; offset <= 7; offset++) {
      const target = new Date(todayDate.getTime() + offset * 86400000), session = resolveTerm(target);
      if (!session.isInSession) continue;
      for (const e of entries) {
        if (e.day !== days[(today + offset) % 7] || !activeTerms[session.term].has(e.term)) continue;
        const mins = PERIOD_TIMES[e.period].map(time => { const [h,m] = time.split(":").map(Number); return h*60+m; });
        events.push({ ...e, offset, start: mins[0], end: mins[1] });
      }
    }
    events.sort((a,b) => a.offset-b.offset || a.start-b.start);
    const current = events.filter(e => e.offset === 0 && e.start <= minute && minute < e.end);
    const nextEvent = events.find(e => e.offset > 0 || e.start > minute);
    const next = nextEvent ? events.filter(e => e.offset === nextEvent.offset && e.start === nextEvent.start) : [];
    const card = (label, items) => `<div class="personal-class"><strong>${label}</strong>${items.map(e => `<p>${escapeHtml(e.name)} ／ <b>${escapeHtml(e.room)}</b><br><small>${e.offset === 0 ? "今日" : e.offset === 1 ? "明日" : `${e.day}曜日` }・${e.period}限（${PERIOD_TIMES[e.period].join("〜")}）</small></p>`).join("")}</div>`;
    const remaining = nextEvent && nextEvent.offset === 0 ? `開始まであと${nextEvent.start-minute}分` : "";
    $("personalUpcoming").innerHTML = (current.length ? card("現在の授業", current) : "<p>現在、登録された授業はありません。</p>")
      + (next.length ? card(`次の授業 ${remaining}`, next) : "<p>今後1週間に登録された授業はありません。</p>")
      + "<small>日本時間・通常の曜日の時間割で案内しています。祝日・授業振替は反映されません。</small>";
  }
  $("editTimetable").addEventListener("click", () => { renderEntries(); dialog.showModal(); });
  $("cancelPersonalEdit").addEventListener("click", resetForm);
  $("timetableForm").addEventListener("submit", event => {
    event.preventDefault();
    const entry = { id: editId || crypto.randomUUID(), term: $("personalTerm").value, day: $("personalDay").value,
      period: Number($("personalPeriod").value), name: $("personalName").value.trim(), room: $("personalRoom").value.trim() };
    if (!entry.name || !entry.room || !valid(entry)) { $("personalMessage").textContent = "授業名と教室を入力してください。"; return; }
    if (entries.some(e => e.id !== entry.id && e.term === entry.term && e.day === entry.day && e.period === entry.period && e.name === entry.name && e.room === entry.room)) {
      $("personalMessage").textContent = "同じ授業は登録済みです。"; return;
    }
    if (persist([...entries.filter(e => e.id !== entry.id), entry])) { resetForm(); $("personalMessage").textContent = "このブラウザに保存しました。"; }
  });
  $("personalEntries").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit]"), remove = event.target.closest("[data-delete]");
    if (edit) {
      const e = entries.find(item => item.id === edit.dataset.edit); if (!e) return;
      editId = e.id;
      for (const [id, value] of Object.entries({ personalTerm:e.term, personalDay:e.day, personalPeriod:e.period, personalName:e.name, personalRoom:e.room })) $(id).value = value;
      $("savePersonal").textContent = "変更を保存"; $("cancelPersonalEdit").hidden = false; $("personalName").focus();
    }
    if (remove && confirm("この授業を時間割から削除しますか？") && persist(entries.filter(e => e.id !== remove.dataset.delete))) { resetForm(); $("personalMessage").textContent = "削除しました。"; }
  });
  $("clearTimetable").addEventListener("click", () => { if (confirm("このブラウザに保存した時間割をすべて削除しますか？") && persist([])) { resetForm(); $("personalMessage").textContent = "時間割をすべて削除しました。"; } });
  let matches = [];
  $("courseSearch").addEventListener("input", () => {
    const query = $("courseSearch").value.trim().toLocaleLowerCase();
    const all = query ? courses.filter(c => `${c.courseName} ${c.courseCode} ${c.meetings.map(m => m.room).join(" ")}`.toLocaleLowerCase().includes(query)) : [];
    matches = all.slice(0, 20);
    $("courseSearchNote").textContent = query ? `${all.length}件（先頭20件まで表示）。選択後に教室等を修正できます。` : "授業名・教室・科目コードで検索できます。見つからない授業は下で手入力できます。";
    $("courseMatches").innerHTML = matches.map((c,i) => `<button type="button" data-course="${i}">${escapeHtml(c.courseName)}<small>${escapeHtml(c.term)}・クラス${escapeHtml(c.class)}・${escapeHtml(c.teacher)} ／ ${escapeHtml(c.meetings.map(m => `${m.day}${m.period}限 ${m.room}`).join("／"))}</small></button>`).join("");
  });
  $("courseMatches").addEventListener("click", event => {
    const button = event.target.closest("[data-course]"); if (!button) return;
    const course = matches[Number(button.dataset.course)], meeting = course.meetings[0]; if (!meeting) return;
    resetForm(); $("personalTerm").value = course.term; $("personalDay").value = meeting.day; $("personalPeriod").value = meeting.period;
    $("personalName").value = course.courseName; $("personalRoom").value = meeting.room;
    $("personalMessage").textContent = "内容を確認して「追加する」を押してください。複数の曜日・時限がある授業は、それぞれ登録してください。";
  });
  fetch("./data/room-schedule-2026.json?v=20260928").then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
    courses = data.courses.filter(c => terms.includes(c.term) && c.meetings.length);
    $("courseSearchNote").textContent = "授業名・教室・科目コードで検索できます。見つからない授業は手入力できます。";
  }).catch(() => { $("courseSearchNote").textContent = "授業データを読み込めませんでした。手入力で登録できます。"; });
  window.addEventListener("storage", event => { if (event.key === KEY || event.key === null) { try { const data = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(data) && data.every(valid)) { entries = data; storageError = ""; renderEntries(); renderUpcoming(); } } catch {} } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderUpcoming(); });
  setInterval(renderUpcoming, 30000);
  renderUpcoming();
})();
