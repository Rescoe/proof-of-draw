/**
 * @filename   : epdif.h
 * @brief      : ESP8266 / NodeMCU interface for Waveshare e-Paper
 */

#ifndef EPDIF_H
#define EPDIF_H

#include <Arduino.h>
#include <SPI.h>

// Mapping NodeMCU / ESP8266
#define RST_PIN  D1   // GPIO5
#define DC_PIN   D2   // GPIO4
#define CS_PIN   D8   // GPIO15
#define BUSY_PIN D0   // GPIO16

class EpdIf {
public:
    EpdIf(void);
    ~EpdIf(void);

    static int  IfInit(void);
    static void DigitalWrite(int pin, int value);
    static int  DigitalRead(int pin);
    static void DelayMs(unsigned int delaytime);
    static void SpiTransfer(unsigned char data);
};

#endif