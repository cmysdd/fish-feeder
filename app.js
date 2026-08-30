const BROKER_URL = "wss://mixio.mixly.cn:8084";
const CONFIG_KEY = "fish_feeder_mixio_config_v1";
const HISTORY_KEY = "fish_feeder_history_v1";
const COMMAND_VALID_SECONDS = 45;
const DEVICE_STALE_MS = 180000;
const MAX_HISTORY = 30;
const MAX_SCHEDULES = 6;
const DEFAULT_USERNAME = "2675752317@qq.com";
const DEFAULT_PROJECT = "fish";
const MOTION_SEQUENCE_FIRMWARE = "1.5.3";

const state = {
  client: null,
  config: null,
  brokerConnected: false,
  deviceOnline: false,
  lastDeviceAt: 0,
  lastDeviceUptime: 0,
  pendingId: "",
  pendingExpiresAt: 0,
  pendingScheduleId: "",
  pendingScheduleExpiresAt: 0,
  pendingSchedules: null,
  pendingConfigId: "",
  pendingConfigExpiresAt: 0,
  pendingConfigStateChecks: 0,
  pendingServoTestId: "",
  pendingServoTestExpiresAt: 0,
  deviceConfigDirty: false,
  deviceConfigSupported: false,
  deviceFirmware: "",
  editingScheduleIndex: -1,
  telemetry: null,
  history: loadHistory()
};

const $ = (id) => document.getElementById(id);
const els = {
  brokerDot: $("broker-dot"),
  brokerStatus: $("broker-status"),
  deviceDot: $("device-dot"),
  deviceStatus: $("device-status"),
  deviceId: $("device-id"),
  feedButton: $("feed-button"),
  feedButtonTitle: $("feed-button-title"),
  feedButtonNote: $("feed-button-note"),
  cooldownLabel: $("cooldown-label"),
  actionMessage: $("action-message"),
  refreshState: $("refresh-state"),
  openDeviceWifi: $("open-device-wifi"),
  wifiHelp: $("wifi-help"),
  lastSeen: $("last-seen"),
  deviceIp: $("device-ip"),
  wifiName: $("wifi-name"),
  rssi: $("rssi"),
  freeHeap: $("free-heap"),
  firmware: $("firmware"),
  clockState: $("clock-state"),
  dailyFeeds: $("daily-feeds"),
  lastFeed: $("last-feed"),
  lastFeedSource: $("last-feed-source"),
  lastError: $("last-error"),
  configStatus: $("config-status"),
  deviceConfigForm: $("device-config-form"),
  servoMode: $("servo-mode"),
  continuousHelp: $("continuous-help"),
  positionalHelp: $("positional-help"),
  closedAngle: $("closed-angle"),
  closedAngleNumber: $("closed-angle-number"),
  closedAngleOutput: $("closed-angle-output"),
  openAngle: $("open-angle"),
  openAngleNumber: $("open-angle-number"),
  openAngleOutput: $("open-angle-output"),
  positionalDirection: $("positional-direction"),
  positionalMoveMs: $("positional-move-ms"),
  positionalReturnMs: $("positional-return-ms"),
  travelAngle: $("travel-angle"),
  turnDegrees: $("turn-degrees"),
  turnDegreesNumber: $("turn-degrees-number"),
  turnDegreesOutput: $("turn-degrees-output"),
  msPerRev: $("ms-per-rev"),
  forwardUs: $("forward-us"),
  reverseUs: $("reverse-us"),
  stopUs: $("stop-us"),
  continuousDirection: $("continuous-direction"),
  continuousReturn: $("continuous-return"),
  actionPauseMs: $("action-pause-ms"),
  minInterval: $("min-interval"),
  maxFeeds: $("max-feeds"),
  saveDeviceConfig: $("save-device-config"),
  resetDeviceConfig: $("reset-device-config"),
  testServo: $("test-servo"),
  servoTestStatus: $("servo-test-status"),
  deviceConfigError: $("device-config-error"),
  addSchedule: $("add-schedule"),
  scheduleList: $("schedule-list"),
  scheduleDialog: $("schedule-dialog"),
  scheduleForm: $("schedule-form"),
  scheduleDialogTitle: $("schedule-dialog-title"),
  scheduleTime: $("schedule-time"),
  scheduleEnabled: $("schedule-enabled"),
  saveSchedule: $("save-schedule"),
  scheduleError: $("schedule-error"),
  toast: $("toast"),
  historyBody: $("history-body"),
  settingsDialog: $("settings-dialog"),
  settingsForm: $("settings-form"),
  settingsError: $("settings-error"),
  username: $("mixio-username"),
  project: $("mixio-project"),
  password: $("mixio-password"),
  commandSecret: $("command-secret"),
  remember: $("remember-config")
};

const statusLabels = {
  sent: "已发送",
  processing: "执行中",
  completed: "已完成",
  duplicate: "已去重",
  rejected: "已拒绝",
  failed: "失败",
  timeout: "未确认"
};

const reasonLabels = {
  motor_sequence_completed: "舵机动作完成",
  duplicate_command: "重复命令",
  command_expired: "命令已过期",
  invalid_signature: "签名无效",
  invalid_payload: "数据格式错误",
  invalid_portion: "份量超出范围",
  cooldown: "投喂间隔过短",
  daily_limit: "达到 24 小时上限",
  device_busy: "设备正在执行上一条动作",
  invalid_schedule: "定时计划格式无效",
  stale_schedule: "另一台手机已保存更新的计划，请刷新后重试",
  schedule_updated: "定时计划已更新",
  schedule_cooldown: "定时任务因安全间隔被跳过",
  schedule_daily_limit: "定时任务因 24 小时上限被跳过",
  clock_not_ready: "设备时间未同步",
  servo_failed: "舵机动作失败",
  config_updated: "设备参数已更新",
  invalid_config: "设备参数超出范围",
  stale_config: "另一台手机已保存更新的参数，请刷新后重试",
  servo_test_completed: "舵机测试动作完成"
};

function safeStorageGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function safeStorageSet(storage, key, value) {
  try { storage.setItem(key, value); return true; } catch { return false; }
}

function safeStorageRemove(storage, key) {
  try { storage.removeItem(key); } catch { /* no-op */ }
}

function loadConfig() {
  const raw = safeStorageGet(sessionStorage, CONFIG_KEY) || safeStorageGet(localStorage, CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return validateConfig(parsed, false) ? parsed : null;
  } catch {
    return null;
  }
}

function encodeSharedConfig(config) {
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeSharedConfig(encoded) {
  const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function importSharedConfig() {
  const match = location.hash.match(/^#config=([A-Za-z0-9_-]+)$/);
  if (!match) return false;

  try {
    const config = decodeSharedConfig(match[1]);
    if (!validateConfig(config, false)) throw new Error("授权内容不完整");
    safeStorageSet(localStorage, CONFIG_KEY, JSON.stringify(config));
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return true;
  } catch {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return false;
  }
}

function loadHistory() {
  const raw = safeStorageGet(localStorage, HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  safeStorageSet(localStorage, HISTORY_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY)));
}

function topic(name) {
  return `${state.config.username}/${state.config.project}/${name}`;
}

function setBrokerStatus(kind, text) {
  els.brokerStatus.textContent = text;
  els.brokerDot.className = `status-dot status-${kind}`;
}

function setDeviceStatus(online, text = online ? "在线" : "离线") {
  state.deviceOnline = online;
  els.deviceStatus.textContent = text;
  els.deviceDot.className = `status-dot status-${online ? "online" : "offline"}`;
  updateControls();
}

function setActionMessage(text, kind = "") {
  els.actionMessage.textContent = text;
  els.actionMessage.className = `action-message ${kind}`.trim();
}

let toastTimer = 0;
function showToast(text, kind = "") {
  window.clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.className = `toast is-visible${kind === "error" ? " is-error" : ""}`;
  toastTimer = window.setTimeout(() => {
    els.toast.className = "toast";
  }, 3600);
}

function formatTime(value, includeDate = false) {
  if (!value) return "--";
  const date = typeof value === "number" && value < 100000000000 ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(includeDate ? { month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function isFreshDeviceTime(milliseconds) {
  return milliseconds > 0 && Math.abs(Date.now() - milliseconds) < DEVICE_STALE_MS;
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function signCommand(command, secret) {
  if (!crypto.subtle) throw new Error("当前浏览器不支持安全签名，请使用最新版 Chrome、Edge 或 Safari");
  const encoder = new TextEncoder();
  const data = command.action === "set_schedule" ? command.schedule_data
    : command.action === "set_config" ? command.config_data
    : command.portion;
  const canonical = [command.v, command.id, command.action, data, command.issued_at, command.expires_at].join("|");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validateConfig(config, showError = true) {
  const fail = (message) => {
    if (showError) els.settingsError.textContent = message;
    return false;
  };
  if (!config || !config.username?.trim()) return fail("请输入 MixIO 用户名。");
  if (config.username.trim().startsWith("@")) return fail("请使用账号项目，不要使用公开的 Mixly Key 项目。");
  if (config.username.includes("/") || config.project?.includes("/")) return fail("用户名和项目名称不能包含斜杠。");
  if (!config.project?.trim()) return fail("请输入项目名称。");
  if (!config.password) return fail("请输入项目密码。");
  if (!config.commandSecret || config.commandSecret.length < 24) return fail("命令签名密钥至少需要 24 个字符。");
  return true;
}

function fillSettings(config) {
  els.username.value = config?.username || DEFAULT_USERNAME;
  els.project.value = config?.project || DEFAULT_PROJECT;
  els.password.value = config?.password || "";
  els.commandSecret.value = config?.commandSecret || "";
  els.remember.checked = Boolean(safeStorageGet(localStorage, CONFIG_KEY));
}

function openSettings() {
  fillSettings(state.config);
  els.settingsError.textContent = "";
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function closeSettings() {
  if (els.settingsDialog.open) els.settingsDialog.close();
}

function disconnectClient() {
  if (state.client) {
    state.client.removeAllListeners();
    state.client.end(true);
  }
  state.client = null;
  state.brokerConnected = false;
  setBrokerStatus("idle", state.config ? "已断开" : "未配置");
  setDeviceStatus(false, "未知");
}

function connectMixIO() {
  disconnectClient();
  if (!state.config) {
    setActionMessage("请先完成连接设置。");
    return;
  }
  if (!window.mqtt?.connect) {
    setBrokerStatus("offline", "组件加载失败");
    setActionMessage("无法加载 MQTT 组件，请检查网络后刷新页面。", "error");
    return;
  }

  setBrokerStatus("connecting", "连接中");
  const clientId = `fish_web_${Math.random().toString(16).slice(2, 10)}`;
  const client = window.mqtt.connect(BROKER_URL, {
    clientId,
    username: state.config.username,
    password: state.config.password,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 3000,
    connectTimeout: 12000
  });
  state.client = client;

  client.on("connect", () => {
    state.brokerConnected = true;
    setBrokerStatus("online", "已连接");
    const topics = [topic("feeder_ack"), topic("feeder_state"), topic("feeder_online")];
    client.subscribe(topics, { qos: 1 }, (error) => {
      if (error) {
        setActionMessage(`订阅失败：${error.message}`, "error");
        return;
      }
      requestState();
      setActionMessage("MixIO 已连接，等待投喂器上线。", "success");
    });
    updateControls();
  });

  client.on("message", handleMessage);
  client.on("reconnect", () => setBrokerStatus("connecting", "重连中"));
  client.on("offline", () => {
    state.brokerConnected = false;
    setBrokerStatus("offline", "网络中断");
    updateControls();
  });
  client.on("close", () => {
    state.brokerConnected = false;
    setBrokerStatus("offline", "已断开");
    updateControls();
  });
  client.on("error", (error) => {
    setBrokerStatus("offline", "连接失败");
    setActionMessage(`MixIO 连接失败：${error.message}`, "error");
  });
}

function parseMessage(message) {
  try { return JSON.parse(message.toString()); } catch { return null; }
}

function handleMessage(receivedTopic, message) {
  const payload = parseMessage(message);
  if (!payload) return;

  if (receivedTopic === topic("feeder_online")) {
    const messageTime = Number(payload.ts || 0) * 1000;
    const fresh = isFreshDeviceTime(messageTime);
    state.lastDeviceAt = messageTime;
    setDeviceStatus(payload.online === true && fresh, payload.online === true && fresh ? "在线" : "离线");
    if (payload.device_id) els.deviceId.textContent = payload.device_id;
    if (payload.online === true && fresh) requestState();
    return;
  }

  if (receivedTopic === topic("feeder_state")) {
    state.telemetry = payload;
    const messageTime = Number(payload.ts || 0) * 1000;
    const fresh = isFreshDeviceTime(messageTime);
    state.lastDeviceAt = messageTime;
    setDeviceStatus(fresh, fresh ? "在线" : (payload.clock_ready === false ? "时间同步中" : "状态已过期"));
    renderTelemetry(payload);
    return;
  }

  if (receivedTopic === topic("feeder_ack")) {
    const messageTime = Number(payload.ts || 0) * 1000;
    if (messageTime > 0) {
      state.lastDeviceAt = messageTime;
      if (isFreshDeviceTime(messageTime)) setDeviceStatus(true, "在线");
    }
    handleAcknowledgement(payload);
  }
}

function renderTelemetry(payload) {
  const uptime = Number(payload.uptime_s);
  const restarted = Number.isFinite(uptime) && state.lastDeviceUptime > uptime + 3;
  if (Number.isFinite(uptime)) state.lastDeviceUptime = uptime;

  if (state.pendingConfigId && payload.last_config_command_id === state.pendingConfigId) {
    confirmDeviceConfigSaved("设备状态已确认参数保存成功");
  }
  if (
    state.pendingServoTestId &&
    payload.last_servo_test_command_id === state.pendingServoTestId &&
    payload.last_servo_test_status === "completed"
  ) {
    state.pendingServoTestId = "";
    state.pendingServoTestExpiresAt = 0;
    els.servoTestStatus.textContent = "测试完成";
    els.deviceConfigError.textContent = "";
    setActionMessage("设备状态已确认舵机测试完成。", "success");
    showToast("舵机测试完成");
  }
  if (state.pendingId && payload.last_completed_feed_command_id === state.pendingId) {
    confirmManualFeedCompleted(state.pendingId, "设备状态已确认投喂完成。");
  }
  if (restarted) handleDeviceRestartDuringCommand(payload.reset_reason);

  els.deviceId.textContent = payload.device_id || "feeder-001";
  els.lastSeen.textContent = formatTime(payload.ts || Date.now());
  els.deviceIp.textContent = payload.ip || "--";
  els.wifiName.textContent = payload.wifi_ssid || "--";
  els.rssi.textContent = Number.isFinite(Number(payload.rssi)) ? `${payload.rssi} dBm` : "--";
  els.freeHeap.textContent = Number.isFinite(Number(payload.free_heap)) ? `${payload.free_heap} B` : "--";
  els.firmware.textContent = payload.firmware || "--";
  state.deviceFirmware = String(payload.firmware || "");
  els.clockState.textContent = payload.clock_ready === true ? "已同步（北京时间）" : "同步中";
  els.dailyFeeds.textContent = Number.isFinite(Number(payload.feeds_24h))
    ? `${payload.feeds_24h}/${payload.max_feeds_24h || "--"} 次` : "--";
  els.lastFeed.textContent = payload.last_feed_at ? formatTime(payload.last_feed_at, true) : "暂无";
  els.lastFeedSource.textContent = payload.last_feed_source === "schedule"
    ? "定时计划"
    : payload.last_feed_source === "manual" ? "手机手动" : "--";
  els.lastError.textContent = reasonLabels[payload.last_error] || payload.last_error || "运行正常";
  setDeviceConfigForm(payload);
  els.openDeviceWifi.disabled = !payload.config_url;
  els.openDeviceWifi.title = payload.config_url
    ? "需要手机和设备处于同一个家庭 Wi-Fi"
    : "设备尚未报告局域网地址";
  els.wifiHelp.textContent = payload.config_url
    ? `手机需和设备在同一家庭 Wi-Fi；打开 ${payload.ip || "设备 IP"} 后可修改并保存。`
    : "设备在线后，这里会显示局域网 Wi-Fi 设置入口。";
  renderSchedules(Array.isArray(payload.schedules) ? payload.schedules : []);
  updateControls();
}

function setDeviceConfigForm(payload = {}) {
  const hasMotionFields = Object.prototype.hasOwnProperty.call(payload, "servo_mode") &&
    Object.prototype.hasOwnProperty.call(payload, "positional_move_ms");
  const firmware = String(payload.firmware || state.deviceFirmware || "");
  const firmwareSupportsMotion = firmwareVersionAtLeast(firmware, MOTION_SEQUENCE_FIRMWARE);
  state.deviceConfigSupported = hasMotionFields && firmwareSupportsMotion;
  if (state.deviceConfigDirty || state.pendingConfigId) return;
  const mode = clampInteger(payload.servo_mode, 0, 1, 1);
  const closed = clampInteger(payload.servo_closed_angle, 0, 180, 90);
  const open = clampInteger(payload.servo_open_angle, 0, 180, 180);
  const positionalDirection = open >= closed ? 0 : 1;
  const positionalTravel = Math.max(1, Math.abs(open - closed));
  const turnDegrees = clampInteger(payload.continuous_turn_degrees, 1, 360, 90);
  const msPerRev = clampInteger(payload.continuous_ms_per_rev, 250, 10000, 4000);
  const forwardUs = clampInteger(payload.continuous_forward_us, 1000, 2000, 1700);
  const reverseUs = clampInteger(payload.continuous_reverse_us, 1000, 2000, 1300);
  const stopUs = clampInteger(payload.continuous_stop_us, 1400, 1600, 1500);
  const direction = clampInteger(payload.continuous_direction, 0, 1, 0);
  const continuousReturn = payload.continuous_return === true || payload.continuous_return === 1 ? 1 : 0;
  const positionalMoveMs = clampInteger(payload.positional_move_ms, 100, 10000, 1000);
  const actionPauseMs = clampInteger(payload.action_pause_ms, 0, 10000, 1000);
  const positionalReturnMs = clampInteger(payload.positional_return_ms, 100, 10000, 1000);
  els.servoMode.value = String(mode);
  const interval = clampInteger(payload.min_interval_seconds, 10, 86400, 60);
  const maxFeeds = clampInteger(payload.max_feeds_24h, 1, 100, 8);
  syncAngleInput("closed", closed);
  syncAngleInput("open", positionalTravel);
  els.positionalDirection.value = String(positionalDirection);
  syncTurnDegrees(turnDegrees);
  els.msPerRev.value = String(msPerRev);
  els.forwardUs.value = String(forwardUs);
  els.reverseUs.value = String(reverseUs);
  els.stopUs.value = String(stopUs);
  els.continuousDirection.value = String(direction);
  els.continuousReturn.value = String(continuousReturn);
  els.positionalMoveMs.value = String(positionalMoveMs);
  els.actionPauseMs.value = String(actionPauseMs);
  els.positionalReturnMs.value = String(positionalReturnMs);
  els.minInterval.value = String(interval);
  els.maxFeeds.value = String(maxFeeds);
  els.configStatus.textContent = state.pendingConfigId
    ? "正在保存…"
    : state.deviceConfigSupported
      ? "已读取设备参数"
      : firmware && !firmwareSupportsMotion
        ? `当前固件${firmware}，请烧录${MOTION_SEQUENCE_FIRMWARE}`
        : `等待设备回传${MOTION_SEQUENCE_FIRMWARE}参数`;
  els.deviceConfigError.textContent = state.deviceConfigSupported
    ? ""
    : firmware && !firmwareSupportsMotion
      ? `网页已经是${MOTION_SEQUENCE_FIRMWARE}动作协议，但ESP8266仍是${firmware}。必须重新烧录主固件，刷新网页不能升级单片机。`
      : "等待设备回传完整动作参数。";
  els.saveDeviceConfig.disabled = !state.brokerConnected || !state.deviceOnline || !state.deviceConfigSupported || Boolean(state.pendingConfigId);
  els.resetDeviceConfig.disabled = !state.brokerConnected || !state.deviceOnline || !state.deviceConfigSupported || Boolean(state.pendingConfigId);
  els.testServo.disabled = !state.brokerConnected || !state.deviceOnline || !state.deviceConfigSupported || state.deviceConfigDirty || Boolean(state.pendingConfigId) || Boolean(state.pendingServoTestId);
  els.servoTestStatus.textContent = state.pendingServoTestId
    ? "设备正在执行测试…"
    : state.deviceConfigDirty
      ? "参数尚未保存，请先保存到投喂器"
      : "当前参数已保存，可空载测试一次";
  updateServoModeVisibility();
}

function firmwareVersionAtLeast(actual, required) {
  const parse = (value) => String(value).match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  const left = parse(actual);
  const right = parse(required);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function syncAngleInput(name, value) {
  const range = els[`${name}Angle`];
  const number = els[`${name}AngleNumber`];
  const output = els[`${name}AngleOutput`];
  range.value = String(value);
  number.value = String(value);
  output.textContent = `${value}°`;
  updateServoModeVisibility();
}

function bindAngleInputs(name) {
  const range = els[`${name}Angle`];
  const number = els[`${name}AngleNumber`];
  const output = els[`${name}AngleOutput`];
  const update = (value) => {
    const minimum = name === "open" ? 1 : 0;
    const next = clampInteger(value, minimum, 180, Number(range.value));
    range.value = String(next);
    number.value = String(next);
    output.textContent = `${next}°`;
    markDeviceConfigDirty();
    updateServoModeVisibility();
  };
  range.addEventListener("input", () => update(range.value));
  number.addEventListener("input", () => update(number.value));
}

function markDeviceConfigDirty() {
  state.deviceConfigDirty = true;
  els.configStatus.textContent = "参数尚未保存";
  els.servoTestStatus.textContent = "参数尚未保存，请先保存到投喂器";
  els.deviceConfigError.textContent = "请先点击“保存到投喂器”，收到设备确认后再测试。";
  updateControls();
}

function positionalTargetAngle() {
  const closed = Number(els.closedAngle.value);
  const travel = Number(els.openAngle.value);
  return closed + (els.positionalDirection.value === "0" ? travel : -travel);
}

function formatDuration(milliseconds) {
  if (milliseconds % 1000 === 0) return `${milliseconds / 1000}秒`;
  return `${(milliseconds / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}秒`;
}

function syncTurnDegrees(value) {
  els.turnDegrees.value = String(value);
  els.turnDegreesNumber.value = String(value);
  els.turnDegreesOutput.textContent = `${value}°`;
}

function updateServoModeVisibility() {
  const continuous = els.servoMode.value === "1";
  document.querySelectorAll(".continuous-field").forEach((element) => {
    element.hidden = !continuous;
  });
  document.querySelectorAll(".positional-field").forEach((element) => {
    element.hidden = continuous;
  });
  els.continuousHelp.hidden = !continuous;
  els.positionalHelp.hidden = continuous;
  const pauseMs = clampInteger(els.actionPauseMs.value, 0, 10000, 1000);
  if (continuous) {
    const degrees = clampInteger(els.turnDegrees.value, 1, 360, 90);
    const msPerRev = clampInteger(els.msPerRev.value, 250, 10000, 4000);
    const runMs = Math.max(50, Math.round(degrees * msPerRev / 360));
    const first = els.continuousDirection.value === "0" ? "顺时针" : "逆时针";
    const reverse = first === "顺时针" ? "逆时针" : "顺时针";
    els.travelAngle.textContent = els.continuousReturn.value === "1"
      ? `${first}${degrees}°（约${formatDuration(runMs)}） → 停留${formatDuration(pauseMs)} → ${reverse}${degrees}°`
      : `${first}${degrees}°（约${formatDuration(runMs)}） → 停留${formatDuration(pauseMs)}`;
    return;
  }

  const travel = clampInteger(els.openAngle.value, 1, 180, 90);
  const target = positionalTargetAngle();
  const moveMs = clampInteger(els.positionalMoveMs.value, 100, 10000, 1000);
  const returnMs = clampInteger(els.positionalReturnMs.value, 100, 10000, 1000);
  const first = els.positionalDirection.value === "0" ? "顺时针" : "逆时针";
  const reverse = first === "顺时针" ? "逆时针" : "顺时针";
  els.travelAngle.textContent = target < 0 || target > 180
    ? `目标位置${target}°超出0～180°，请调整起始位置、方向或角度`
    : `${first}${travel}°（${formatDuration(moveMs)}，到${target}°） → 停留${formatDuration(pauseMs)} → ${reverse}${travel}°（${formatDuration(returnMs)}）`;
}

function bindTurnDegrees() {
  const update = (value) => {
    const next = clampInteger(value, 1, 360, Number(els.turnDegrees.value));
    syncTurnDegrees(next);
    markDeviceConfigDirty();
    updateServoModeVisibility();
  };
  els.turnDegrees.addEventListener("input", () => update(els.turnDegrees.value));
  els.turnDegreesNumber.addEventListener("input", () => update(els.turnDegreesNumber.value));
}

function normalizeSchedule(value) {
  return {
    enabled: value?.enabled === true || value?.enabled === 1,
    hour: Math.max(0, Math.min(23, Number(value?.hour || 0))),
    minute: Math.max(0, Math.min(59, Number(value?.minute || 0))),
    portion: 1,
    daysMask: Math.max(1, Math.min(127, Number(value?.days_mask ?? value?.daysMask ?? 127)))
  };
}

function currentSchedules() {
  const source = state.pendingSchedules || state.telemetry?.schedules || [];
  return source.map(normalizeSchedule).slice(0, MAX_SCHEDULES);
}

function scheduleTimeLabel(schedule) {
  return `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
}

function scheduleDaysLabel(mask) {
  if (mask === 127) return "每天";
  if (mask === 62) return "工作日";
  if (mask === 65) return "周末";
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return labels.filter((_, index) => (mask & (1 << index)) !== 0).join("、");
}

function nextScheduleLabel(schedule) {
  if (!schedule.enabled) return "不会自动执行";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23"
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const baseDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const currentMinutes = parts.hour * 60 + parts.minute;
  const targetMinutes = schedule.hour * 60 + schedule.minute;
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  for (let offset = 0; offset <= 7; offset += 1) {
    const weekday = new Date(baseDay + offset * 86400000).getUTCDay();
    if ((schedule.daysMask & (1 << weekday)) === 0) continue;
    if (offset === 0 && targetMinutes <= currentMinutes) continue;
    const dayLabel = offset === 0 ? "今天" : offset === 1 ? "明天" : weekdays[weekday];
    return `下次 ${dayLabel} ${scheduleTimeLabel(schedule)}`;
  }
  return "等待下个周期";
}

function scheduleData(schedules) {
  return schedules.map((schedule) => [
    schedule.enabled ? 1 : 0,
    schedule.hour,
    schedule.minute,
    schedule.portion,
    schedule.daysMask
  ].join(",")).join(";");
}

function makeScheduleButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = label;
  button.disabled = Boolean(state.pendingScheduleId) || !state.brokerConnected || !state.deviceOnline;
  button.addEventListener("click", onClick);
  return button;
}

function renderSchedules(values = currentSchedules()) {
  const schedules = values.map(normalizeSchedule);
  els.scheduleList.replaceChildren();
  if (!schedules.length) {
    const empty = document.createElement("div");
    empty.className = "schedule-empty";
    empty.textContent = state.deviceOnline ? "还没有定时计划，点击右上角添加" : "连接设备后读取计划";
    els.scheduleList.appendChild(empty);
    return;
  }

  schedules.forEach((schedule, index) => {
    const card = document.createElement("article");
    card.className = `schedule-card${schedule.enabled ? "" : " is-disabled"}`;

    const time = document.createElement("div");
    time.className = "schedule-time";
    time.textContent = scheduleTimeLabel(schedule);

    const summary = document.createElement("div");
    summary.className = "schedule-summary";
    const title = document.createElement("strong");
    title.textContent = `每次执行一次 · ${schedule.enabled ? "已启用" : "已停用"}`;
    const days = document.createElement("span");
    days.textContent = `${scheduleDaysLabel(schedule.daysMask)} · ${nextScheduleLabel(schedule)}`;
    summary.append(title, days);

    const actions = document.createElement("div");
    actions.className = "schedule-actions";
    actions.append(
      makeScheduleButton(schedule.enabled ? "停用" : "启用", "button-secondary", () => {
        const next = schedules.map((item) => ({ ...item }));
        next[index].enabled = !next[index].enabled;
        sendScheduleUpdate(next);
      }),
      makeScheduleButton("编辑", "button-secondary", () => openScheduleDialog(index)),
      makeScheduleButton("删除", "button-danger", () => {
        if (!window.confirm(`删除 ${scheduleTimeLabel(schedule)} 的投喂计划？`)) return;
        sendScheduleUpdate(schedules.filter((_, itemIndex) => itemIndex !== index));
      })
    );
    card.append(time, summary, actions);
    els.scheduleList.appendChild(card);
  });
}

function selectedDaysMask() {
  return [...document.querySelectorAll("#schedule-form [data-day]")].reduce((mask, input) => (
    input.checked ? mask | (1 << Number(input.dataset.day)) : mask
  ), 0);
}

function openScheduleDialog(index = -1) {
  const schedules = currentSchedules();
  if (index < 0 && schedules.length >= MAX_SCHEDULES) {
    showToast(`最多只能设置 ${MAX_SCHEDULES} 条计划`, "error");
    return;
  }
  const schedule = index >= 0 ? schedules[index] : normalizeSchedule({ hour: 8, minute: 0, portion: 1, daysMask: 127, enabled: true });
  state.editingScheduleIndex = index;
  els.scheduleDialogTitle.textContent = index >= 0 ? "编辑投喂计划" : "添加投喂计划";
  els.scheduleTime.value = scheduleTimeLabel(schedule);
  els.scheduleEnabled.checked = schedule.enabled;
  document.querySelectorAll("#schedule-form [data-day]").forEach((input) => {
    input.checked = (schedule.daysMask & (1 << Number(input.dataset.day))) !== 0;
  });
  els.scheduleError.textContent = "";
  if (!els.scheduleDialog.open) els.scheduleDialog.showModal();
}

function closeScheduleDialog() {
  if (els.scheduleDialog.open) els.scheduleDialog.close();
}

function upsertHistory(entry) {
  const index = state.history.findIndex((item) => item.id === entry.id);
  if (index >= 0) state.history[index] = { ...state.history[index], ...entry };
  else state.history.unshift(entry);
  state.history = state.history.slice(0, MAX_HISTORY);
  saveHistory();
  renderHistory();
}

function confirmDeviceConfigSaved(message = "投喂参数已保存") {
  state.pendingConfigId = "";
  state.pendingConfigExpiresAt = 0;
  state.pendingConfigStateChecks = 0;
  state.deviceConfigDirty = false;
  els.deviceConfigError.textContent = "";
  els.configStatus.textContent = "已保存到投喂器";
  showToast(message);
  updateControls();
}

function confirmManualFeedCompleted(commandId, message = "投喂完成。") {
  if (!commandId || commandId !== state.pendingId) return;
  state.pendingId = "";
  state.pendingExpiresAt = 0;
  upsertHistory({ id: commandId, time: Date.now(), portion: 1, status: "completed", reason: "motor_sequence_completed" });
  setActionMessage(message, "success");
  showToast("投喂完成");
  navigator.vibrate?.(80);
  updateControls();
}

function handleDeviceRestartDuringCommand(resetReason = "") {
  const detail = resetReason ? `（复位原因：${resetReason}）` : "";
  const message = `设备在舵机动作期间重启${detail}。网络在线不代表舵机供电正常，请检查独立5V电源、共地和电容。`;
  const servoTestInterrupted = Boolean(state.pendingServoTestId);
  const feedInterrupted = Boolean(state.pendingId);

  if (servoTestInterrupted) {
    state.pendingServoTestId = "";
    state.pendingServoTestExpiresAt = 0;
    els.servoTestStatus.textContent = "舵机动作导致设备重启";
    els.deviceConfigError.textContent = message;
  }
  if (feedInterrupted) {
    const interruptedId = state.pendingId;
    state.pendingId = "";
    state.pendingExpiresAt = 0;
    upsertHistory({ id: interruptedId, status: "failed", reason: "设备在舵机动作期间重启" });
    setActionMessage(message, "error");
  }
  if (servoTestInterrupted || feedInterrupted) showToast(message, "error");
  updateControls();
}

function handleAcknowledgement(payload) {
  if (!payload.id) return;
  const status = payload.status || "failed";

  if (payload.id === state.pendingServoTestId) {
    if (status === "processing") {
      els.servoTestStatus.textContent = "设备正在执行测试…";
      setActionMessage("设备已接收舵机测试，请观察舵机动作。", "success");
    } else {
      state.pendingServoTestId = "";
      state.pendingServoTestExpiresAt = 0;
      const message = reasonLabels[payload.reason] || payload.reason || (status === "completed" ? "舵机测试动作完成" : "舵机测试失败");
      els.servoTestStatus.textContent = status === "completed" ? "测试完成" : `测试${status === "duplicate" ? "已去重" : "失败"}`;
      if (status === "completed" || status === "duplicate") {
        setActionMessage(message, "success");
        showToast(message);
      } else {
        els.deviceConfigError.textContent = message;
        setActionMessage(message, "error");
        showToast(message, "error");
      }
      updateControls();
    }
    return;
  }

  if (payload.action === "set_config" || payload.id === state.pendingConfigId) {
    if (payload.id !== state.pendingConfigId) return;
    if (status === "completed" || status === "duplicate") {
      confirmDeviceConfigSaved();
      requestState();
    } else if (status !== "processing") {
      state.pendingConfigId = "";
      state.pendingConfigExpiresAt = 0;
      state.pendingConfigStateChecks = 0;
      const message = reasonLabels[payload.reason] || payload.reason || "参数保存失败";
      els.deviceConfigError.textContent = message;
      els.configStatus.textContent = "保存失败";
      showToast(message, "error");
    }
    updateControls();
    return;
  }

  if (payload.action === "set_schedule" || payload.id === state.pendingScheduleId) {
    if (payload.id !== state.pendingScheduleId) return;
    if (status === "completed" || status === "duplicate") {
      if (state.pendingSchedules) {
        state.telemetry = { ...(state.telemetry || {}), schedules: state.pendingSchedules };
        renderSchedules(state.pendingSchedules);
      }
      state.pendingScheduleId = "";
      state.pendingScheduleExpiresAt = 0;
      state.pendingSchedules = null;
      closeScheduleDialog();
      showToast("定时计划已保存到投喂器");
      requestState();
    } else if (status !== "processing") {
      state.pendingScheduleId = "";
      state.pendingScheduleExpiresAt = 0;
      state.pendingSchedules = null;
      const message = reasonLabels[payload.reason] || payload.reason || "计划保存失败";
      els.scheduleError.textContent = message;
      showToast(message, "error");
      renderSchedules();
    }
    updateControls();
    return;
  }

  const existing = state.history.find((item) => item.id === payload.id);
  if (status === "duplicate" && existing?.status === "completed") return;
  upsertHistory({
    id: payload.id,
    time: payload.ts ? payload.ts * 1000 : Date.now(),
    portion: Number(payload.portion || 0),
    status,
    reason: payload.reason || ""
  });

  if (payload.id === state.pendingId) {
    if (status === "processing") {
      setActionMessage("设备已接收，舵机正在动作。", "success");
    } else if (status === "completed") {
      confirmManualFeedCompleted(payload.id);
    } else {
      state.pendingId = "";
      state.pendingExpiresAt = 0;
      if (status === "duplicate") setActionMessage("设备已处理过该命令，没有再次投喂。", "error");
      else setActionMessage(reasonLabels[payload.reason] || payload.reason || "设备拒绝执行。", "error");
    }
  }
  updateControls();
}

function renderHistory() {
  els.historyBody.replaceChildren();
  if (!state.history.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "empty";
    cell.textContent = "暂无操作记录";
    row.appendChild(cell);
    els.historyBody.appendChild(row);
    return;
  }

  state.history.forEach((entry) => {
    const row = document.createElement("tr");
    const values = [
      formatTime(entry.time, true),
      statusLabels[entry.status] || entry.status,
      reasonLabels[entry.reason] || entry.reason || "--"
    ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 1) cell.className = `state-${entry.status}`;
      row.appendChild(cell);
    });
    els.historyBody.appendChild(row);
  });
}

function requestState() {
  if (!state.client || !state.brokerConnected || !state.config) return;
  const payload = JSON.stringify({ action: "status", requested_at: Math.floor(Date.now() / 1000) });
  state.client.publish(topic("feeder_query"), payload, { qos: 0, retain: false });
}

function cooldownRemaining() {
  const lastFeedAt = Number(state.telemetry?.last_feed_at || 0);
  const minInterval = Number(state.telemetry?.min_interval_seconds || 60);
  return Math.max(0, lastFeedAt + minInterval - Math.floor(Date.now() / 1000));
}

function estimatedServoActionMs(portion = 1) {
  const telemetry = state.telemetry || {};
  const pauseMs = clampInteger(telemetry.action_pause_ms, 0, 10000, 1000);
  let cycleMs;
  if (Number(telemetry.servo_mode) === 0) {
    const moveMs = clampInteger(telemetry.positional_move_ms, 100, 10000, 1000);
    const returnMs = clampInteger(telemetry.positional_return_ms, 100, 10000, 1000);
    cycleMs = moveMs + pauseMs + returnMs + 450;
  } else {
    const degrees = clampInteger(telemetry.continuous_turn_degrees, 1, 360, 90);
    const msPerRev = clampInteger(telemetry.continuous_ms_per_rev, 250, 10000, 4000);
    const runMs = Math.max(50, Math.round(degrees * msPerRev / 360));
    const shouldReturn = telemetry.continuous_return === true || telemetry.continuous_return === 1;
    cycleMs = runMs + pauseMs + (shouldReturn ? runMs : 0) + 450;
  }
  return Math.max(1, portion) * cycleMs;
}

function updateControls() {
  const cooldown = cooldownRemaining();
  const pending = Boolean(state.pendingId);
  const scheduleBusy = Boolean(state.pendingScheduleId);
  const dailyFeeds = Number(state.telemetry?.feeds_24h || 0);
  const maxFeeds = Number(state.telemetry?.max_feeds_24h || 0);
  const dailyBlocked = maxFeeds > 0 && dailyFeeds >= maxFeeds;
  const ready = state.brokerConnected && state.deviceOnline && !pending && cooldown === 0 && !dailyBlocked;
  els.feedButton.disabled = !ready;
  els.refreshState.disabled = !state.brokerConnected;
  els.openDeviceWifi.disabled = !state.brokerConnected || !state.deviceOnline || !state.telemetry?.config_url;
  els.addSchedule.disabled = !state.brokerConnected || !state.deviceOnline || scheduleBusy || currentSchedules().length >= MAX_SCHEDULES;
  els.saveSchedule.disabled = scheduleBusy || !state.brokerConnected || !state.deviceOnline;
  els.saveDeviceConfig.disabled = !state.brokerConnected || !state.deviceOnline || !state.deviceConfigSupported || Boolean(state.pendingConfigId);
  els.resetDeviceConfig.disabled = !state.brokerConnected || !state.deviceOnline || !state.deviceConfigSupported || Boolean(state.pendingConfigId);
  els.testServo.disabled = !state.brokerConnected || !state.deviceOnline || !state.deviceConfigSupported || state.deviceConfigDirty || Boolean(state.pendingConfigId) || Boolean(state.pendingServoTestId);
  document.querySelectorAll(".schedule-actions .button").forEach((button) => {
    button.disabled = !state.brokerConnected || !state.deviceOnline || scheduleBusy;
  });

  if (pending) {
    els.feedButtonTitle.textContent = "等待设备确认";
    els.feedButtonNote.textContent = "请勿重复提交";
    els.cooldownLabel.textContent = "命令处理中";
  } else if (!state.brokerConnected) {
    els.feedButtonTitle.textContent = "立即投喂";
    els.feedButtonNote.textContent = "MixIO 尚未连接";
    els.cooldownLabel.textContent = "等待云端连接";
  } else if (!state.deviceOnline) {
    els.feedButtonTitle.textContent = "立即投喂";
    els.feedButtonNote.textContent = "投喂器当前离线";
    els.cooldownLabel.textContent = "等待设备连接";
  } else if (cooldown > 0) {
    els.feedButtonTitle.textContent = "冷却中";
    els.feedButtonNote.textContent = `${cooldown} 秒后可再次投喂`;
    els.cooldownLabel.textContent = `安全间隔 ${cooldown} 秒`;
  } else if (dailyBlocked) {
    els.feedButtonTitle.textContent = "达到每日上限";
    els.feedButtonNote.textContent = "请等待24小时窗口滚动后再投喂";
    els.cooldownLabel.textContent = `今日 ${dailyFeeds}/${maxFeeds || "--"} 次`;
  } else {
    els.feedButtonTitle.textContent = "立即投喂";
    els.feedButtonNote.textContent = "点击后需要再次确认";
    els.cooldownLabel.textContent = "设备可以执行";
  }
}

function readDeviceConfigForm() {
  const mode = clampInteger(els.servoMode.value, 0, 1, 1);
  const closed = clampInteger(els.closedAngleNumber.value, 0, 180, 90);
  const positionalTravel = clampInteger(els.openAngleNumber.value, 1, 180, 90);
  const positionalDirection = clampInteger(els.positionalDirection.value, 0, 1, 0);
  const positionalTarget = closed + (positionalDirection === 0 ? positionalTravel : -positionalTravel);
  const open = mode === 0 ? positionalTarget : Math.max(0, Math.min(180, positionalTarget));
  const turnDegrees = clampInteger(els.turnDegreesNumber.value, 1, 360, 90);
  const msPerRev = clampInteger(els.msPerRev.value, 250, 10000, 4000);
  const forwardUs = clampInteger(els.forwardUs.value, 1000, 2000, 1700);
  const reverseUs = clampInteger(els.reverseUs.value, 1000, 2000, 1300);
  const stopUs = clampInteger(els.stopUs.value, 1400, 1600, 1500);
  const direction = clampInteger(els.continuousDirection.value, 0, 1, 0);
  const continuousReturn = clampInteger(els.continuousReturn.value, 0, 1, 0);
  const positionalMoveMs = clampInteger(els.positionalMoveMs.value, 100, 10000, 1000);
  const actionPauseMs = clampInteger(els.actionPauseMs.value, 0, 10000, 1000);
  const positionalReturnMs = clampInteger(els.positionalReturnMs.value, 100, 10000, 1000);
  const minInterval = clampInteger(els.minInterval.value, 10, 86400, 60);
  const maxFeeds = clampInteger(els.maxFeeds.value, 1, 100, 8);
  const maxPortions = maxFeeds;
  if (mode === 0 && (positionalTarget < 0 || positionalTarget > 180)) throw new Error(`180°模式的目标位置是${positionalTarget}°，已超出0～180°。请调整起始位置、方向或转动角度。`);
  if (mode === 1 && Math.abs(forwardUs - stopUs) < 20) throw new Error("正转脉宽与停止脉宽过于接近，连续舵机可能不会转动。");
  return { mode, closed, open, turnDegrees, msPerRev, forwardUs, reverseUs, stopUs, direction, continuousReturn, positionalMoveMs, actionPauseMs, positionalReturnMs, minInterval, maxFeeds, maxPortions };
}

async function sendDeviceConfig(values) {
  if (!state.deviceConfigSupported) {
    const message = `当前ESP8266固件${state.deviceFirmware || "未知"}不支持动作序列，请先烧录${MOTION_SEQUENCE_FIRMWARE}。`;
    els.deviceConfigError.textContent = message;
    showToast(message, "error");
    return;
  }
  if (!state.client || !state.config || !state.brokerConnected || !state.deviceOnline || state.pendingConfigId) return;
  const now = Math.floor(Date.now() / 1000);
  const command = {
    v: 1,
    id: randomId(),
    action: "set_config",
    config_data: [
      values.mode,
      values.closed,
      values.open,
      values.turnDegrees,
      values.msPerRev,
      values.forwardUs,
      values.reverseUs,
      values.stopUs,
      values.direction,
      values.continuousReturn,
      values.positionalMoveMs,
      values.actionPauseMs,
      values.positionalReturnMs,
      values.minInterval,
      values.maxPortions,
      values.maxFeeds
    ].join(","),
    issued_at: now,
    expires_at: now + COMMAND_VALID_SECONDS
  };
  try {
    command.sig = await signCommand(command, state.config.commandSecret);
    state.pendingConfigId = command.id;
    state.pendingConfigExpiresAt = Date.now() + 15000;
    state.pendingConfigStateChecks = 0;
    els.deviceConfigError.textContent = "";
    els.configStatus.textContent = "正在保存…";
    updateControls();
    state.client.publish(topic("feeder_cmd"), JSON.stringify(command), { qos: 1, retain: false }, (error) => {
      if (!error) return;
      state.pendingConfigId = "";
      state.pendingConfigExpiresAt = 0;
      state.pendingConfigStateChecks = 0;
      els.deviceConfigError.textContent = `发送失败：${error.message}`;
      els.configStatus.textContent = "发送失败";
      updateControls();
    });
  } catch (error) {
    state.pendingConfigId = "";
    state.pendingConfigExpiresAt = 0;
    state.pendingConfigStateChecks = 0;
    els.deviceConfigError.textContent = error.message;
    updateControls();
  }
}

async function sendServoTestCommand() {
  if (!state.deviceConfigSupported) {
    const message = `当前ESP8266固件${state.deviceFirmware || "未知"}不支持新版舵机测试，请先烧录${MOTION_SEQUENCE_FIRMWARE}。`;
    els.deviceConfigError.textContent = message;
    showToast(message, "error");
    return;
  }
  if (state.deviceConfigDirty) {
    const message = "当前动作参数还没有保存到ESP8266，请先保存并等待设备确认后再测试。";
    els.deviceConfigError.textContent = message;
    els.servoTestStatus.textContent = "请先保存当前参数";
    showToast(message, "error");
    return;
  }
  if (!state.client || !state.config || !state.brokerConnected || !state.deviceOnline ||
      !state.deviceConfigSupported || state.pendingServoTestId || state.pendingConfigId) return;
  if (!window.confirm("确认空载测试当前舵机？测试不会计入投喂次数，但舵机会执行一次动作。")) return;

  const now = Math.floor(Date.now() / 1000);
  const command = {
    v: 1,
    id: randomId(),
    action: "servo_test",
    portion: 1,
    issued_at: now,
    expires_at: now + COMMAND_VALID_SECONDS
  };

  try {
    command.sig = await signCommand(command, state.config.commandSecret);
    state.pendingServoTestId = command.id;
    state.pendingServoTestExpiresAt = Math.max(
      (command.expires_at + 5) * 1000,
      Date.now() + estimatedServoActionMs(1) + 15000
    );
    els.servoTestStatus.textContent = "正在发送测试命令…";
    els.deviceConfigError.textContent = "";
    updateControls();
    state.client.publish(topic("feeder_cmd"), JSON.stringify(command), { qos: 1, retain: false }, (error) => {
      if (!error) return;
      state.pendingServoTestId = "";
      state.pendingServoTestExpiresAt = 0;
      els.servoTestStatus.textContent = "测试发送失败";
      els.deviceConfigError.textContent = `发送失败：${error.message}`;
      showToast(`舵机测试发送失败：${error.message}`, "error");
      updateControls();
    });
  } catch (error) {
    state.pendingServoTestId = "";
    state.pendingServoTestExpiresAt = 0;
    els.servoTestStatus.textContent = "测试发送失败";
    els.deviceConfigError.textContent = error.message;
    updateControls();
  }
}

async function sendFeedCommand() {
  if (!state.client || !state.config || els.feedButton.disabled) return;
  if (!window.confirm("确认立即投喂一次？")) return;

  const now = Math.floor(Date.now() / 1000);
  const command = {
    v: 1,
    id: randomId(),
    action: "feed",
    portion: 1,
    issued_at: now,
    expires_at: now + COMMAND_VALID_SECONDS
  };

  try {
    command.sig = await signCommand(command, state.config.commandSecret);
    state.pendingId = command.id;
    state.pendingExpiresAt = Math.max(
      (command.expires_at + 5) * 1000,
      Date.now() + estimatedServoActionMs(1) + 15000
    );
    upsertHistory({ id: command.id, time: Date.now(), portion: 1, status: "sent", reason: "" });
    updateControls();
    setActionMessage("命令已发送，等待设备确认。", "success");
    state.client.publish(topic("feeder_cmd"), JSON.stringify(command), { qos: 1, retain: false }, (error) => {
      if (!error) return;
      state.pendingId = "";
      state.pendingExpiresAt = 0;
      upsertHistory({ id: command.id, status: "failed", reason: error.message });
      setActionMessage(`发送失败：${error.message}`, "error");
      updateControls();
    });
  } catch (error) {
    state.pendingId = "";
    state.pendingExpiresAt = 0;
    setActionMessage(error.message, "error");
    updateControls();
  }
}

async function sendScheduleUpdate(values) {
  if (!state.client || !state.config || !state.brokerConnected || !state.deviceOnline || state.pendingScheduleId) return;
  const schedules = values.map(normalizeSchedule).slice(0, MAX_SCHEDULES);
  const now = Math.floor(Date.now() / 1000);
  const command = {
    v: 1,
    id: randomId(),
    action: "set_schedule",
    schedule_data: scheduleData(schedules),
    issued_at: now,
    expires_at: now + COMMAND_VALID_SECONDS
  };

  try {
    command.sig = await signCommand(command, state.config.commandSecret);
    state.pendingScheduleId = command.id;
    state.pendingScheduleExpiresAt = (command.expires_at + 5) * 1000;
    state.pendingSchedules = schedules;
    renderSchedules(schedules);
    updateControls();
    showToast("正在保存计划…");
    state.client.publish(topic("feeder_cmd"), JSON.stringify(command), { qos: 1, retain: false }, (error) => {
      if (!error) return;
      state.pendingScheduleId = "";
      state.pendingScheduleExpiresAt = 0;
      state.pendingSchedules = null;
      els.scheduleError.textContent = `发送失败：${error.message}`;
      showToast(`计划发送失败：${error.message}`, "error");
      renderSchedules();
      updateControls();
    });
  } catch (error) {
    state.pendingScheduleId = "";
    state.pendingScheduleExpiresAt = 0;
    state.pendingSchedules = null;
    els.scheduleError.textContent = error.message;
    showToast(error.message, "error");
    renderSchedules();
    updateControls();
  }
}

function bindEvents() {
  bindAngleInputs("closed");
  bindAngleInputs("open");
  bindTurnDegrees();
  updateServoModeVisibility();
  els.servoMode.addEventListener("change", () => {
    markDeviceConfigDirty();
    updateServoModeVisibility();
  });
  [
    els.positionalDirection,
    els.positionalMoveMs,
    els.positionalReturnMs,
    els.msPerRev,
    els.forwardUs,
    els.reverseUs,
    els.stopUs,
    els.continuousDirection,
    els.continuousReturn,
    els.actionPauseMs,
    els.minInterval,
    els.maxFeeds,
  ].forEach((element) => {
    const eventName = element.tagName === "SELECT" ? "change" : "input";
    element.addEventListener(eventName, () => {
      markDeviceConfigDirty();
      updateServoModeVisibility();
    });
  });
  els.deviceConfigForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      sendDeviceConfig(readDeviceConfigForm());
    } catch (error) {
      els.deviceConfigError.textContent = error.message;
    }
  });
  els.testServo.addEventListener("click", sendServoTestCommand);
  els.resetDeviceConfig.addEventListener("click", () => {
    markDeviceConfigDirty();
    els.servoMode.value = "1";
    syncAngleInput("closed", 90);
    syncAngleInput("open", 90);
    els.positionalDirection.value = "0";
    els.positionalMoveMs.value = "1000";
    els.positionalReturnMs.value = "1000";
    els.actionPauseMs.value = "1000";
    syncTurnDegrees(90);
    els.msPerRev.value = "4000";
    els.forwardUs.value = "1700";
    els.reverseUs.value = "1300";
    els.stopUs.value = "1500";
    els.continuousDirection.value = "0";
    els.continuousReturn.value = "1";
    els.minInterval.value = "60";
    els.maxFeeds.value = "8";
    updateServoModeVisibility();
    els.deviceConfigError.textContent = "已填入默认值，点击“保存到投喂器”后才会生效。";
  });


  $("open-settings").addEventListener("click", openSettings);
  $("close-settings").addEventListener("click", closeSettings);
  els.feedButton.addEventListener("click", sendFeedCommand);
  els.refreshState.addEventListener("click", requestState);
  els.openDeviceWifi.addEventListener("click", () => {
    const url = state.telemetry?.config_url;
    if (!url) return;
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) showToast(`浏览器阻止了新窗口，请手动打开 ${url}`, "error");
  });
  els.addSchedule.addEventListener("click", () => openScheduleDialog());
  $("close-schedule").addEventListener("click", closeScheduleDialog);
  $("cancel-schedule").addEventListener("click", closeScheduleDialog);
  els.scheduleForm.addEventListener("submit", (event) => {
    event.preventDefault();
    els.scheduleError.textContent = "";
    const [hourText, minuteText] = els.scheduleTime.value.split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const daysMask = selectedDaysMask();
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      els.scheduleError.textContent = "请选择执行时间。";
      return;
    }
    if (!daysMask) {
      els.scheduleError.textContent = "至少选择一个重复日期。";
      return;
    }

    const nextSchedule = normalizeSchedule({
      enabled: els.scheduleEnabled.checked,
      hour,
      minute,
      portion: 1,
      daysMask
    });
    const schedules = currentSchedules();
    const conflict = schedules.some((schedule, index) => (
      index !== state.editingScheduleIndex &&
      schedule.enabled && nextSchedule.enabled &&
      schedule.hour === nextSchedule.hour &&
      schedule.minute === nextSchedule.minute &&
      (schedule.daysMask & nextSchedule.daysMask) !== 0
    ));
    if (conflict) {
      els.scheduleError.textContent = "已有计划在相同日期和时间执行，请错开至少一分钟。";
      return;
    }

    if (state.editingScheduleIndex >= 0) schedules[state.editingScheduleIndex] = nextSchedule;
    else schedules.push(nextSchedule);
    sendScheduleUpdate(schedules);
  });
  document.querySelectorAll("[data-days-mask]").forEach((button) => {
    button.addEventListener("click", () => {
      const mask = Number(button.dataset.daysMask);
      document.querySelectorAll("#schedule-form [data-day]").forEach((input) => {
        input.checked = (mask & (1 << Number(input.dataset.day))) !== 0;
      });
    });
  });
  $("clear-history").addEventListener("click", () => {
    if (!state.history.length || !window.confirm("清空当前手机保存的投喂记录？")) return;
    state.history = [];
    saveHistory();
    renderHistory();
  });

  $("generate-secret").addEventListener("click", () => {
    els.commandSecret.value = randomSecret();
    els.commandSecret.type = "text";
  });
  $("copy-secret").addEventListener("click", async () => {
    if (!els.commandSecret.value) return;
    try {
      await navigator.clipboard.writeText(els.commandSecret.value);
      els.settingsError.textContent = "签名密钥已复制，请粘贴到固件 config.h。";
    } catch {
      els.commandSecret.type = "text";
      els.commandSecret.select();
      els.settingsError.textContent = "请手动复制选中的签名密钥。";
    }
  });

  $("copy-share-link").addEventListener("click", async () => {
    const config = {
      username: els.username.value.trim(),
      project: els.project.value.trim(),
      password: els.password.value,
      commandSecret: els.commandSecret.value.trim()
    };
    if (!validateConfig(config)) return;

    const url = `${location.origin}${location.pathname}#config=${encodeSharedConfig(config)}`;
    try {
      await navigator.clipboard.writeText(url);
      els.settingsError.textContent = "授权链接已复制。它等同于钥匙，只能私下发送给可信的人。";
    } catch {
      els.settingsError.textContent = "浏览器无法复制，请先保存配置，再换用支持剪贴板的 HTTPS 页面。";
    }
  });

  $("clear-config").addEventListener("click", () => {
    safeStorageRemove(localStorage, CONFIG_KEY);
    safeStorageRemove(sessionStorage, CONFIG_KEY);
    state.config = null;
    disconnectClient();
    state.telemetry = null;
    renderSchedules([]);
    fillSettings(null);
    els.settingsError.textContent = "连接配置已清除。";
    setActionMessage("请重新填写连接设置。");
  });

  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    els.settingsError.textContent = "";
    const config = {
      username: els.username.value.trim(),
      project: els.project.value.trim(),
      password: els.password.value,
      commandSecret: els.commandSecret.value.trim()
    };
    if (!validateConfig(config)) return;

    safeStorageRemove(localStorage, CONFIG_KEY);
    safeStorageRemove(sessionStorage, CONFIG_KEY);
    const target = els.remember.checked ? localStorage : sessionStorage;
    if (!safeStorageSet(target, CONFIG_KEY, JSON.stringify(config))) {
      els.settingsError.textContent = "浏览器拒绝保存配置，请检查隐私设置。";
      return;
    }
    state.config = config;
    closeSettings();
    connectMixIO();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.brokerConnected) requestState();
  });
}

function tick() {
  if (state.deviceOnline && state.lastDeviceAt && Date.now() - state.lastDeviceAt > DEVICE_STALE_MS) {
    setDeviceStatus(false, "状态超时");
  }
  if (state.pendingId && Date.now() > state.pendingExpiresAt) {
    const expiredId = state.pendingId;
    state.pendingId = "";
    state.pendingExpiresAt = 0;
    upsertHistory({ id: expiredId, status: "timeout", reason: "设备未返回确认" });
    setActionMessage("设备未在有效时间内确认，请先检查鱼缸再决定是否重试。", "error");
  }
  if (state.pendingScheduleId && Date.now() > state.pendingScheduleExpiresAt) {
    state.pendingScheduleId = "";
    state.pendingScheduleExpiresAt = 0;
    state.pendingSchedules = null;
    renderSchedules();
    showToast("设备没有确认计划，请检查连接后重试", "error");
  }
  if (state.pendingConfigId && Date.now() > state.pendingConfigExpiresAt) {
    if (state.pendingConfigStateChecks === 0) {
      els.configStatus.textContent = "正在核对设备状态…";
      els.deviceConfigError.textContent = "没有收到保存确认，正在向设备查询已写入的参数。";
      state.pendingConfigStateChecks = 1;
      state.pendingConfigExpiresAt = Date.now() + 10000;
      requestState();
    } else {
      state.pendingConfigId = "";
      state.pendingConfigExpiresAt = 0;
      state.pendingConfigStateChecks = 0;
      els.configStatus.textContent = "设备未确认保存";
      els.deviceConfigError.textContent = "设备既没有返回保存确认，状态中也没有这次配置编号。参数可能未保存，请检查固件版本和供电后再试。";
    }
  }
  if (state.pendingServoTestId && Date.now() > state.pendingServoTestExpiresAt) {
    state.pendingServoTestId = "";
    state.pendingServoTestExpiresAt = 0;
    els.servoTestStatus.textContent = "未收到测试完成确认";
    els.deviceConfigError.textContent = "舵机可能已经动作，但网页没有收到完成确认。请勿立即重复测试，先请求一次设备状态并观察舵机位置。";
  }
  updateControls();
}

function init() {
  bindEvents();
  renderHistory();
  renderSchedules([]);
  const imported = importSharedConfig();
  state.config = loadConfig();
  if (state.config) {
    fillSettings(state.config);
    connectMixIO();
    if (imported) setActionMessage("手机授权已导入，正在连接投喂器。", "success");
  } else {
    setBrokerStatus("idle", "未配置");
    setDeviceStatus(false, "未知");
    openSettings();
  }
  updateControls();
  setInterval(tick, 1000);
}

init();
