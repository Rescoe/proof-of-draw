/**
 * @filename   : epdif.h
 * @brief      : UNO R4 WiFi interface for Waveshare e-Paper 2.7" V2
 */

#ifndef EPDIF_H
#define EPDIF_H

#include <Arduino.h>
#include <SPI.h>

// Mapping UNO R4 WiFi — SPI matériel : COPI D11, SCK D13.
#define RST_PIN  8
#define DC_PIN   9
#define CS_PIN   10
#define BUSY_PIN 7

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
