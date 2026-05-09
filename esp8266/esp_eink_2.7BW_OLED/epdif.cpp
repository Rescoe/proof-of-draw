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
    pinMode(CS_PIN, OUTPUT);
    pinMode(RST_PIN, OUTPUT);
    pinMode(DC_PIN, OUTPUT);
    pinMode(BUSY_PIN, INPUT);

    digitalWrite(CS_PIN, HIGH);
    digitalWrite(DC_PIN, LOW);
    digitalWrite(RST_PIN, HIGH);

/*
    SPI.begin();
    SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
*/
    SPI.begin();  // SCK=D5/GPIO14, MOSI=D7/GPIO13 auto sur ESP8266
SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));  // Plus lent pour test

    return 0;
}