(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const SETTING = "tgu-class-notifications-v1";
  const TIMETABLE = "tgu-personal-timetable-2026-v1";
  let registration, enabled = false, lastSignature = "", installPrompt, busy = false, pending = false;
  try { enabled = localStorage.getItem(SETTING) === "true"; } catch {}
  const supported = "serviceWorker" in navigator && "Notification" in window && "PushManager" in window;
  function buttons() {
    $("enableNotifications").disabled = !registration || !supported;
    $("enableNotifications").hidden = enabled;
    $("disableNotifications").hidden = !enabled;
  }
  function notificationPayload(background = document.hidden) {
    if (!enabled || !supported || Notification.permission !== "granted") return null;
    const entries = JSON.parse(localStorage.getItem(TIMETABLE) || "[]");
    if (!Array.isArray(entries)) throw new Error("時間割を読み込めませんでした");
    return nextNotificationClass(entries, new Date(), background);
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
      const signature = JSON.stringify(payload);
      if (signature !== lastSignature) { await sendNotification(payload); lastSignature = signature; }
      $("notificationStatus").textContent = !supported ? "このブラウザは授業通知に対応していません。"
        : !enabled ? "通知は無効です。"
        : Notification.permission !== "granted" ? "通知権限がありません。ブラウザのサイト設定をご確認ください。"
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
    } catch { $("notificationStatus").textContent = "通知設定を保存できませんでした。"; }
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
    if (!reg.waiting) $("pwaStatus").textContent = "アプリの準備ができました。Chromeのメニューからインストールできます。";
    buttons(); await refresh();
  }).catch(() => { $("pwaStatus").textContent = "アプリの準備に失敗しました。オンラインで再読み込みしてください。通常の検索は引き続き利用できます。"; });
  document.addEventListener("visibilitychange", () => { lastSignature = ""; refresh(); });
  window.addEventListener("pagehide", () => {
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
