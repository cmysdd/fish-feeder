#pragma once

// Copy this file to config.h and replace the MixIO placeholders.
#define CONFIGURED 0

// Wi-Fi is configured from the device's local setup page and stored in flash.
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define CONFIG_PORTAL_AP_PASSWORD "fish8266"
#define CONFIG_PORTAL_HOSTNAME "fish-feeder"
#define CONFIG_PORTAL_BUTTON_PIN D3

// MixIO account project. Do not use a public Mixly Key project.
#define MIXIO_HOST "mixio.mixly.cn"
#define MIXIO_PORT 1883
#define MIXIO_USERNAME "replace-with-mixio-username"
#define MIXIO_PROJECT "fish-feeder"
#define MIXIO_PROJECT_PASSWORD "replace-with-project-password"

// Generate this in the custom web page. It must exactly match the browser value.
#define COMMAND_SECRET "replace-with-at-least-24-random-characters"

#define DEVICE_ID "feeder-001"
#define SERVO_PIN D1
#define SERVO_CLOSED_ANGLE 12
#define SERVO_OPEN_ANGLE 92
#define SERVO_OPEN_MS 550
#define SERVO_SETTLE_MS 450

#define MAX_PORTION 3
#define MAX_SCHEDULES 6
#define TIMEZONE_OFFSET_SECONDS 28800UL
#define MIN_FEED_INTERVAL_SECONDS 60UL
#define MAX_PORTIONS_PER_24H 12
#define COMMAND_MAX_AGE_SECONDS 60UL
#define STATE_PUBLISH_INTERVAL_MS 60000UL
#define MQTT_RECONNECT_INTERVAL_MS 5000UL
