// pod_ota_keys.h — clés PUBLIQUES de publication OTA (ota-a active, ota-b de secours). Publiques et versionnées ; les moitiés PRIVÉES restent hors du dépôt (~/.pod-ota-release). Générées par ota-lab/esp8266-ota2/tools/configure.mjs.
#pragma once
#include <pgmspace.h>
static const char POD_OTA_KEY_A_PEM[] PROGMEM =
  "-----BEGIN PUBLIC KEY-----\n"
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4ATxI28ibkQE/xNqI4YQ\n"
  "wKKCFgmOyV56J5YN0AAHmfKXFmb57oFUzq+VT16IhV5z3Iw4KCUQ0LpW6+ir2IDr\n"
  "6lFHOAO8L2aRx4MvsouzTkpykcqlfu7guq2OGXdnVb3j8J1zuXEANtlg4LukmFE6\n"
  "UWAd67tvIQBdYXCGFP2KP2Qo1gJd+Zn0b8xrig3cnucAL+VnNexb34C2umYFXmnc\n"
  "VoNM1xaqfncFpPExh+F9KGR1D9V05I+2CiL8KfGGrw3Wik81zBxZI/v6gi2zMHHu\n"
  "kYGN1uu82DJs6wR33A258wsz7qs2l20BbMjrE25PamclapO2sQvrEgqqZ5nOAm+F\n"
  "QwIDAQAB\n"
  "-----END PUBLIC KEY-----\n";
static const char POD_OTA_KEY_B_PEM[] PROGMEM =
  "-----BEGIN PUBLIC KEY-----\n"
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu7lO5y5Mi1juUkaiOrFW\n"
  "Hif50gePSSZg88sO4JD0oUpZvYi474QVzfUeYQm/gI9qZP/ZZViz8+1t7eKdr6Bg\n"
  "HFZjT+tDH3lPfOEKdsaieScpVi/CDi9iOXPTTEqUqceU7sXQ3CH4mn7xVxsAZ8O1\n"
  "lXbFIS+YhgW1uS0X5Xopz21ng0aVgfeC1HwH7413wSdTtawNO+Np0FCPQfBsvr9s\n"
  "+bgaPW0ZZiUtj9CRat7ixqMdFzWtM+xMzj7zjTwmGWAHQH3c/bqJTtF9YVweO4xG\n"
  "ziZsx7IzzFlRh9NQ1XINH8Roqi1XAfl0TqJY9AFGye+m7qlDbtdvcB93Q6RNvBSt\n"
  "RQIDAQAB\n"
  "-----END PUBLIC KEY-----\n";
