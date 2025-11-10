# UI 개선 계획 - 실제 스위치 데이터 표시

## 현재 상황
- 서버가 5초마다 실제 스위치에서 데이터 수집 (mvdct fetch, firmware, type 사용)
- `/api/board/latest` 엔드포인트로 캐시된 데이터 제공
- UI가 데이터는 받지만 제대로 파싱하지 못함

## 데이터 구조
```json
{
  "timestamp": "2025-11-10T...",
  "system": { "success": true, "stdout": "YAML 데이터..." },
  "interfaces": { "success": true, "stdout": "YAML 데이터..." },
  "bridge": { "success": true, "stdout": "YAML 데이터..." },
  "firmware": { "success": true, "stdout": "VelocitySP-v2025.03" },
  "deviceType": { "success": true, "stdout": "LAN9692VAO - EV09P11A0 (UNG8420) - auto" }
}
```

## 개선 사항

### 1. Device Info 탭
- ✅ firmware 정보 추가 표시
- ✅ deviceType 정보 추가 표시
- ✅ 실시간 스위치 데이터 표시

### 2. Interfaces 탭
- YAML 파싱해서 인터페이스별 정보 표시
- CBS 설정 정보 표시
- Traffic Class 통계 표시
- 실시간 업데이트

### 3. Bridge 탭
- 브리지 설정 파싱 및 표시
- VLAN 정보 표시
- 포트 설정 표시

### 4. CBS 탭
- 현재 CBS 설정을 스위치에서 직접 조회
- Traffic Class별 설정 표시
- Idle Slope 값 표시

## 구현 방법
각 탭의 load 함수에서 boardData 파싱 로직 개선
