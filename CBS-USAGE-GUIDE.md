# CBS (Credit-Based Shaper) 사용 가이드
## KETI TSN Management System

---

## 🎯 시스템 개요

**KETI TSN Management System**은 Microchip LAN966x 보드의 TSN 기능을 웹 UI로 관리할 수 있는 시스템입니다.

### 지원 기능
- ✅ **CBS (Credit-Based Shaper)** - IEEE 802.1Qav 대역폭 보장
- ✅ **PCP 매핑** - Priority Code Point 디코딩/인코딩
- ✅ **VLAN 설정** - 802.1Q VLAN 관리
- ✅ **실시간 모니터링** - 5초마다 보드 상태 자동 수집
- ✅ **YANG 브라우저** - 전체 설정 구조 탐색

---

## 🚀 빠른 시작

### 1. 서버 시작

```bash
cd /home/kim/keti-tsn-ms
node web-server.js
```

서버가 시작되면:
```
╔══════════════════════════════════════════════════════╗
║  LAN966x VelocityDRIVE Web Control Server           ║
║  Supports: LAN9662, LAN9668, LAN9692                ║
╚══════════════════════════════════════════════════════╝

📡 Device: /dev/ttyACM0
🌐 Server: http://localhost:8080
📊 Polling: Every 5s
💾 Storage: /home/kim/keti-tsn-ms/board-data
```

### 2. 웹 인터페이스 접속

브라우저에서 접속:
**http://localhost:8080**

---

## 📊 CBS 설정 방법

### 웹 UI 사용

1. **브라우저에서 http://localhost:8080 접속**

2. **CBS 탭 선택**
   - 상단 네비게이션에서 "CBS" 클릭

3. **현재 설정 확인**
   - "Refresh" 버튼 클릭
   - 현재 적용된 CBS 설정 확인

4. **CBS 설정**
   - **Interface/Port**: 인터페이스 번호 (예: 8)
   - **Traffic Class (TC)**: 0-7 선택
   - **Shaper Mode**: CBS (Credit-Based) 선택
   - **Idle Slope**: 대역폭 (kbps 단위)
     - 10000 = 10 Mbps
     - 50000 = 50 Mbps
     - 100000 = 100 Mbps

5. **Apply Configuration 클릭**

### 프리셋 사용
편리한 프리셋 제공:
- 25 Mbps (Low Priority AVB)
- 75 Mbps (Medium AVB)
- 100 Mbps (Standard CBS)
- 250 Mbps (High Priority)
- 500 Mbps (Very High)

---

## 🔧 API 사용

### CBS 설정 적용

```bash
curl -X POST http://localhost:8080/api/cbs/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "8",
    "trafficClass": 1,
    "idleSlope": 10000
  }'
```

**파라미터:**
- `interface`: 인터페이스 번호 (예: "8", "9", "10", "11")
- `trafficClass`: 트래픽 클래스 0-7
- `idleSlope`: Idle slope (kbps) - 보장 대역폭

### CBS 설정 조회

```bash
curl http://localhost:8080/api/cbs/config/8
```

**응답 예시:**
```json
{
  "success": true,
  "stdout": "...YAML data...",
  "traffic-class": 1,
  "idle-slope": 10000
}
```

---

## 📝 설정 예시

### 예시 1: 기본 CBS 설정
**시나리오**: Interface 8의 TC1에 10 Mbps 대역폭 보장

```bash
curl -X POST http://localhost:8080/api/cbs/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "8",
    "trafficClass": 1,
    "idleSlope": 10000
  }'
```

### 예시 2: 고대역폭 AVB 스트림
**시나리오**: Interface 9의 TC7에 50 Mbps 보장

```bash
curl -X POST http://localhost:8080/api/cbs/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "9",
    "trafficClass": 7,
    "idleSlope": 50000
  }'
```

### 예시 3: YAML 파일로 일괄 설정

**파일 생성**: `my-tsn-config.yaml`
```yaml
- "/ietf-interfaces:interfaces/interface[name='8']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers":
  - traffic-class: 1
    credit-based:
      idle-slope: 10000

- "/ietf-interfaces:interfaces/interface[name='9']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers":
  - traffic-class: 7
    credit-based:
      idle-slope: 50000
```

**적용:**
```bash
curl -X POST http://localhost:8080/api/config/apply-yaml \
  -H "Content-Type: application/json" \
  -d '{
    "configFile": "my-tsn-config.yaml"
  }'
```

---

## 🛠️ 스크립트 도구

### 1. CBS 설정 스크립트
제공된 `apply-tsn-config.sh` 사용:

```bash
cd /home/kim/keti-tsn-ms
./apply-tsn-config.sh
```

이 스크립트는 `tsn-config.yaml`의 설정을 자동으로 적용합니다.

### 2. 전체 YANG 데이터 가져오기

```bash
cd /home/kim/keti-tsn-ms
./get-full-yang.sh
```

**출력**: `full-yang-data.yaml` - 보드의 전체 설정

---

## 📈 모니터링

### 실시간 데이터 조회

**최신 보드 스냅샷:**
```bash
curl http://localhost:8080/api/board/latest
```

**스냅샷 목록:**
```bash
curl http://localhost:8080/api/board/snapshots
```

**저장된 스냅샷 위치:**
```bash
ls -la /home/kim/keti-tsn-ms/board-data/
```

### Traffic Class 통계

웹 UI에서:
1. CBS 탭 이동
2. "View TC Statistics" 버튼 클릭
3. RX/TX 패킷 수 확인

---

## 🔍 문제 해결

### 보드가 연결되지 않음

**확인:**
```bash
ls -la /dev/ttyACM0
./mvdct list
```

**해결:**
- USB 케이블 재연결
- dialout 그룹 권한 확인:
  ```bash
  sudo usermod -a -G dialout $USER
  # 재로그인 필요
  ```

### CBS 설정 실패

**로그 확인:**
```bash
curl http://localhost:8080/api/history
```

**서버 로그 모니터링:**
서버 콘솔에서 실시간 로그 확인

### 설정이 적용되지 않음

1. **현재 설정 확인:**
   ```bash
   curl http://localhost:8080/api/cbs/config/8
   ```

2. **보드 재시작 필요 여부:**
   일부 설정은 보드 재시작 필요

---

## 📚 추가 API

### PCP 매핑

**Decoding (Ingress):**
```bash
curl -X POST http://localhost:8080/api/pcp/decoding/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "11",
    "priorityMap": [
      {"priority-code-point": 0, "priority": 0, "drop-eligible": false},
      {"priority-code-point": 1, "priority": 1, "drop-eligible": false}
    ]
  }'
```

**Encoding (Egress):**
```bash
curl -X POST http://localhost:8080/api/pcp/encoding/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "8",
    "priorityMap": [
      {"priority": 0, "dei": false, "priority-code-point": 0}
    ]
  }'
```

### Default Priority 설정

```bash
curl -X POST http://localhost:8080/api/port/default-priority \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "8",
    "priority": 4
  }'
```

---

## 🎓 참고 자료

### IEEE 표준
- **IEEE 802.1Qav**: Credit-Based Shaper (CBS)
- **IEEE 802.1Qbv**: Time-Aware Shaper (TAS)
- **IEEE 802.1Q**: VLAN & PCP

### Microchip 문서
- VelocityDRIVE Documentation
- LAN966x Datasheet
- YANG Model Reference

### 시스템 파일
- `/home/kim/keti-tsn-ms/README.md` - 시스템 개요
- `/home/kim/keti-tsn-ms/tsn-config.yaml` - 설정 예시
- `/home/kim/keti-tsn-ms/board-data/` - 스냅샷 저장소

---

## 📞 지원

**문제 발생 시:**
1. 서버 로그 확인
2. `/api/history` 엔드포인트 조회
3. 보드 재연결 시도
4. GitHub Issues 등록

**개발:**
- KETI (Korea Electronics Technology Institute)
- Claude Code assistance

---

## ✅ 체크리스트

CBS 설정 완료 확인:

- [ ] 서버가 정상 실행 중
- [ ] 보드 연결 확인 (/dev/ttyACM0)
- [ ] 웹 UI 접속 가능
- [ ] CBS 설정 적용 성공
- [ ] 현재 설정 조회 성공
- [ ] TC 통계 확인 가능

---

**Made with ❤️ by KETI TSN Team**
**Powered by mvdct & Node.js**
