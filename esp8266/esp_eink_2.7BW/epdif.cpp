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
    // Configurer les pins GPIO du driver e-paper
    // SPI.begin() + beginTransaction() sont gérés par activateSPI() dans le sketch
    // principal AVANT d'appeler Init() — ne pas les refaire ici (double init = état indéfini).
    pinMode(CS_PIN, OUTPUT);
    pinMode(RST_PIN, OUTPUT);
    pinMode(DC_PIN, OUTPUT);
    pinMode(BUSY_PIN, INPUT);

    digitalWrite(CS_PIN, HIGH);
    digitalWrite(DC_PIN, LOW);
    digitalWrite(RST_PIN, HIGH);

    return 0;
}