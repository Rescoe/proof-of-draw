/**
 * @filename   : epd2in7_V2.h
 * @brief      : Header file for e-paper library epd2in7_V2.cpp
 * @author     : Waveshare
 */

#ifndef EPD2IN7_V2_H
#define EPD2IN7_V2_H

#include "epdif.h"

// Display resolution
#define EPD_WIDTH   176
#define EPD_HEIGHT  264

class Epd : public EpdIf {
public:
    unsigned int WIDTH;
    unsigned int HEIGHT;

    Epd();
    ~Epd();
    int  Init(void);
    int  Init_Fast(void);
    void Init_4Gray(void);
    void SendCommand(unsigned char command);
    void SendData(unsigned char data);
    void ReadBusy(void);
    void Reset(void);
    void Lut(void);
    void TurnOnDisplay(void);
    void TurnOnDisplay_Fast(void);
    void TurnOnDisplay_Partial(void);
    void TurnOnDisplay_4GRAY(void);
    void Clear(void);
    void Display(const unsigned char* Image);
    void Display_Fast(const unsigned char* Image);
    void Display_Base(const unsigned char* Image);
    void Display_Base_color(unsigned char color);
    void Display_Partial(unsigned char* Image, unsigned int Xstart, unsigned int Ystart, unsigned int Xend, unsigned int Yend);
    void Display_Partial_Not_refresh(unsigned char* Image, unsigned int Xstart, unsigned int Ystart, unsigned int Xend, unsigned int Yend);
    void Display4Gray(const unsigned char *Image);
    void Sleep(void);
    void Display_RAM(const unsigned char* Image);

private:
    unsigned int reset_pin;
    unsigned int dc_pin;
    unsigned int cs_pin;
    unsigned int busy_pin;
};

#endif