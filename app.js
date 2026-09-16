const PERIOD_TIMES = {
  1: ["08:30", "10:10"],
  2: ["10:20", "12:00"],
  3: ["12:50", "14:30"],
  4: ["14:40", "16:20"],
  5: ["16:30", "18:10"],
  6: ["18:20", "20:00"],
  7: ["20:10", "21:50"],
};

const state = {
  data: null,
  rooms: [],
  day: "水",
  period: 3,
  term: "1",
};

const termLabels = {
  "1": "第1ターム",
  "2": "第2ターム",
  "3": "第3ターム",
  "4": "第4ターム",
};

const activeTerms = {
  "1": new Set(["春学期", "通年", "第1ターム"]),
  "2": new Set(["春学期", "通年", "第2ターム"]),
  "3": new Set(["秋学期", "通年", "第3ターム"]),
  "4": new Set(["秋学期", "通年", "第4ターム"]),
};

const TERM_CALENDAR = [
  { term: "1", start: 407, end: 603 },
  { term: "2", start: 605, end: 724 },
  { term: "3", start: 1015, end: 1208 },
  { term: "4", start: 1211, end: 1231 },
  { term: "4", start: 101, end: 209 },
];

const TOKYO_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function tokyoParts(date = new Date()) {
  return Object.fromEntries(TOKYO_FORMATTER.formatToParts(date)
    .filter(part => part.type !== "literal")
    .map(part => [part.type, part.value]));
}

function resolveTerm(date = new Date()) {
  const parts = tokyoParts(date);
  const monthDay = Number(parts.month) * 100 + Number(parts.day);
  const active = TERM_CALENDAR.find(range => monthDay >= range.start && monthDay <= range.end);
  if (active) return { term: active.term, isInSession: true };

  if (monthDay <= 406) return { term: "1", isInSession: false };
  if (monthDay === 604) return { term: "2", isInSession: false };
  if (monthDay >= 725 && monthDay <= 1014) return { term: "3", isInSession: false };
  if (monthDay >= 1209 && monthDay <= 1210) return { term: "4", isInSession: false };
  return { term: "1", isInSession: false };
}

function applyAutomaticTerm(date = new Date()) {
  const resolved = resolveTerm(date);
  state.term = resolved.term;
  document.getElementById("termSelect").value = state.term;
  document.getElementById("termAutoNote").textContent = resolved.isInSession
    ? `日本時間の現在日時から${termLabels[state.term]}を選択しています`
    : `授業期間外のため、次の${termLabels[state.term]}を表示しています`;
}

function currentOrNextPeriod(date = new Date()) {
  const parts = tokyoParts(date);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  for (const [period, [start, end]] of Object.entries(PERIOD_TIMES)) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (minutes <= endMin) return Number(period);
    if (minutes < startMin) return Number(period);
  }
  return 7;
}

function japaneseDay(date = new Date()) {
  const dayMap = { Sun: "日", Mon: "月", Tue: "火", Wed: "水", Thu: "木", Fri: "金", Sat: "土" };
  return dayMap[tokyoParts(date).weekday];
}

function buildSchedule() {
  const schedule = new Map(state.rooms.map(room => [room, new Map()]));
  const terms = activeTerms[state.term];
  state.data.courses.forEach(course => {
    if (!terms.has(course.term)) return;
    course.meetings.forEach(meeting => {
      if (meeting.day !== state.day || !schedule.has(meeting.room)) return;
      const roomSchedule = schedule.get(meeting.room);
      const existing = roomSchedule.get(meeting.period) || [];
      existing.push(course);
      roomSchedule.set(meeting.period, existing);
    });
  });
  return schedule;
}

function availabilityFor(roomSchedule) {
  let lastFree = state.period;
  for (let p = state.period + 1; p <= 7; p += 1) {
    if (roomSchedule.has(p)) break;
    lastFree = p;
  }
  const nextPeriod = lastFree < 7 ? lastFree + 1 : null;
  const nextClasses = nextPeriod ? roomSchedule.get(nextPeriod) : null;
  return { lastFree, nextPeriod, nextClasses };
}

function render() {
  if (!state.data) return;
  const schedule = buildSchedule();
  const available = state.rooms.filter(room => !schedule.get(room).has(state.period));
  const grouped = Object.groupBy
    ? Object.groupBy(available, room => room[0])
    : available.reduce((acc, room) => ((acc[room[0]] ||= []).push(room), acc), {});

  document.getElementById("resultCount").textContent = available.length;
  document.getElementById("resultContext").textContent = `${termLabels[state.term]}・${state.day}曜日・${state.period}限`;
  document.querySelector(".results-section").setAttribute("aria-busy", "false");

  const results = document.getElementById("results");
  if (!available.length) {
    results.innerHTML = '<div class="empty-state">この条件で空いている教室は見つかりませんでした。</div>';
    return;
  }

  results.innerHTML = ["C", "N", "S", "W"].filter(building => grouped[building]?.length).map(building => {
    const cards = grouped[building].map(room => {
      const info = availabilityFor(schedule.get(room));
      const range = info.lastFree === state.period
        ? `${state.period}限のみ空き`
        : `${state.period}〜${info.lastFree}限まで連続で空き`;
      const next = info.nextClasses?.length
        ? `次の使用：${info.nextPeriod}限 ${info.nextClasses.map(item => item.courseName).join("／")}`
        : "この後の授業予定なし";
      return `
        <button class="room-card" type="button" data-room="${room}">
          <span class="room-top"><span class="room-name">${room}</span><span class="available-badge">空き</span></span>
          <p class="availability">${range}</p>
          <p class="next-class">${escapeHtml(next)}</p>
        </button>`;
    }).join("");
    return `
      <section class="building-group" aria-labelledby="building-${building}">
        <div class="building-header"><h3 id="building-${building}">${building}棟</h3><span>${grouped[building].length}室</span></div>
        <div class="room-grid">${cards}</div>
      </section>`;
  }).join("");

  results.querySelectorAll("[data-room]").forEach(button => {
    button.addEventListener("click", () => openRoom(button.dataset.room, schedule.get(button.dataset.room)));
  });
}

function openRoom(room, roomSchedule) {
  const periods = Array.from({ length: 7 }, (_, index) => index + 1).map(period => {
    const classes = roomSchedule.get(period) || [];
    const selected = period === state.period ? " is-selected" : "";
    if (!classes.length) {
      return `<div class="period-item is-free${selected}"><div class="period-label">${period}限</div><div><p class="period-status">空き</p><p class="period-detail">${PERIOD_TIMES[period].join("〜")}</p></div></div>`;
    }
    return `<div class="period-item${selected}"><div class="period-label">${period}限</div><div><p class="period-status">${escapeHtml(classes.map(item => item.courseName).join("／"))}</p><p class="period-detail">${PERIOD_TIMES[period].join("〜")}</p></div></div>`;
  }).join("");

  document.getElementById("dialogContent").innerHTML = `
    <div class="dialog-head"><p>${termLabels[state.term]}・${state.day}曜日</p><h2>${room}</h2></div>
    <div class="daily-list">${periods}</div>`;
  document.getElementById("roomDialog").showModal();
}

function selectDay(day) {
  state.day = day;
  document.querySelectorAll("[data-day]").forEach(button => button.classList.toggle("active", button.dataset.day === day));
}

function selectPeriod(period) {
  state.period = Number(period);
  document.querySelectorAll("[data-period]").forEach(button => button.classList.toggle("active", Number(button.dataset.period) === state.period));
}

function searchNow() {
  const now = new Date();
  const day = japaneseDay(now);
  if (!["月", "火", "水", "木", "金", "土"].includes(day)) {
    selectDay("月");
  } else {
    selectDay(day);
  }
  applyAutomaticTerm(now);
  selectPeriod(currentOrNextPeriod(now));
  render();
}

async function init() {
  applyAutomaticTerm();
  selectDay(state.day);
  selectPeriod(state.period);

  document.querySelectorAll("[data-day]").forEach(button => button.addEventListener("click", () => {
    selectDay(button.dataset.day);
    render();
  }));
  document.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
    selectPeriod(button.dataset.period);
    render();
  }));
  document.getElementById("termSelect").addEventListener("change", event => {
    state.term = event.target.value;
    document.getElementById("termAutoNote").textContent = "開講期を手動で選択しています";
    render();
  });
  document.getElementById("nowButton").addEventListener("click", searchNow);

  try {
    const [scheduleResponse, roomsResponse] = await Promise.all([
      fetch("./data/room-schedule-2026.json"),
      fetch("./data/rooms-2026.json"),
    ]);
    if (!scheduleResponse.ok || !roomsResponse.ok) throw new Error("data request failed");
    state.data = await scheduleResponse.json();
    state.rooms = (await roomsResponse.json()).rooms;
    render();
  } catch (error) {
    document.querySelector(".results-section").setAttribute("aria-busy", "false");
    document.getElementById("results").innerHTML = '<div class="empty-state">データを読み込めませんでした。ページを再読み込みしてください。</div>';
  }
}

init();
