/* Uses only the user's saved timetable. Times and term rules come from app.js. */
function nextNotificationClass(entries, date = new Date(), background = false) {
  const p = tokyoParts(date), day = japaneseDay(date);
  const minute = Number(p.hour) * 60 + Number(p.minute);
  const session = resolveTerm(date);
  const year = Number(p.year);
  if (!["月", "火", "水", "木", "金"].includes(day) || minute < 300 || !session.isInSession
    || !(year === 2026 || (year === 2027 && Number(p.month) <= 2))) return null;
  const upcoming = entries.filter(e => e && e.day === day && activeTerms[session.term].has(e.term)
    && PERIOD_TIMES[e.period] && typeof e.name === "string" && typeof e.room === "string")
    .map(e => {
      const time = PERIOD_TIMES[e.period][0];
      const [h, m] = time.split(":").map(Number);
      return { ...e, time, startMinute: h * 60 + m };
    }).filter(e => e.startMinute > minute).sort((a,b) => a.startMinute - b.startMinute);
  if (!upcoming.length) return null;
  const first = upcoming[0];
  const simultaneous = upcoming.filter(e => e.startMinute === first.startMinute);
  const startAt = new Date(`${p.year}-${p.month}-${p.day}T${first.time}:00+09:00`).getTime();
  return {
    title: background ? `${first.time}開始 ｜ ${simultaneous.map(e => e.room).join("／")}` : `次の授業まであと${first.startMinute - minute}分`,
    body: background
      ? `${simultaneous.map(e => e.name).join("／")}\n最新の授業情報はタップして確認（${p.hour}:${p.minute}時点）`
      : `${first.time}開始 ｜ ${simultaneous.map(e => e.room).join("／")}\n${simultaneous.map(e => e.name).join("／")}\n${p.hour}:${p.minute}更新・起動中のみ更新`,
    mode: background ? "static" : "countdown",
    startAt,
    updatedAt: date.getTime(),
  };
}
