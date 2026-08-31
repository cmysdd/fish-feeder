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
#define SERVO_CLOSED_ANGLE 10
#define SERVO_OPEN_ANGLE 170
#define SERVO_OPEN_MS 550
#define SERVO_SETTLE_MS 450
#define SERVO_MODE_DEFAULT 0
#define SERVO_POSITIONAL_MIN_US 500
#define SERVO_POSITIONAL_MAX_US 2400
#define SERVO_POSITIONAL_MOVE_MS 1000UL
#define SERVO_ACTION_PAUSE_MS 800UL
#define SERVO_POSITIONAL_RETURN_MS 1000UL
#define SERVO_CONTINUOUS_TURN_DEGREES 90
#define SERVO_CONTINUOUS_MS_PER_REV 4000UL
#define SERVO_CONTINUOUS_FORWARD_US 1700
#define SERVO_CONTINUOUS_REVERSE_US 1300
#define SERVO_CONTINUOUS_STOP_US 1500

#define MAX_PORTION 1
#define MAX_SCHEDULES 6
#define TIMEZONE_OFFSET_SECONDS 28800UL
#define MIN_FEED_INTERVAL_SECONDS 60UL
#define MAX_PORTIONS_PER_24H 12
#define DEFAULT_MAX_FEEDS_PER_24H 8
#define COMMAND_MAX_AGE_SECONDS 60UL
#define STATE_PUBLISH_INTERVAL_MS 60000UL
#define MQTT_RECONNECT_INTERVAL_MS 5000UL
