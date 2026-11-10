(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const SETTING = "tgu-class-notifications-v1";
  const TIMETABLE = "tgu-personal-timetable-2026-v1";
  let registration, enabled = false, lastSignature = "", installPrompt, busy = false, pending = false;
  try { enabled = localStorage.getItem(SETTING) === "true"; } catch {}
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // Local notifications use the Notifications API, not a Push subscription.
  const supported = "serviceWorker" in navigator && "Notification" in window && (!isIOS || standalone);
  const unsupportedMessage = isIOS && !standalone
    ? "iPhone・iPadでは、共有メニューの「ホーム画面に追加」で追加し、そのアイコンから開いて通知を有効にしてください（iOS / iPadOS 16.4以降）。"
    : isIOS ? "この端末では通知を利用できません。iOS / iPadOS 16.4以降に更新し、ホーム画面のアイコンから開いてください。"
    : "このブラウザは授業通知に対応していません。";
  function buttons() {
    $("enableNotifications").disabled = !registration || !supported;
    $("enableNotifications").hidden = enabled && supported;
    $("disableNotifications").hidden = !enabled;
  }
  function notificationPayload(background = document.hidden) {
    if (!enabled || !supported || Notification.permission !== "granted") return null;
    const entries = JSON.parse(localStorage.getItem(TIMETABLE) || "[]");
    if (!Array.isArray(entries)) throw new Error("時間割を読み込めませんでした");
    // iOS suspends pages when hidden; show the durable time/room/course text
    // while visible instead of relying on a last-second pagehide update.
    return nextNotificationClass(entries, new Date(), isIOS || background);
  }
  async function sendNotification(payload) {
    if (!registration?.active) return;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error("通知処理がタイムアウトしました")); }, 8000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); event.data.ok ? resolve() : reject(new Error("通知を表示できませんでした")); };
      registration.active.postMessage({ type: "CLASS_NOTIFICATION", payload }, [channel.port2]);
    });
  }
  async function refresh() {
    if (!registration) return;
    if (busy) { pending = true; return; }
    busy = true;
    try {
      const payload = notificationPayload();
      const signature = JSON.stringify(isIOS && payload
        ? { title: payload.title, course: payload.body.split("\n")[0], startAt: payload.startAt }
        : payload);
      if (signature !== lastSignature) { await sendNotification(payload); lastSignature = signature; }
      $("notificationStatus").textContent = !supported ? unsupportedMessage
        : !enabled ? "通知は無効です。"
        : Notification.permission !== "granted" ? "通知権限がありません。ブラウザのサイト設定をご確認ください。"
        : isIOS && payload ? "通知に開始時刻・教室・科目名を表示しました。iOSでは残り時間を毎分通知しません。アプリを開くと最新の授業に更新します。"
        : document.hidden && payload ? "最小化中は開始時刻・教室・科目名の通知を残します。再表示すると最新情報に更新します。"
        : payload ? "授業通知は有効です。画面を開いている間、毎分更新します。"
        : "通知は有効です。今は通知対象の授業がありません（平日5:00以降・当日の未開始授業）。";
    } catch {
      lastSignature = "";
      try { await sendNotification(null); } catch {}
      $("notificationStatus").textContent = "通知を更新できませんでした。時間割の保存状態とブラウザの通知設定をご確認ください。";
    } finally { busy = false; buttons(); if (pending) { pending = false; refresh(); } }
  }
  $("enableNotifications").addEventListener("click", async () => {
    if (!supported || !registration) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { $("notificationStatus").textContent = "通知は許可されませんでした。必要な場合はブラウザのサイト設定から許可してください。"; return; }
      localStorage.setItem(SETTING, "true"); enabled = true; lastSignature = ""; await refresh();
    } catch { $("notificationStatus").textContent = "通知を有効にできませんでした。ホーム画面から起動しているか、端末の通知設定をご確認ください。"; }
  });
  $("disableNotifications").addEventListener("click", async () => {
    enabled = false; lastSignature = "";
    try { localStorage.removeItem(SETTING); } catch {}
    await refresh();
  });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault(); installPrompt = event; $("installApp").hidden = false;
  });
  $("installApp").addEventListener("click", async () => {
    if (!installPrompt) return;
    await installPrompt.prompt(); await installPrompt.userChoice;
    installPrompt = null; $("installApp").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("installApp").hidden = true; $("pwaStatus").textContent = "アプリをインストールしました。"; });
  let updating = false;
  $("updateApp").addEventListener("click", () => {
    if (registration?.waiting) { updating = true; registration.waiting.postMessage({type:"SKIP_WAITING"}); }
  });
  if (!("serviceWorker" in navigator)) { $("pwaStatus").textContent = "このブラウザはアプリ機能に対応していません。通常のサイトとして利用できます。"; return; }
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (updating) location.reload(); });
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type === "REFRESH_CLASS_NOTIFICATION") { lastSignature = ""; refresh(); }
  });
  navigator.serviceWorker.register("./sw.js", {scope:"./", updateViaCache:"none"}).then(async reg => {
    registration = reg;
    const showUpdate = () => { if (reg.waiting) { $("updateApp").hidden = false; $("pwaStatus").textContent = "新しい版があります。保存済みの時間割を引き継いで更新できます。編集中の入力は保存してから更新してください。"; } };
    showUpdate();
    reg.addEventListener("updatefound", () => { reg.installing?.addEventListener("statechange", showUpdate); });
    await navigator.serviceWorker.ready;
    if (!reg.waiting) $("pwaStatus").textContent = isIOS
      ? standalone ? "ホーム画面アプリとして起動しています。授業通知を有効にできます（iOS / iPadOS 16.4以降）。"
        : "共有メニューの「ホーム画面に追加」で追加し、そのアイコンから開いてください。通知にはiOS / iPadOS 16.4以降が必要です。"
      : "アプリの準備ができました。Chromeのメニューからインストールできます。";
    buttons(); await refresh();
  }).catch(() => { $("pwaStatus").textContent = "アプリの準備に失敗しました。オンラインで再読み込みしてください。通常の検索は引き続き利用できます。"; });
  document.addEventListener("visibilitychange", () => { lastSignature = ""; refresh(); });
  window.addEventListener("pagehide", () => {
    if (isIOS) return;
    try { registration?.active?.postMessage({type:"CLASS_NOTIFICATION",payload:notificationPayload(true)}); } catch {}
  });
  window.addEventListener("storage", event => {
    if (event.key === SETTING || event.key === null) { try { enabled = localStorage.getItem(SETTING) === "true"; } catch { enabled = false; } }
    lastSignature = ""; refresh();
  });
  window.addEventListener("timetablechange", () => { lastSignature = ""; refresh(); });
  let minute = "";
  setInterval(() => { if (document.hidden) return; const current = new Date().toISOString().slice(0,16); if (current !== minute) { minute = current; refresh(); } }, 1000);
})();
