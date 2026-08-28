
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <PubSubClient.h>
#include <Servo.h>
#include <stddef.h>
#include <time.h>

extern "C" {
#include <bearssl/bearssl.h>
}

#include "config.h"

#if !CONFIGURED
#error "Edit config.h, replace every placeholder, then set CONFIGURED to 1."
#endif

static_assert(sizeof(COMMAND_SECRET) - 1 >= 24, "COMMAND_SECRET must contain at least 24 characters.");
static_assert(
  MIN_FEED_INTERVAL_SECONDS >= COMMAND_MAX_AGE_SECONDS,
  "MIN_FEED_INTERVAL_SECONDS must be at least COMMAND_MAX_AGE_SECONDS."
);

static const char *FIRMWARE_VERSION = "1.3.0";
static const uint32_t SAFETY_MAGIC = 0x46454547UL;
static const uint32_t WIFI_CONFIG_MAGIC = 0x57494649UL;
static const uint32_t DOUBLE_RESET_MAGIC = 0x44525354UL;
static const uint16_t EEPROM_BYTES = 512;
static const uint16_t WIFI_CONFIG_OFFSET = 256;
static const uint32_t DOUBLE_RESET_WINDOW_MS = 8000UL;

struct ScheduleEntry {
  uint8_t enabled;
  uint8_t hour;
  uint8_t minute;
  uint8_t portion;
  uint8_t daysMask;
  uint32_t lastRunLocalDay;
};

struct PersistedSafetyState {
  uint32_t magic;
  char lastCommandId[37];
  char lastScheduleCommandId[37];
  char lastConfigCommandId[37];
  uint32_t lastFeedAt;
  uint32_t windowStartAt;
  uint16_t portionsInWindow;
  uint16_t feedsInWindow;
  uint8_t scheduleCount;
  uint32_t lastScheduleIssuedAt;
  uint32_t lastConfigIssuedAt;
  uint8_t servoMode;
  uint16_t servoClosedAngle;
  uint16_t servoOpenAngle;
  uint16_t continuousTurnDegrees;
  uint32_t continuousMsPerRev;
  uint16_t continuousForwardUs;
  uint16_t continuousReverseUs;
  uint16_t continuousStopUs;
  uint8_t continuousDirection;
  uint8_t continuousReturn;
  uint32_t minFeedIntervalSeconds;
  uint16_t maxPortionsPer24h;
  uint16_t maxFeedsPer24h;
  ScheduleEntry schedules[MAX_SCHEDULES];
  uint16_t checksum;
};

struct PersistedWifiConfig {
  uint32_t magic;
  char ssid[33];
  char password[65];
  uint16_t checksum;
};

static_assert(sizeof(PersistedSafetyState) <= EEPROM_BYTES, "Persisted state exceeds EEPROM allocation.");
static_assert(sizeof(PersistedSafetyState) <= WIFI_CONFIG_OFFSET, "Persisted state overlaps Wi-Fi configuration.");
static_assert(WIFI_CONFIG_OFFSET + sizeof(PersistedWifiConfig) <= EEPROM_BYTES, "Wi-Fi config exceeds EEPROM allocation.");

WiFiClient networkClient;
PubSubClient mqttClient(networkClient);
Servo feederServo;
PersistedSafetyState safetyState;
PersistedWifiConfig wifiConfig;
ESP8266WebServer configServer(80);
DNSServer dnsServer;

String commandTopic;
String acknowledgementTopic;
String stateTopic;
String onlineTopic;
String queryTopic;
String lastError;
String lastFeedSource;

uint32_t lastMqttAttemptAt = 0;
uint32_t lastStatePublishAt = 0;
uint32_t lastScheduleMinute = 0xFFFFFFFFUL;
bool clockWasReady = false;
bool configPortalActive = false;
bool configServerStarted = false;
bool mdnsStarted = false;
uint32_t restartAt = 0;
uint32_t doubleResetMarkerSetAt = 0;

struct ResetMarker {
  uint32_t magic;
  uint32_t checksum;
};

uint32_t resetMarkerChecksum(uint32_t magic) {
  return magic ^ 0xA55AA55AUL;
}

bool consumeDoubleResetMarker() {
  ResetMarker marker;
  if (!ESP.rtcUserMemoryRead(0, reinterpret_cast<uint32_t *>(&marker), sizeof(marker))) return false;
  const bool detected = marker.magic == DOUBLE_RESET_MAGIC && marker.checksum == resetMarkerChecksum(marker.magic);
  memset(&marker, 0, sizeof(marker));
  ESP.rtcUserMemoryWrite(0, reinterpret_cast<uint32_t *>(&marker), sizeof(marker));
  return detected;
}

void writeDoubleResetMarker() {
  ResetMarker marker{DOUBLE_RESET_MAGIC, resetMarkerChecksum(DOUBLE_RESET_MAGIC)};
  ESP.rtcUserMemoryWrite(0, reinterpret_cast<uint32_t *>(&marker), sizeof(marker));
}

void clearDoubleResetMarker() {
  ResetMarker marker{0, 0};
  ESP.rtcUserMemoryWrite(0, reinterpret_cast<uint32_t *>(&marker), sizeof(marker));
}

bool due(uint32_t now, uint32_t previous, uint32_t interval) {
  return static_cast<uint32_t>(now - previous) >= interval;
}

uint16_t calculateChecksum(const PersistedSafetyState &value) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&value);
  uint16_t checksum = 0xA5A5;
  for (size_t i = 0; i < offsetof(PersistedSafetyState, checksum); ++i) {
    checksum = static_cast<uint16_t>((checksum << 5) | (checksum >> 11));
    checksum ^= bytes[i];
  }
  return checksum;
}

uint16_t calculateWifiChecksum(const PersistedWifiConfig &value) {
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&value);
  uint16_t checksum = 0x5AA5;
  for (size_t i = 0; i < offsetof(PersistedWifiConfig, checksum); ++i) {
    checksum = static_cast<uint16_t>((checksum << 5) | (checksum >> 11));
    checksum ^= bytes[i];
  }
  return checksum;
}

bool hasStoredWifi() {
  return wifiConfig.magic == WIFI_CONFIG_MAGIC &&
    wifiConfig.ssid[0] != '\0' &&
    wifiConfig.checksum == calculateWifiChecksum(wifiConfig);
}

void clearWifiConfig() {
  memset(&wifiConfig, 0, sizeof(wifiConfig));
  EEPROM.put(WIFI_CONFIG_OFFSET, wifiConfig);
  EEPROM.commit();
}

void saveWifiConfig(const String &ssid, const String &password) {
  memset(&wifiConfig, 0, sizeof(wifiConfig));
  wifiConfig.magic = WIFI_CONFIG_MAGIC;
  ssid.substring(0, sizeof(wifiConfig.ssid) - 1).toCharArray(wifiConfig.ssid, sizeof(wifiConfig.ssid));
  password.substring(0, sizeof(wifiConfig.password) - 1).toCharArray(wifiConfig.password, sizeof(wifiConfig.password));
  wifiConfig.checksum = calculateWifiChecksum(wifiConfig);
  EEPROM.put(WIFI_CONFIG_OFFSET, wifiConfig);
  EEPROM.commit();
}

String configuredSsid() {
  if (hasStoredWifi()) return String(wifiConfig.ssid);
  return String(WIFI_SSID);
}

String configuredPassword() {
  if (hasStoredWifi()) return String(wifiConfig.password);
  return String(WIFI_PASSWORD);
}

String htmlEscape(const String &value) {
  String escaped;
  escaped.reserve(value.length() + 16);
  for (size_t i = 0; i < value.length(); ++i) {
    switch (value[i]) {
      case '&': escaped += F("&amp;"); break;
      case '<': escaped += F("&lt;"); break;
      case '>': escaped += F("&gt;"); break;
      case '"': escaped += F("&quot;"); break;
      case '\'': escaped += F("&#39;"); break;
      default: escaped += value[i]; break;
    }
  }
  return escaped;
}

bool hasConfiguredWifi() {
  return configuredSsid().length() > 0;
}

void saveSafetyState() {
  safetyState.magic = SAFETY_MAGIC;
  safetyState.checksum = calculateChecksum(safetyState);
  EEPROM.put(0, safetyState);
  EEPROM.commit();
}

void resetSafetyState(uint32_t now = 0) {
  memset(&safetyState, 0, sizeof(safetyState));
  safetyState.magic = SAFETY_MAGIC;
  safetyState.windowStartAt = now;
  safetyState.servoClosedAngle = SERVO_CLOSED_ANGLE;
  safetyState.servoOpenAngle = SERVO_OPEN_ANGLE;
  safetyState.servoMode = SERVO_MODE_DEFAULT;
  safetyState.continuousTurnDegrees = SERVO_CONTINUOUS_TURN_DEGREES;
  safetyState.continuousMsPerRev = SERVO_CONTINUOUS_MS_PER_REV;
  safetyState.continuousForwardUs = SERVO_CONTINUOUS_FORWARD_US;
  safetyState.continuousReverseUs = SERVO_CONTINUOUS_REVERSE_US;
  safetyState.continuousStopUs = SERVO_CONTINUOUS_STOP_US;
  safetyState.continuousDirection = 0;
  safetyState.continuousReturn = 0;
  safetyState.minFeedIntervalSeconds = MIN_FEED_INTERVAL_SECONDS;
  safetyState.maxPortionsPer24h = MAX_PORTIONS_PER_24H;
  safetyState.maxFeedsPer24h = DEFAULT_MAX_FEEDS_PER_24H;
  saveSafetyState();
}

void loadSafetyState() {
  EEPROM.begin(EEPROM_BYTES);
  EEPROM.get(0, safetyState);
  EEPROM.get(WIFI_CONFIG_OFFSET, wifiConfig);
  if (
    safetyState.magic != SAFETY_MAGIC ||
    safetyState.scheduleCount > MAX_SCHEDULES ||
    safetyState.servoMode > 1 ||
    safetyState.servoClosedAngle > 180 ||
    safetyState.servoOpenAngle > 180 ||
    (safetyState.servoMode == 0 && safetyState.servoClosedAngle == safetyState.servoOpenAngle) ||
    safetyState.continuousTurnDegrees > 360 ||
    safetyState.continuousMsPerRev < 250 ||
    safetyState.continuousMsPerRev > 10000UL ||
    safetyState.continuousForwardUs < 1000 || safetyState.continuousForwardUs > 2000 ||
    safetyState.continuousReverseUs < 1000 || safetyState.continuousReverseUs > 2000 ||
    safetyState.continuousStopUs < 1400 || safetyState.continuousStopUs > 1600 ||
    safetyState.continuousDirection > 1 ||
    safetyState.continuousReturn > 1 ||
    safetyState.minFeedIntervalSeconds < 10 ||
    safetyState.minFeedIntervalSeconds > 86400UL ||
    safetyState.maxPortionsPer24h < 1 ||
    safetyState.maxPortionsPer24h > 300 ||
    safetyState.maxFeedsPer24h < 1 ||
    safetyState.maxFeedsPer24h > 100 ||
    safetyState.checksum != calculateChecksum(safetyState)
  ) {
    resetSafetyState();
  }
}

uint32_t epochNow() {
  const time_t current = time(nullptr);
  return current > 0 ? static_cast<uint32_t>(current) : 0;
}

bool clockReady() {
  return epochNow() > 1700000000UL;
}

void startClockSync() {
  configTime(0, 0, "ntp.aliyun.com", "ntp1.aliyun.com", "pool.ntp.org");
}

String topicFor(const char *name) {
  return String(MIXIO_USERNAME) + "/" + MIXIO_PROJECT + "/" + name;
}

String bytesToHex(const uint8_t *bytes, size_t length) {
  static const char hex[] = "0123456789abcdef";
  String output;
  output.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    output += hex[(bytes[i] >> 4) & 0x0F];
    output += hex[bytes[i] & 0x0F];
  }
  return output;
}

String hmacSha256(const String &secret, const String &message) {
  br_hmac_key_context keyContext;
  br_hmac_context context;
  uint8_t output[32];
  br_hmac_key_init(
    &keyContext,
    &br_sha256_vtable,
    reinterpret_cast<const void *>(secret.c_str()),
    secret.length()
  );
  br_hmac_init(&context, &keyContext, sizeof(output));
  br_hmac_update(&context, reinterpret_cast<const void *>(message.c_str()), message.length());
  br_hmac_out(&context, output);
  return bytesToHex(output, sizeof(output));
}

bool constantTimeEquals(const String &left, const String &right) {
  if (left.length() != right.length()) return false;
  uint8_t difference = 0;
  for (size_t i = 0; i < left.length(); ++i) difference |= left[i] ^ right[i];
  return difference == 0;
}

bool validCommandId(const String &value) {
  if (value.length() != 36) return false;
  for (size_t i = 0; i < value.length(); ++i) {
    const char c = value[i];
    const bool dash = i == 8 || i == 13 || i == 18 || i == 23;
    if (dash && c != '-') return false;
    if (!dash && !isxdigit(static_cast<unsigned char>(c))) return false;
  }
  return true;
}

bool publishJson(const String &topic, JsonDocument &document, bool retained = false) {
  String payload;
  serializeJson(document, payload);
  return mqttClient.publish(topic.c_str(), payload.c_str(), retained);
}

void publishAcknowledgement(
  const String &commandId,
  const char *status,
  int portion,
  const char *reason,
  const char *action = "feed"
) {
  StaticJsonDocument<384> document;
  document["v"] = 1;
  document["id"] = commandId;
  document["device_id"] = DEVICE_ID;
  document["action"] = action;
  document["status"] = status;
  document["portion"] = portion;
  document["reason"] = reason;
  document["ts"] = epochNow();
  publishJson(acknowledgementTopic, document, false);
}

void refreshRollingWindow(uint32_t now) {
  if (
    safetyState.windowStartAt == 0 ||
    now < safetyState.windowStartAt ||
    now - safetyState.windowStartAt >= 86400UL
  ) {
    safetyState.windowStartAt = now;
    safetyState.portionsInWindow = 0;
    safetyState.feedsInWindow = 0;
    saveSafetyState();
  }
}

void publishState() {
  const uint32_t now = epochNow();
  if (now > 0) refreshRollingWindow(now);

  StaticJsonDocument<1536> document;
  document["v"] = 1;
  document["online"] = true;
  document["device_id"] = DEVICE_ID;
  document["firmware"] = FIRMWARE_VERSION;
  document["rssi"] = WiFi.RSSI();
  document["ip"] = WiFi.localIP().toString();
  document["wifi_ssid"] = WiFi.SSID();
  document["config_url"] = String("http://") + WiFi.localIP().toString() + "/";
  document["free_heap"] = ESP.getFreeHeap();
  document["uptime_s"] = millis() / 1000UL;
  document["ts"] = now;
  document["clock_ready"] = clockReady();
  document["last_feed_at"] = safetyState.lastFeedAt;
  document["portions_24h"] = safetyState.portionsInWindow;
  document["feeds_24h"] = safetyState.feedsInWindow;
  document["max_portions_24h"] = safetyState.maxPortionsPer24h;
  document["max_feeds_24h"] = safetyState.maxFeedsPer24h;
  document["min_interval_seconds"] = safetyState.minFeedIntervalSeconds;
  document["servo_closed_angle"] = safetyState.servoClosedAngle;
  document["servo_open_angle"] = safetyState.servoOpenAngle;
  document["servo_travel_degrees"] = abs(static_cast<int>(safetyState.servoOpenAngle) - static_cast<int>(safetyState.servoClosedAngle));
  document["servo_mode"] = safetyState.servoMode;
  document["continuous_turn_degrees"] = safetyState.continuousTurnDegrees;
  document["continuous_ms_per_rev"] = safetyState.continuousMsPerRev;
  document["continuous_forward_us"] = safetyState.continuousForwardUs;
  document["continuous_reverse_us"] = safetyState.continuousReverseUs;
  document["continuous_stop_us"] = safetyState.continuousStopUs;
  document["continuous_direction"] = safetyState.continuousDirection;
  document["continuous_return"] = safetyState.continuousReturn == 1;
  document["last_error"] = lastError;
  document["last_feed_source"] = lastFeedSource;
  document["timezone_offset_minutes"] = TIMEZONE_OFFSET_SECONDS / 60UL;

  JsonArray schedules = document.createNestedArray("schedules");
  for (uint8_t i = 0; i < safetyState.scheduleCount && i < MAX_SCHEDULES; ++i) {
    const ScheduleEntry &schedule = safetyState.schedules[i];
    JsonObject item = schedules.createNestedObject();
    item["enabled"] = schedule.enabled == 1;
    item["hour"] = schedule.hour;
    item["minute"] = schedule.minute;
    item["portion"] = schedule.portion;
    item["days_mask"] = schedule.daysMask;
  }
  publishJson(stateTopic, document, true);
}

void publishOnline(bool online) {
  StaticJsonDocument<192> document;
  document["v"] = 1;
  document["online"] = online;
  document["device_id"] = DEVICE_ID;
  document["ts"] = epochNow();
  publishJson(onlineTopic, document, true);
}

void waitWithMqtt(uint32_t durationMs) {
  const uint32_t startedAt = millis();
  while (!due(millis(), startedAt, durationMs)) {
    delay(10);
    yield();
  }
}

bool runServoCycles(int portion) {
  feederServo.attach(SERVO_PIN, 500, 2400);
  if (!feederServo.attached()) return false;

  if (safetyState.servoMode == 1) {
    if (safetyState.continuousTurnDegrees == 0) {
      feederServo.writeMicroseconds(safetyState.continuousStopUs);
      waitWithMqtt(120);
      feederServo.detach();
      return true;
    }
    const uint32_t calculatedRunMs =
      (static_cast<uint32_t>(safetyState.continuousTurnDegrees) * safetyState.continuousMsPerRev) / 360UL;
    const uint32_t runMs = calculatedRunMs < 50UL ? 50UL : calculatedRunMs;
    const uint16_t driveUs = safetyState.continuousDirection == 1
      ? safetyState.continuousReverseUs
      : safetyState.continuousForwardUs;
    const uint16_t returnUs = safetyState.continuousDirection == 1
      ? safetyState.continuousForwardUs
      : safetyState.continuousReverseUs;
    feederServo.writeMicroseconds(safetyState.continuousStopUs);
    waitWithMqtt(120);
    for (int i = 0; i < portion; ++i) {
      feederServo.writeMicroseconds(driveUs);
      waitWithMqtt(runMs);
      feederServo.writeMicroseconds(safetyState.continuousStopUs);
      waitWithMqtt(120);
      if (safetyState.continuousReturn == 1) {
        feederServo.writeMicroseconds(returnUs);
        waitWithMqtt(runMs);
        feederServo.writeMicroseconds(safetyState.continuousStopUs);
      }
      waitWithMqtt(SERVO_SETTLE_MS);
    }
    feederServo.detach();
    return true;
  }

  feederServo.write(safetyState.servoClosedAngle);
  waitWithMqtt(250);
  for (int i = 0; i < portion; ++i) {
    feederServo.write(safetyState.servoOpenAngle);
    const uint32_t travel = static_cast<uint32_t>(abs(static_cast<int>(safetyState.servoOpenAngle) - static_cast<int>(safetyState.servoClosedAngle)));
    const uint32_t travelWait = travel * 8UL;
    waitWithMqtt(travelWait > SERVO_OPEN_MS ? travelWait : SERVO_OPEN_MS);
    feederServo.write(safetyState.servoClosedAngle);
    waitWithMqtt(SERVO_SETTLE_MS);
  }
  feederServo.detach();
  return true;
}

void rejectCommand(const String &id, int portion, const char *reason) {
  lastError = reason;
  publishAcknowledgement(id.length() ? id : "unknown", "rejected", portion, reason);
  publishState();
}

void rejectScheduleCommand(const String &id, const char *reason) {
  lastError = reason;
  publishAcknowledgement(id.length() ? id : "unknown", "rejected", 0, reason, "set_schedule");
  publishState();
}

void rejectConfigCommand(const String &id, const char *reason) {
  lastError = reason;
  publishAcknowledgement(id.length() ? id : "unknown", "rejected", 0, reason, "set_config");
  publishState();
}

bool validCommandTime(uint32_t issuedAt, uint32_t expiresAt, uint32_t now) {
  if (
    issuedAt == 0 ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > COMMAND_MAX_AGE_SECONDS ||
    issuedAt > now + 10UL ||
    now > expiresAt
  ) {
    return false;
  }
  return now < issuedAt || now - issuedAt <= COMMAND_MAX_AGE_SECONDS;
}

bool parseScheduleItem(const String &value, ScheduleEntry &schedule) {
  int enabled = 0;
  int hour = 0;
  int minute = 0;
  int portion = 0;
  int daysMask = 0;
  char extra = '\0';
  const int matched = sscanf(
    value.c_str(),
    "%d,%d,%d,%d,%d%c",
    &enabled,
    &hour,
    &minute,
    &portion,
    &daysMask,
    &extra
  );
  if (
    matched != 5 ||
    (enabled != 0 && enabled != 1) ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    portion < 1 || portion > MAX_PORTION ||
    daysMask < 1 || daysMask > 127
  ) {
    return false;
  }

  memset(&schedule, 0, sizeof(schedule));
  schedule.enabled = static_cast<uint8_t>(enabled);
  schedule.hour = static_cast<uint8_t>(hour);
  schedule.minute = static_cast<uint8_t>(minute);
  schedule.portion = static_cast<uint8_t>(portion);
  schedule.daysMask = static_cast<uint8_t>(daysMask);
  return true;
}

bool parseScheduleData(const String &value, ScheduleEntry *output, uint8_t &count) {
  count = 0;
  if (value.length() == 0) return true;

  int start = 0;
  while (start < static_cast<int>(value.length())) {
    if (count >= MAX_SCHEDULES) return false;
    int end = value.indexOf(';', start);
    if (end < 0) end = value.length();
    if (end <= start || !parseScheduleItem(value.substring(start, end), output[count])) return false;
    ++count;
    start = end + 1;
  }
  return true;
}

void processScheduleCommand(JsonDocument &document) {
  const int version = document["v"] | 0;
  const String commandId = document["id"] | "";
  const String action = document["action"] | "";
  const String scheduleData = document["schedule_data"] | "";
  const uint32_t issuedAt = document["issued_at"] | 0;
  const uint32_t expiresAt = document["expires_at"] | 0;
  const String receivedSignature = document["sig"] | "";

  if (version != 1 || !validCommandId(commandId) || action != "set_schedule" || scheduleData.length() > 320) {
    rejectScheduleCommand(commandId, "invalid_payload");
    return;
  }
  if (!clockReady()) {
    rejectScheduleCommand(commandId, "clock_not_ready");
    return;
  }

  const uint32_t now = epochNow();
  if (!validCommandTime(issuedAt, expiresAt, now)) {
    rejectScheduleCommand(commandId, "command_expired");
    return;
  }

  const String canonical = String(version) + "|" + commandId + "|" + action + "|" +
    scheduleData + "|" + String(issuedAt) + "|" + String(expiresAt);
  if (!constantTimeEquals(receivedSignature, hmacSha256(COMMAND_SECRET, canonical))) {
    rejectScheduleCommand(commandId, "invalid_signature");
    return;
  }

  if (commandId.equals(safetyState.lastScheduleCommandId)) {
    publishAcknowledgement(commandId, "duplicate", 0, "duplicate_command", "set_schedule");
    return;
  }
  if (safetyState.lastScheduleIssuedAt > 0 && issuedAt < safetyState.lastScheduleIssuedAt) {
    rejectScheduleCommand(commandId, "stale_schedule");
    return;
  }

  ScheduleEntry schedules[MAX_SCHEDULES];
  memset(schedules, 0, sizeof(schedules));
  uint8_t scheduleCount = 0;
  if (!parseScheduleData(scheduleData, schedules, scheduleCount)) {
    rejectScheduleCommand(commandId, "invalid_schedule");
    return;
  }

  const uint32_t localNow = now + TIMEZONE_OFFSET_SECONDS;
  const uint32_t localDay = localNow / 86400UL;
  const time_t localTimeValue = static_cast<time_t>(localNow);
  struct tm localTime;
  gmtime_r(&localTimeValue, &localTime);
  for (uint8_t i = 0; i < scheduleCount; ++i) {
    if (
      schedules[i].enabled == 1 &&
      schedules[i].hour == localTime.tm_hour &&
      schedules[i].minute == localTime.tm_min &&
      (schedules[i].daysMask & (1U << localTime.tm_wday)) != 0
    ) {
      schedules[i].lastRunLocalDay = localDay;
    }
  }

  memset(safetyState.schedules, 0, sizeof(safetyState.schedules));
  memcpy(safetyState.schedules, schedules, sizeof(schedules));
  safetyState.scheduleCount = scheduleCount;
  safetyState.lastScheduleIssuedAt = issuedAt;
  memset(safetyState.lastScheduleCommandId, 0, sizeof(safetyState.lastScheduleCommandId));
  commandId.toCharArray(safetyState.lastScheduleCommandId, sizeof(safetyState.lastScheduleCommandId));
  saveSafetyState();

  lastError = "";
  publishAcknowledgement(commandId, "completed", 0, "schedule_updated", "set_schedule");
  publishState();
}

void processConfigCommand(JsonDocument &document) {
  const int version = document["v"] | 0;
  const String commandId = document["id"] | "";
  const String action = document["action"] | "";
  const String configData = document["config_data"] | "";
  const uint32_t issuedAt = document["issued_at"] | 0;
  const uint32_t expiresAt = document["expires_at"] | 0;
  const String receivedSignature = document["sig"] | "";

  if (version != 1 || !validCommandId(commandId) || action != "set_config" || configData.length() > 64) {
    rejectConfigCommand(commandId, "invalid_payload");
    return;
  }
  if (!clockReady()) {
    rejectConfigCommand(commandId, "clock_not_ready");
    return;
  }
  const uint32_t now = epochNow();
  if (!validCommandTime(issuedAt, expiresAt, now)) {
    rejectConfigCommand(commandId, "command_expired");
    return;
  }
  const String canonical = String(version) + "|" + commandId + "|" + action + "|" +
    configData + "|" + String(issuedAt) + "|" + String(expiresAt);
  if (!constantTimeEquals(receivedSignature, hmacSha256(COMMAND_SECRET, canonical))) {
    rejectConfigCommand(commandId, "invalid_signature");
    return;
  }
  if (commandId.equals(safetyState.lastConfigCommandId)) {
    publishAcknowledgement(commandId, "duplicate", 0, "duplicate_command", "set_config");
    return;
  }
  if (safetyState.lastConfigIssuedAt > 0 && issuedAt < safetyState.lastConfigIssuedAt) {
    rejectConfigCommand(commandId, "stale_config");
    return;
  }

  int mode = 0;
  int closedAngle = 0;
  int openAngle = 0;
  int turnDegrees = 0;
  unsigned long msPerRev = 0;
  int forwardUs = 0;
  int reverseUs = 0;
  int stopUs = 0;
  int direction = 0;
  int continuousReturn = 0;
  unsigned long minInterval = 0;
  int maxPortions = 0;
  int maxFeeds = 0;
  char extra = '\0';
  const int matched = sscanf(configData.c_str(), "%d,%d,%d,%d,%lu,%d,%d,%d,%d,%d,%lu,%d,%d%c",
    &mode, &closedAngle, &openAngle, &turnDegrees, &msPerRev, &forwardUs, &reverseUs, &stopUs,
    &direction, &continuousReturn, &minInterval, &maxPortions, &maxFeeds, &extra);
  int parsedFields = matched;
  if (parsedFields != 13) {
    mode = 0;
    closedAngle = 0;
    openAngle = 0;
    turnDegrees = 0;
    msPerRev = 0;
    forwardUs = 0;
    reverseUs = 0;
    stopUs = 0;
    direction = 0;
    continuousReturn = 0;
    minInterval = 0;
    maxPortions = 0;
    maxFeeds = 0;
    extra = '\0';
    parsedFields = sscanf(configData.c_str(), "%d,%d,%d,%d,%lu,%d,%d,%d,%d,%lu,%d,%d%c",
      &mode, &closedAngle, &openAngle, &turnDegrees, &msPerRev, &forwardUs, &reverseUs, &stopUs,
      &direction, &minInterval, &maxPortions, &maxFeeds, &extra);
  }
  if (
    (parsedFields != 13 && parsedFields != 12) ||
    (mode != 0 && mode != 1) ||
    closedAngle < 0 || closedAngle > 180 ||
    openAngle < 0 || openAngle > 180 || (mode == 0 && closedAngle == openAngle) ||
    turnDegrees < 1 || turnDegrees > 360 ||
    msPerRev < 250UL || msPerRev > 10000UL ||
    forwardUs < 1000 || forwardUs > 2000 ||
    reverseUs < 1000 || reverseUs > 2000 ||
    stopUs < 1400 || stopUs > 1600 ||
    (direction != 0 && direction != 1) ||
    (continuousReturn != 0 && continuousReturn != 1) ||
    minInterval < 10UL || minInterval > 86400UL ||
    maxPortions < 1 || maxPortions > 300 ||
    maxFeeds < 1 || maxFeeds > 100
  ) {
    rejectConfigCommand(commandId, "invalid_config");
    return;
  }

  safetyState.servoMode = static_cast<uint8_t>(mode);
  safetyState.servoClosedAngle = static_cast<uint16_t>(closedAngle);
  safetyState.servoOpenAngle = static_cast<uint16_t>(openAngle);
  safetyState.continuousTurnDegrees = static_cast<uint16_t>(turnDegrees);
  safetyState.continuousMsPerRev = static_cast<uint32_t>(msPerRev);
  safetyState.continuousForwardUs = static_cast<uint16_t>(forwardUs);
  safetyState.continuousReverseUs = static_cast<uint16_t>(reverseUs);
  safetyState.continuousStopUs = static_cast<uint16_t>(stopUs);
  safetyState.continuousDirection = static_cast<uint8_t>(direction);
  safetyState.continuousReturn = static_cast<uint8_t>(continuousReturn);
  safetyState.minFeedIntervalSeconds = static_cast<uint32_t>(minInterval);
  safetyState.maxPortionsPer24h = static_cast<uint16_t>(maxPortions);
  safetyState.maxFeedsPer24h = static_cast<uint16_t>(maxFeeds);
  safetyState.lastConfigIssuedAt = issuedAt;
  memset(safetyState.lastConfigCommandId, 0, sizeof(safetyState.lastConfigCommandId));
  commandId.toCharArray(safetyState.lastConfigCommandId, sizeof(safetyState.lastConfigCommandId));
  saveSafetyState();

  lastError = "";
  publishAcknowledgement(commandId, "completed", 0, "config_updated", "set_config");
  publishState();
}

void processFeedCommand(JsonDocument &document) {
  const int version = document["v"] | 0;
  const String commandId = document["id"] | "";
  const String action = document["action"] | "";
  const int portion = document["portion"] | 0;
  const uint32_t issuedAt = document["issued_at"] | 0;
  const uint32_t expiresAt = document["expires_at"] | 0;
  const String receivedSignature = document["sig"] | "";

  if (version != 1 || !validCommandId(commandId) || action != "feed") {
    rejectCommand(commandId, portion, "invalid_payload");
    return;
  }
  if (portion < 1 || portion > MAX_PORTION) {
    rejectCommand(commandId, portion, "invalid_portion");
    return;
  }
  if (!clockReady()) {
    rejectCommand(commandId, portion, "clock_not_ready");
    return;
  }

  const uint32_t now = epochNow();
  if (!validCommandTime(issuedAt, expiresAt, now)) {
    rejectCommand(commandId, portion, "command_expired");
    return;
  }

  const String canonical = String(version) + "|" + commandId + "|" + action + "|" +
    String(portion) + "|" + String(issuedAt) + "|" + String(expiresAt);
  const String expectedSignature = hmacSha256(COMMAND_SECRET, canonical);
  if (!constantTimeEquals(receivedSignature, expectedSignature)) {
    rejectCommand(commandId, portion, "invalid_signature");
    return;
  }

  if (commandId.equals(safetyState.lastCommandId)) {
    publishAcknowledgement(commandId, "duplicate", portion, "duplicate_command");
    return;
  }

  refreshRollingWindow(now);
  if (safetyState.lastFeedAt > 0 && now >= safetyState.lastFeedAt && now - safetyState.lastFeedAt < safetyState.minFeedIntervalSeconds) {
    rejectCommand(commandId, portion, "cooldown");
    return;
  }
  if (safetyState.feedsInWindow >= safetyState.maxFeedsPer24h ||
      safetyState.portionsInWindow + portion > safetyState.maxPortionsPer24h) {
    rejectCommand(commandId, portion, "daily_limit");
    return;
  }

  // Persist before moving the servo. A reset during motion must never cause the
  // same MQTT command to run again after reconnecting.
  memset(safetyState.lastCommandId, 0, sizeof(safetyState.lastCommandId));
  commandId.toCharArray(safetyState.lastCommandId, sizeof(safetyState.lastCommandId));
  safetyState.lastFeedAt = now;
  safetyState.portionsInWindow += portion;
  safetyState.feedsInWindow += 1;
  saveSafetyState();

  publishAcknowledgement(commandId, "processing", portion, "");
  const bool completed = runServoCycles(portion);
  if (completed) {
    lastError = "";
    lastFeedSource = "manual";
    publishAcknowledgement(commandId, "completed", portion, "motor_sequence_completed");
  } else {
    lastError = "servo_failed";
    publishAcknowledgement(commandId, "failed", portion, "servo_failed");
  }
  publishState();
}

void runScheduledFeed(uint8_t scheduleIndex, int portion, uint32_t now) {
  refreshRollingWindow(now);
  if (
    safetyState.lastFeedAt > 0 &&
    now >= safetyState.lastFeedAt &&
    now - safetyState.lastFeedAt < safetyState.minFeedIntervalSeconds
  ) {
    lastError = "schedule_cooldown";
    publishState();
    return;
  }
  if (safetyState.feedsInWindow >= safetyState.maxFeedsPer24h ||
      safetyState.portionsInWindow + portion > safetyState.maxPortionsPer24h) {
    lastError = "schedule_daily_limit";
    publishState();
    return;
  }

  safetyState.lastFeedAt = now;
  safetyState.portionsInWindow += portion;
  safetyState.feedsInWindow += 1;
  saveSafetyState();

  lastFeedSource = "schedule";
  const bool completed = runServoCycles(portion);
  lastError = completed ? "" : "servo_failed";
  Serial.printf(
    "Schedule %u %s, portion: %d\n",
    scheduleIndex,
    completed ? "completed" : "failed",
    portion
  );
  publishState();
}

void checkSchedules() {
  if (!clockReady() || safetyState.scheduleCount == 0) return;

  const uint32_t now = epochNow();
  const uint32_t localNow = now + TIMEZONE_OFFSET_SECONDS;
  const uint32_t minuteKey = localNow / 60UL;
  if (minuteKey == lastScheduleMinute) return;
  lastScheduleMinute = minuteKey;

  const uint32_t localDay = localNow / 86400UL;
  const time_t localTimeValue = static_cast<time_t>(localNow);
  struct tm localTime;
  gmtime_r(&localTimeValue, &localTime);

  for (uint8_t i = 0; i < safetyState.scheduleCount && i < MAX_SCHEDULES; ++i) {
    ScheduleEntry &schedule = safetyState.schedules[i];
    if (
      schedule.enabled != 1 ||
      schedule.hour != localTime.tm_hour ||
      schedule.minute != localTime.tm_min ||
      (schedule.daysMask & (1U << localTime.tm_wday)) == 0 ||
      schedule.lastRunLocalDay == localDay
    ) {
      continue;
    }

    // Mark the occurrence before moving the servo. A reboot during motion must
    // not run the same schedule twice on the same local day.
    schedule.lastRunLocalDay = localDay;
    saveSafetyState();
    runScheduledFeed(i, schedule.portion, now);
  }
}

void onMqttMessage(char *incomingTopic, byte *payload, unsigned int length) {
  if (length == 0 || length > 900) return;

  String body;
  body.reserve(length);
  for (unsigned int i = 0; i < length; ++i) body += static_cast<char>(payload[i]);

  const String receivedTopic(incomingTopic);
  if (receivedTopic == queryTopic) {
    publishState();
    return;
  }
  if (receivedTopic != commandTopic) return;

  StaticJsonDocument<896> document;
  const DeserializationError error = deserializeJson(document, body);
  if (error) {
    rejectCommand("unknown", 0, "invalid_payload");
    return;
  }
  const String action = document["action"] | "";
  if (action == "feed") {
    processFeedCommand(document);
  } else if (action == "set_schedule") {
    processScheduleCommand(document);
  } else if (action == "set_config") {
    processConfigCommand(document);
  } else {
    rejectCommand(document["id"] | "unknown", 0, "invalid_payload");
  }
}

String configPortalSsid() {
  return String(CONFIG_PORTAL_HOSTNAME) + "-" + String(ESP.getChipId(), HEX);
}

String configPortalPage(const String &message = "") {
  const String currentSsid = configuredSsid();
  String html;
  html.reserve(4200);
  html += F("<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>鱼缸投喂器 Wi-Fi 配置</title><style>");
  html += F("body{margin:0;padding:24px;background:#eef3f2;color:#14272c;font-family:Arial,'Microsoft YaHei',sans-serif}main{max-width:520px;margin:0 auto;background:#fff;border:1px solid #d5dfdd;border-radius:14px;padding:24px;box-shadow:0 12px 30px #12323a18}h1{font-size:1.45rem;margin:0 0 8px}p{line-height:1.6;color:#697a7e}.note{padding:12px;background:#eef5f4;border-left:4px solid #0f7780}.field{margin:16px 0}label{display:block;font-weight:bold;margin-bottom:7px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #d5dfdd;border-radius:8px;font-size:1rem}button{border:0;border-radius:8px;padding:12px 16px;background:#0f7780;color:#fff;font-weight:bold;font-size:1rem}button.danger{margin-left:8px;background:#fff1ef;color:#a8403c;border:1px solid #e0bdb9}.message{color:#19704d;font-weight:bold}</style></head><body><main>");
  html += F("<h1>鱼缸投喂器 Wi-Fi 配置</h1><p>设备会把下面的 Wi-Fi 信息保存到闪存。断电、重启后仍会保留。</p><div class='note'>当前配置热点：<b>");
  html += configPortalSsid();
  html += F("</b><br>热点密码：<b>");
  html += CONFIG_PORTAL_AP_PASSWORD;
  html += F("</b><br>保存后设备会自动重启。</div>");
  if (message.length() > 0) {
    html += F("<p class='message'>");
    html += message;
    html += F("</p>");
  }
  html += F("<form method='post' action='/save'><div class='field'><label>家里的 2.4GHz Wi-Fi 名称</label><input name='ssid' maxlength='32' required value='");
  html += htmlEscape(currentSsid);
  html += F("'></div><div class='field'><label>Wi-Fi 密码</label><input name='password' type='password' maxlength='63' placeholder='留空表示保持原密码'></div><label style='display:flex;gap:8px;align-items:center;font-weight:normal'><input name='open' type='checkbox' value='1' style='width:auto'>这是无密码 Wi-Fi</label><br><button type='submit'>保存并连接</button></form><form method='post' action='/clear' style='display:inline'><button class='danger' type='submit'>清除 Wi-Fi，重新配网</button></form><p>如果家里 Wi-Fi 改名或密码失效，设备会自动开启配置热点。也可以双击 RST，或按住 FLASH 再按 RST，强制重新配网。</p></main></body></html>");
  return html;
}

void handleConfigRoot() {
  configServer.send(200, "text/html; charset=utf-8", configPortalPage());
}

void handleConfigSave() {
  const String ssid = configServer.arg("ssid");
  String password = configServer.arg("password");
  if (configServer.hasArg("open")) password = "";
  else if (password.length() == 0 && hasStoredWifi() && ssid == String(wifiConfig.ssid)) {
    password = String(wifiConfig.password);
  }
  if (ssid.length() == 0 || ssid.length() > 32 || password.length() > 63) {
    configServer.send(400, "text/html; charset=utf-8", configPortalPage("Wi-Fi 名称或密码长度不正确。"));
    return;
  }
  saveWifiConfig(ssid, password);
  configServer.send(200, "text/html; charset=utf-8", configPortalPage("已保存，设备将在 1 秒后重启并连接新 Wi-Fi。"));
  restartAt = millis() + 1000UL;
}

void handleConfigClear() {
  clearWifiConfig();
  configServer.send(200, "text/html; charset=utf-8", configPortalPage("已清除 Wi-Fi，设备将在 1 秒后进入配网模式。"));
  restartAt = millis() + 1000UL;
}

void ensureConfigServer() {
  if (configServerStarted) return;

  configServer.on("/", HTTP_GET, handleConfigRoot);
  configServer.on("/save", HTTP_POST, handleConfigSave);
  configServer.on("/clear", HTTP_POST, handleConfigClear);
  configServer.onNotFound([]() {
    configServer.sendHeader("Location", "/", true);
    configServer.send(302, "text/plain", "");
  });
  configServer.begin();
  configServerStarted = true;
}

void startConfigPortal() {
  if (configPortalActive) return;
  clearDoubleResetMarker();
  doubleResetMarkerSetAt = 0;
  configPortalActive = true;
  WiFi.disconnect();
  WiFi.mode(WIFI_AP);
  const String apSsid = configPortalSsid();
  WiFi.softAP(apSsid.c_str(), CONFIG_PORTAL_AP_PASSWORD);
  dnsServer.start(53, "*", WiFi.softAPIP());

  ensureConfigServer();

  Serial.println();
  Serial.println("Wi-Fi configuration mode");
  Serial.print("Setup SSID: ");
  Serial.println(apSsid);
  Serial.print("Setup password: ");
  Serial.println(CONFIG_PORTAL_AP_PASSWORD);
  Serial.print("Open: http://");
  Serial.println(WiFi.softAPIP());
}

void serviceConfigServer() {
  if (!configServerStarted) return;
  if (configPortalActive) dnsServer.processNextRequest();
  configServer.handleClient();
  if (!configPortalActive && restartAt != 0 && static_cast<int32_t>(millis() - restartAt) >= 0) {
    ESP.restart();
  }
}

void serviceConfigPortal() {
  dnsServer.processNextRequest();
  configServer.handleClient();
  if (restartAt != 0 && static_cast<int32_t>(millis() - restartAt) >= 0) {
    ESP.restart();
  }
  delay(2);
}

bool ensureWiFi() {
  if (configPortalActive) return false;
  if (WiFi.status() == WL_CONNECTED) {
    ensureConfigServer();
    return true;
  }

  if (!hasConfiguredWifi()) {
    startConfigPortal();
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  const String ssid = configuredSsid();
  const String password = configuredPassword();
  WiFi.begin(ssid.c_str(), password.c_str());
  Serial.printf("Connecting to Wi-Fi: %s\n", ssid.c_str());

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && !due(millis(), startedAt, 20000UL)) {
    delay(250);
    yield();
  }
  if (WiFi.status() != WL_CONNECTED) {
    lastError = "wifi_connect_failed";
    startConfigPortal();
    return false;
  }

  Serial.print("Wi-Fi connected, IP: ");
  Serial.println(WiFi.localIP());
  ensureConfigServer();
  if (!mdnsStarted) {
    mdnsStarted = MDNS.begin(CONFIG_PORTAL_HOSTNAME);
    if (mdnsStarted) MDNS.addService("http", "tcp", 80);
  }
  startClockSync();
  return true;
}

bool connectMqtt() {
  if (mqttClient.connected()) return true;
  const uint32_t now = millis();
  if (!due(now, lastMqttAttemptAt, MQTT_RECONNECT_INTERVAL_MS)) return false;
  lastMqttAttemptAt = now;

  const String clientId = String("fish_") + String(ESP.getChipId(), HEX);
  const String willPayload = String("{\"v\":1,\"online\":false,\"device_id\":\"") + DEVICE_ID + "\",\"ts\":0}";
  Serial.println("Connecting to MixIO MQTT...");
  const bool connected = mqttClient.connect(
    clientId.c_str(),
    MIXIO_USERNAME,
    MIXIO_PROJECT_PASSWORD,
    onlineTopic.c_str(),
    1,
    true,
    willPayload.c_str()
  );
  if (!connected) {
    lastError = String("mqtt_connect_failed_") + mqttClient.state();
    Serial.printf("MQTT failed, state: %d\n", mqttClient.state());
    return false;
  }

  mqttClient.subscribe(commandTopic.c_str(), 1);
  mqttClient.subscribe(queryTopic.c_str(), 0);
  lastError = "";
  publishOnline(true);
  publishState();
  Serial.println("MixIO MQTT connected");
  return true;
}

void initializeServoPosition() {
  feederServo.attach(SERVO_PIN, 500, 2400);
  if (safetyState.servoMode == 1) feederServo.writeMicroseconds(safetyState.continuousStopUs);
  else feederServo.write(safetyState.servoClosedAngle);
  delay(500);
  feederServo.detach();
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("ESP8266 servo fish feeder starting");

  pinMode(CONFIG_PORTAL_BUTTON_PIN, INPUT_PULLUP);
  const bool doubleResetRequested = consumeDoubleResetMarker();
  writeDoubleResetMarker();
  doubleResetMarkerSetAt = millis();
  loadSafetyState();
  initializeServoPosition();

  commandTopic = topicFor("feeder_cmd");
  acknowledgementTopic = topicFor("feeder_ack");
  stateTopic = topicFor("feeder_state");
  onlineTopic = topicFor("feeder_online");
  queryTopic = topicFor("feeder_query");

  mqttClient.setServer(MIXIO_HOST, MIXIO_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(2048);
  mqttClient.setKeepAlive(30);

  if (doubleResetRequested || digitalRead(CONFIG_PORTAL_BUTTON_PIN) == LOW) {
    Serial.println("Configuration button held; starting Wi-Fi setup mode");
    clearWifiConfig();
    startConfigPortal();
  } else {
    ensureWiFi();
  }
  lastMqttAttemptAt = millis() - MQTT_RECONNECT_INTERVAL_MS;
  lastStatePublishAt = millis() - STATE_PUBLISH_INTERVAL_MS;
}

void loop() {
  if (!configPortalActive && doubleResetMarkerSetAt != 0 && due(millis(), doubleResetMarkerSetAt, DOUBLE_RESET_WINDOW_MS)) {
    clearDoubleResetMarker();
    doubleResetMarkerSetAt = 0;
  }
  checkSchedules();
  if (configPortalActive) {
    serviceConfigPortal();
    return;
  }
  serviceConfigServer();
  if (!ensureWiFi()) {
    delay(1000);
    return;
  }
  if (!connectMqtt()) {
    delay(20);
    return;
  }

  mqttClient.loop();
  const uint32_t now = millis();
  const bool timeIsReady = clockReady();
  if (timeIsReady && !clockWasReady) {
    clockWasReady = true;
    publishOnline(true);
    publishState();
  }
  if (due(now, lastStatePublishAt, STATE_PUBLISH_INTERVAL_MS)) {
    lastStatePublishAt = now;
    publishState();
  }
  delay(10);
}
