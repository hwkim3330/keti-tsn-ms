# KETI TSN Management System - 사용 가이드

## 🚀 빠른 시작

### 1. 서버 시작

```bash
cd /home/kim/keti-tsn-ms
./start-server.sh
```

또는 직접 실행:

```bash
node web-server.js
```

### 2. 웹 인터페이스 접속

브라우저에서 다음 주소로 접속:

- **로컬**: http://localhost:8080
- **네트워크**: http://YOUR_IP:8080

## 📊 주요 기능

### 1. Overview (개요)
- LAN9662 디바이스 정보 실시간 표시
- 펌웨어 버전 및 OS 버전 확인
- 5초마다 자동 갱신

### 2. Interfaces (인터페이스)
- 24개 인터페이스 상태 조회
- MAC 주소, 속도, Duplex 모드 확인
- 인터페이스별 통계 정보

### 3. YANG Browser
- 완전한 YANG 데이터 구조 탐색
- 136KB 순수 YANG 데이터 (로그 제거됨)
- 30초마다 자동 갱신

### 4. Bridge (브리지)
- 브리지 설정 조회
- VLAN 정보
- FDB (Forwarding Database) 설정

### 5. CBS (Credit-Based Shaper) ⭐
**TSN QoS 설정의 핵심 기능**

#### 설정 방법:
1. **Interface/Port**: 인터페이스 번호 입력 (예: 1, 2, 3...)
2. **Traffic Class (TC)**: TC0-TC7 중 선택
3. **Shaper Mode**:
   - **CBS (Credit-Based)**: AVB 트래픽 보장
   - **SLB (Leaky Bucket)**: 표준 토큰 버킷 셰이핑
   - **None**: 비활성화

#### CBS 파라미터:
- **Idle Slope**: 0 - 1,000,000 kbps (0 - 1 Gbps)
  - 크레딧 사용 가능할 때 서비스 속도
  - 프리셋: 25M, 75M, 100M, 250M, 500Mbps

#### 사용 예:
```
예제 1: High Priority AVB (TC7)
- Interface: 1
- TC: 7
- Mode: CBS
- Idle Slope: 250,000 kbps (250 Mbps)

예제 2: Standard CBS (TC3)
- Interface: 1
- TC: 3
- Mode: CBS
- Idle Slope: 100,000 kbps (100 Mbps)
```

#### 주의사항:
- 각 TC는 하나의 셰이퍼 모드만 가질 수 있습니다
- 모드 전환 전 기존 설정을 Clear해야 합니다
- "Clear Shaper" 버튼으로 TC 비활성화

### 6. TAS (Time-Aware Shaper) ⭐
**IEEE 802.1Qbv - 시간 기반 게이트 제어**

#### 설정 방법:
1. **Interface**: 인터페이스 번호
2. **Cycle Time (ns)**: 사이클 시간 (예: 200000000 = 200ms)
3. **Base Time (ns)**: 시작 시간 (0 = 현재 시간 + 1초)
4. **Gate Control List (GCL)**:
   - 각 TC별 타임 슬롯 설정
   - Duration (ns): 지속 시간
   - Gate (hex): 게이트 마스크 (예: 0x01 = TC0 열림)

#### 사용 예:
```
8-Queue TAS 설정 (200ms cycle):
- TC0: 50ms, Gate: 0x01
- TC1: 30ms, Gate: 0x02
- TC2: 20ms, Gate: 0x04
- TC3: 20ms, Gate: 0x08
- TC4: 20ms, Gate: 0x10
- TC5: 20ms, Gate: 0x20
- TC6: 20ms, Gate: 0x40
- TC7: 20ms, Gate: 0x80
```

### 7. Statistics (통계) ⭐ **신규!**
**실시간 네트워크 모니터링 대시보드**

#### 기능:
1. **실시간 모니터링 시작/정지**
   - "Start Real-Time Monitoring" 버튼 클릭
   - 2초 간격 자동 업데이트

2. **Traffic Class Distribution (도넛 차트)**
   - TC0-TC7 트래픽 분포 시각화
   - 각 TC별 패킷 수와 비율 표시

3. **Packet Rate Over Time (라인 차트)**
   - RX/TX 패킷 속도 실시간 그래프
   - 최근 20개 데이터 포인트 표시
   - 초당 패킷 수 (pps) 단위

4. **상세 통계 테이블**
   - TC별 총 패킷 수
   - 퍼센티지 계산
   - 현재 RX/TX 속도

#### 사용 팁:
- 인터페이스 선택 후 모니터링 시작
- CBS/TAS 설정 후 트래픽 분포 확인
- 실시간 패킷 속도로 QoS 효과 검증

### 8. Priority (우선순위)
- PCP (Priority Code Point) 매핑
- TC 우선순위 설정

### 9. Terminal
- YANG GET/SET 직접 실행
- 커스텀 YANG path 조회
- 실시간 콘솔 출력

## 🔧 백엔드 아키텍처

### mvdct 기반 데이터 수집
서버는 **fetch 명령을 사용하지 않고** 순수 `mvdct get` 명령만 사용합니다:

```bash
# 시스템 정보
mvdct device /dev/ttyACM0 get /ietf-system:system-state/platform --console

# 인터페이스 정보
mvdct device /dev/ttyACM0 get /ietf-interfaces:interfaces --console

# 브리지 정보
mvdct device /dev/ttyACM0 get /ieee802-dot1q-bridge:bridges --console

# 전체 YANG 트리
mvdct device /dev/ttyACM0 get / --console -lf board-data/full-yang.log.json
```

### 자동 데이터 수집
1. **기본 데이터**: 15초마다 수집
   - System platform
   - Interfaces
   - Bridge configuration

2. **Full YANG**: 30초마다 수집
   - 완전한 YANG 데이터 구조
   - 순수 YANG만 추출 (CoAP 로그 제거)
   - 136,422 bytes

3. **정적 정보 캐싱**
   - Firmware version
   - Device type
   - 서버 시작시 1회만 조회

### 데이터 최적화
- **67% 쿼리 감소**: fetch 대신 3개의 개별 get 명령
- **순수 YANG**: 145KB → 136KB (로그 제거)
- **캐시 시스템**: 중복 쿼리 방지

## 📡 API 엔드포인트

### 기본 정보
- `GET /api/status` - 서버 상태
- `GET /api/board/latest` - 최신 보드 데이터
- `GET /api/firmware` - 펌웨어 정보
- `GET /api/device-type` - 디바이스 타입

### 설정 조회
- `GET /api/interfaces` - 인터페이스 목록
- `GET /api/bridge` - 브리지 설정
- `GET /api/yang/full` - 전체 YANG 트리
- `GET /api/cbs/config/:interface` - CBS 설정 조회

### TSN 설정
- `POST /api/cbs/configure` - CBS 설정
- `POST /api/tas/configure` - TAS 설정
- `POST /api/priority/configure` - 우선순위 설정

### 통계
- `GET /api/stats/traffic-class/:port` - TC 통계

## 🛠️ 문제 해결

### 서버가 시작되지 않을 때
```bash
# 포트 8080 사용 중인 프로세스 확인
lsof -i :8080

# 기존 node 프로세스 종료
killall -9 node

# 서버 재시작
./start-server.sh
```

### 디바이스 연결 확인
```bash
# 시리얼 포트 확인
ls -la /dev/ttyACM0

# mvdct 직접 테스트
./mvdct device /dev/ttyACM0 get /ietf-system:system-state/platform
```

### 로그 확인
```bash
# 실시간 로그
tail -f /tmp/tsn-keti-server.log

# 최근 로그
tail -50 /tmp/tsn-keti-server.log
```

## 📈 성능 모니터링

### 실시간 통계 활용
1. CBS 설정 전 baseline 측정
2. CBS 적용 후 트래픽 분포 확인
3. TAS 설정으로 시간 기반 제어
4. Statistics 탭에서 실시간 효과 검증

### 데이터 수집 주기
- 기본 데이터: 15초
- Full YANG: 30초
- 실시간 통계: 2초 (수동 시작)

## 🔐 보안 고려사항

- 서버는 로컬호스트에서만 접근 가능하도록 설정 권장
- 네트워크 접근시 방화벽 설정 필요
- mvdct 명령은 시리얼 포트 접근 권한 필요

## 📚 참고 자료

### TSN 표준
- IEEE 802.1Qav (CBS - Credit-Based Shaper)
- IEEE 802.1Qbv (TAS - Time-Aware Shaper)
- IEEE 1588 (PTP - Precision Time Protocol)
- IEEE 802.1CB (FRER - Frame Replication and Elimination)

### LAN966x 문서
- VelocityDRIVE CT-CLI User Guide
- LAN9662 Datasheet
- YANG Model Reference

## 🆘 지원

문제 발생시:
1. 로그 파일 확인: `/tmp/tsn-keti-server.log`
2. 보드 데이터 확인: `board-data/` 디렉토리
3. API 직접 테스트: `curl http://localhost:8080/api/status`

---

**KETI TSN Management System v1.0**
*Powered by LAN966x VelocityDRIVE*
