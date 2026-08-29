#include <Arduino.h>
#include <Servo.h>

// NodeMCU D1 is GPIO5. Power the servo from a separate regulated 5V supply,
// and connect the supply GND to NodeMCU GND.
static const uint8_t SERVO_SIGNAL_PIN = D1;
static const uint16_t POSITION_MIN_US = 500;
static const uint16_t POSITION_CENTER_US = 1500;
static const uint16_t POSITION_MAX_US = 2400;
static const uint32_t HOLD_MS = 1800;

Servo testServo;

void moveTo(uint16_t pulseUs, const char *label) {
  Serial.printf("Move to %s: %u us\n", label, pulseUs);
  testServo.writeMicroseconds(pulseUs);
  delay(HOLD_MS);
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("SG90 direct diagnostic starting");
  testServo.attach(SERVO_SIGNAL_PIN, POSITION_MIN_US, POSITION_MAX_US);

  if (!testServo.attached()) {
    Serial.println("ERROR: Servo attach failed");
    return;
  }

  moveTo(POSITION_CENTER_US, "center");
}

void loop() {
  if (!testServo.attached()) {
    delay(1000);
    return;
  }

  moveTo(POSITION_MIN_US, "minimum");
  moveTo(POSITION_CENTER_US, "center");
  moveTo(POSITION_MAX_US, "maximum");
  moveTo(POSITION_CENTER_US, "center");
}
