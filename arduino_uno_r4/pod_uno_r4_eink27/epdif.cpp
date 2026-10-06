#include "epdif.h"

EpdIf::EpdIf(void) {
}

EpdIf::~EpdIf(void) {
}

void EpdIf::DigitalWrite(int pin, int value) {
    digitalWrite(pin, value);
}

int EpdIf::DigitalRead(int pin) {
    return digitalRead(pin);
}

void EpdIf::DelayMs(unsigned int delaytime) {
    delay(delaytime);
}

void EpdIf::SpiTransfer(unsigned char data) {
    digitalWrite(CS_PIN, LOW);
    SPI.transfer(data);
    digitalWrite(CS_PIN, HIGH);
}

int EpdIf::IfInit(void) {
    // SPI.begin() + beginTransaction() sont gérés par le sketch principal.
    pinMode(CS_PIN, OUTPUT);
    pinMode(RST_PIN, OUTPUT);
    pinMode(DC_PIN, OUTPUT);
    pinMode(BUSY_PIN, INPUT);

    digitalWrite(CS_PIN, HIGH);
    digitalWrite(DC_PIN, LOW);
    digitalWrite(RST_PIN, HIGH);

    return 0;
}
