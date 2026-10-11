# Preuve source WiFiS3 — réception SSL non bornée par l'appelant

## Objet

Cette note fige les sources effectivement utilisées lors des compilations locales avec les cœurs Arduino Renesas UNO 1.5.3 et 1.6.0. Elle permet à une session distante de contrôler le prochain correctif sans dépendre des installations de la machine du porteur.

Les trois fichiers concernés sont **identiques octet par octet** entre les deux versions :

| Fichier | SHA-256 (1.5.3 = 1.6.0) |
|---|---|
| `libraries/WiFiS3/src/WiFiSSLClient.cpp` | `69EED35A5498B7F6CAAEDDB43DC806F80D4B13D3FE5A7E0474171B152079FF53` |
| `libraries/WiFiS3/src/WiFiClient.h` | `C5ACB6074B928C9C5C083835F28A6396C3151A6C4520576934BFB974D070228F` |
| `libraries/WiFiS3/src/Modem.cpp` | `2C2AA923EA176CF723932E55F5AFEDF9AF25DE4B7BA738595F068BC0B2CAAD26` |

## Chaîne exacte

`WiFiClient.h` fixe le FIFO interne à 1 024 octets :

```cpp
static constexpr uint32_t RX_BUFFER_DIM = 1024;
std::shared_ptr<FifoBuffer<uint8_t,RX_BUFFER_DIM>> rx_buffer;
```

Dans `WiFiSSLClient::_read()`, la taille de la commande modem vient de la place libre du FIFO, pas de la quantité demandée par le consommateur :

```cpp
string res = "";
uint32_t size = rx_buffer->freePositions() - 1;
modem.begin();
modem.avoid_trim_results();
modem.read_using_size();
if (modem.write(string(PROMPT(_SSLCLIENTRECEIVE)), res,
                "%s%d,%d\r\n", CMD_WRITE(_SSLCLIENTRECEIVE), _sock, size)) {
```

Un FIFO vide autorise donc une commande `_SSLCLIENTRECEIVE` proche de 1 023 octets. Réduire seulement la taille demandée à `Reader::read()` ne borne pas cette commande privée.

Dans l'état `Sized` du parseur de `Modem.cpp`, la réponse est accumulée octet par octet dans une `std::string` :

```cpp
case at_parse_state_t::Sized:
    data_res += c;
    if (++sized_read_count == sized_read_size) {
        state = at_parse_state_t::Res;
    }
    break;
```

Cette croissance peut exiger un nouveau bloc contigu tout en gardant l'ancien bloc vivant pendant la copie. Le canari AUDIT5 a observé 2 976 octets libres mais seulement 1 888 octets de sommet vierge avant `read()`, puis `abort()` dans `read()`.

## Conséquence pour le correctif

Le lot `PULLFRAME-BOUNDED-SSL-FIX1` doit démontrer que **la valeur réellement envoyée à `_SSLCLIENTRECEIVE`** est bornée. Un changement limité au lecteur HTTP ou à la taille passée au `read()` public ne suffit pas.

Les fichiers du cœur installés ne doivent pas être modifiés. La solution doit vivre dans le projet, rester limitée au firmware UNO R4 e-ink 2,9 pouces jusqu'au canari matériel, préserver tous les octets et échouer fermé.
