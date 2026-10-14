
## PRODUCTION (POD_CANARY = 0)

### WiFi.* (module Wi-Fi : doit être sur pile dédiée podWifiRun)

- wifiStatusT/λwx → WiFi.status
- wifiFirmware/λwx → WiFi.firmwareVersion
- wifiBegin/λwx → WiFi.begin
- wifiMac/λwx → WiFi.macAddress
- wifiRssi/λwx → WiFi.RSSI
- wifiIpString/λwx → WiFi.localIP

### Conn (transaction TLS : doit être dans un « auto tx » de podNetRun)

- netHttpRaw/λtx → Conn c
- doFetchFrame/λtx → Conn c
- netReadCandidate/λtx → Conn c
- netGetBenchClip/λtx → Conn c
- netGetBlockClipToSd/λtx → Conn c

### deserializeJson (doit être sur la pile de travail podWorkRun)

- registerParseWork → deserializeJson
- pullParseWork → deserializeJson ×2
- validateParseWork → deserializeJson
- benchPollParseWork → deserializeJson

### Ed25519 / PodEd (doit passer par PodEd, pile dédiée)

- loadKeysFromEEPROM → PodEd::derivePublicKey
- generateKeys → PodEd::derivePublicKey
- signED25519 → PodEd::sign
- doValidateV2 → PodEd::sign
- selfTestEd25519 → PodEd::sign
- selfTestEd25519 → PodEd::verify

### SD.* (carte : pile réseau dédiée dans streamFrame, sinon onSd)

- initSDImpl → SD.begin
- initSDImpl → SD.exists
- initSDImpl → SD.mkdir
- restoreRowsImpl → SD.open
- saveMetaImpl → SD.exists
- saveMetaImpl → SD.remove
- saveMetaImpl → SD.open
- restoreLastFrameImpl → SD.exists ×2
- restoreLastFrameImpl → SD.open
- streamFrame → SD.exists ×2
- streamFrame → SD.remove ×2
- streamFrame → SD.open
- toggleCartelImpl → SD.exists
- toggleCartelImpl → SD.open
- animForgetImpl → SD.exists ×2
- animForgetImpl → SD.remove ×2
- animLoadMarkerImpl → SD.exists ×2
- animLoadMarkerImpl → SD.open
- netGetBlockClipToSd/λtx → SD.open
- animRemoveFiles → SD.exists ×2
- animRemoveFiles → SD.remove ×2
- animValidateAndMark → SD.open ×2
- runResidentAnim → SD.open

### lanceurs de piles dédiées

- logf → PodNet::runSized
- wifiStatusT/λwx → podWifiRun
- wifiFirmware/λwx → podWifiRun
- wifiBegin/λwx → podWifiRun
- wifiMac/λwx → podWifiRun
- wifiRssi/λwx → podWifiRun
- wifiIpString/λwx → podWifiRun
- netHttpRaw/λtx → podNetRun
- initSD/λw → onSd
- restoreRows/λw → onSd
- saveMeta/λw → onSd
- restoreLastFrame/λw → onSd
- doFetchFrame/λtx → podNetRun
- toggleCartel/λw → onSd
- registerParseOnWorkStack/λrk → podWorkRun
- registerStatusOnDedicatedStack/λw → onSd
- registerShowConnected/λw → onSd
- pullParseOnWorkStack/λwk → podWorkRun
- netReadCandidate/λtx → podNetRun
- validateParseOnWorkStack/λvk → podWorkRun
- benchPollDecode/λbk → podWorkRun
- netGetBenchClip/λtx → podNetRun
- animForget/λw → onSd
- animLoadMarker/λw → onSd
- netGetBlockClipToSd/λtx → podNetRun
- animRemoveFiles → onSd
- animValidateAndMark → onSd
- runResidentAnim → onSd
- onAnimTouch/λw → onSd

### routes serveur atteignables

- /api/ack-frame
- /api/bench/clip?device
- /api/bench/poll?device
- /api/bench/result
- /api/block-clip?hash
- /api/candidate-frame?candidate
- /api/obs-confirm
- /api/pull-frame?device
- /api/pull?device
- /api/register
- /api/validate-candidate?device
- /api/validation-result


## CANARI (POD_CANARY = 1)

### WiFi.* (module Wi-Fi : doit être sur pile dédiée podWifiRun)

- wifiStatusT/λwx → WiFi.status
- wifiFirmware/λwx → WiFi.firmwareVersion
- wifiBegin/λwx → WiFi.begin
- wifiMac/λwx → WiFi.macAddress
- wifiRssi/λwx → WiFi.RSSI
- wifiIpString/λwx → WiFi.localIP

### Conn (transaction TLS : doit être dans un « auto tx » de podNetRun)

- netHttpRaw/λtx → Conn c
- doFetchFrame/λtx → Conn c
- netGetBenchClip/λtx → Conn c
- netGetBlockClipToSd/λtx → Conn c

### deserializeJson (doit être sur la pile de travail podWorkRun)

- registerParseWork → deserializeJson
- pullParseWork → deserializeJson ×2
- benchPollParseWork → deserializeJson

### Ed25519 / PodEd (doit passer par PodEd, pile dédiée)

- loadKeysFromEEPROM → PodEd::derivePublicKey
- generateKeys → PodEd::derivePublicKey
- selfTestEd25519 → PodEd::sign
- selfTestEd25519 → PodEd::verify

### SD.* (carte : pile réseau dédiée dans streamFrame, sinon onSd)

- initSDImpl → SD.begin
- initSDImpl → SD.exists
- initSDImpl → SD.mkdir
- restoreRowsImpl → SD.open
- saveMetaImpl → SD.exists
- saveMetaImpl → SD.remove
- saveMetaImpl → SD.open
- restoreLastFrameImpl → SD.exists ×2
- restoreLastFrameImpl → SD.open
- streamFrame → SD.exists ×2
- streamFrame → SD.remove ×2
- streamFrame → SD.open
- toggleCartelImpl → SD.exists
- toggleCartelImpl → SD.open
- animForgetImpl → SD.exists ×2
- animForgetImpl → SD.remove ×2
- animLoadMarkerImpl → SD.exists ×2
- animLoadMarkerImpl → SD.open
- netGetBlockClipToSd/λtx → SD.open
- animRemoveFiles → SD.exists ×2
- animRemoveFiles → SD.remove ×2
- animValidateAndMark → SD.open ×2
- runResidentAnim → SD.open

### lanceurs de piles dédiées

- logf → PodNet::runSized
- podCanaryEmit → PodNet::runSized
- wifiStatusT/λwx → podWifiRun
- wifiFirmware/λwx → podWifiRun
- wifiBegin/λwx → podWifiRun
- wifiMac/λwx → podWifiRun
- wifiRssi/λwx → podWifiRun
- wifiIpString/λwx → podWifiRun
- netHttpRaw/λtx → podNetRun
- initSD/λw → onSd
- restoreRows/λw → onSd
- saveMeta/λw → onSd
- restoreLastFrame/λw → onSd
- doFetchFrame/λtx → podNetRun
- toggleCartel/λw → onSd
- registerParseOnWorkStack/λrk → podWorkRun
- registerStatusOnDedicatedStack/λw → onSd
- registerShowConnected/λw → onSd
- pullParseOnWorkStack/λwk → podWorkRun
- benchPollDecode/λbk → podWorkRun
- netGetBenchClip/λtx → podNetRun
- animForget/λw → onSd
- animLoadMarker/λw → onSd
- netGetBlockClipToSd/λtx → podNetRun
- animRemoveFiles → onSd
- animValidateAndMark → onSd
- runResidentAnim → onSd
- onAnimTouch/λw → onSd

### routes serveur atteignables

- /api/ack-frame
- /api/bench/clip?device
- /api/bench/poll?device
- /api/bench/result
- /api/block-clip?hash
- /api/pull-frame?device
- /api/pull?device
- /api/register
