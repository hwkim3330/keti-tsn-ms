# KETI TSN Management System

A professional web-based management interface for Microchip VelocityDRIVE platforms (LAN9662, LAN9668, etc.), developed for Korea Electronics Technology Institute (KETI).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![Platform](https://img.shields.io/badge/platform-linux-lightgrey.svg)

## Overview

KETI TSN Management System provides an intuitive web interface for configuring and monitoring Time-Sensitive Networking (TSN) features on Microchip VelocityDRIVE platforms. Built with Node.js and modern web technologies, it wraps the `mvdct` CLI tool with a user-friendly interface inspired by professional router management systems.

### Key Features

- 🌐 **Web-Based Interface** - Access from any modern browser
- 🔧 **TSN Configuration** - Configure CBS, TAS, and Priority Mapping
- 📊 **Real-Time Monitoring** - Live device status and statistics
- 🗂️ **Dynamic YANG Browser** - Expandable tree navigation with lazy loading
- 🔌 **Network Visualization** - Visual representation of network interfaces
- 🚀 **Easy Launch** - Double-click execution support
- 🌲 **Lazy Tree Loading** - Efficient navigation of large YANG models

## Architecture

### Technology Stack

- **Backend**: Node.js (v18+) with Express.js
- **Frontend**: Vanilla JavaScript with Font Awesome icons
- **Protocol**: MUP1 (Microchip UART Protocol #1)
- **Data Format**: YANG models, JSON, YAML
- **Serial Communication**: `/dev/ttyACM0` at 115200 baud

### System Components

```
┌─────────────────────────────────────────┐
│         Web Browser (Client)            │
│    http://localhost:8080                │
└──────────────┬──────────────────────────┘
               │ HTTP/REST API
┌──────────────▼──────────────────────────┐
│      Node.js Express Server             │
│         (web-server.js)                 │
└──────────────┬──────────────────────────┘
               │ Child Process
┌──────────────▼──────────────────────────┐
│         mvdct CLI Tool                  │
│    (Microchip VelocityDRIVE CT)        │
└──────────────┬──────────────────────────┘
               │ Serial (MUP1)
┌──────────────▼──────────────────────────┐
│      LAN9662 Switch Board               │
│         /dev/ttyACM0                    │
└─────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Linux system (Ubuntu 20.04+ recommended)
- Node.js 18.0.0 or higher
- npm package manager
- LAN9662 board connected via USB serial

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/hwkim3330/keti-tsn-ms.git
   cd keti-tsn-ms
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Make scripts executable**
   ```bash
   chmod +x start-keti-tsn.sh
   chmod +x mvdct
   ```

4. **Verify device connection**
   ```bash
   ls -la /dev/ttyACM0
   ```

## Usage

### Quick Start

**Option 1: Double-click launcher**
- Double-click `start-keti-tsn.sh` or `KETI-TSN.desktop`
- Browser will automatically open to http://localhost:8080

**Option 2: Command line**
```bash
./start-keti-tsn.sh
```

**Option 3: Manual start**
```bash
node web-server.js
```

### Web Interface

Once started, access the interface at **http://localhost:8080**

#### Main Tabs

| Tab | Description | Update Interval |
|-----|-------------|----------------|
| **Overview** | Device status, firmware version, OS version | 5 seconds (auto) |
| **Interfaces** | 24 interface status, MAC, speed, duplex | 15 seconds (auto) |
| **YANG Browser** | Complete YANG tree navigation (136KB) | 30 seconds (auto) |
| **Bridge** | Bridge settings, VLAN, FDB configuration | On demand |
| **CBS** | Credit-Based Shaper (IEEE 802.1Qav) | On demand |
| **TAS** | Time-Aware Shaper (IEEE 802.1Qbv) | On demand |
| **Statistics** | Real-time TC distribution & packet rate | 2 seconds (manual) |
| **Priority** | PCP to Traffic Class mapping | On demand |
| **Terminal** | Direct YANG GET/SET execution | Real-time |

#### Statistics Tab Features

The **Statistics** tab provides real-time network monitoring:

- **Traffic Class Distribution** - Donut chart showing TC0-TC7 packet distribution
- **Packet Rate Over Time** - Line chart displaying RX/TX rate (last 20 data points)
- **Detailed TC Statistics** - Table with packet counts and percentages per TC
- **Real-Time Monitoring** - Manual start/stop with 2-second update interval

Use this to verify CBS/TAS configurations and monitor QoS effectiveness in real-time.

### Backend Architecture

#### mvdct-Based Data Collection

The server uses **pure `mvdct get` commands** without the fetch command for optimal performance:

```bash
# System information
mvdct device /dev/ttyACM0 get /ietf-system:system-state/platform --console

# Interface information
mvdct device /dev/ttyACM0 get /ietf-interfaces:interfaces --console

# Bridge configuration
mvdct device /dev/ttyACM0 get /ieee802-dot1q-bridge:bridges --console

# Complete YANG tree
mvdct device /dev/ttyACM0 get / --console -lf board-data/full-yang.log.json
```

#### Automated Data Collection

1. **Basic Data** - Collected every 15 seconds
   - System platform info
   - Interface states
   - Bridge configuration

2. **Full YANG Tree** - Collected every 30 seconds
   - Complete YANG data structure
   - Pure YANG only (CoAP logs removed)
   - 136,422 bytes

3. **Static Information** - Cached at server startup
   - Firmware version
   - Device type
   - Queried only once

#### Performance Optimizations

- **67% Query Reduction** - Using 3 targeted GET commands instead of fetch
- **Pure YANG Data** - 145KB → 136KB (log removal)
- **Smart Caching** - Prevents redundant queries with 2-second TTL
- **Request Queue** - Serializes CLI executions to prevent serial port conflicts

### API Endpoints

The server exposes REST API endpoints for programmatic access:

#### Device Management
- `GET /api/status` - Get device connection status
- `GET /api/bridge` - Query bridge configuration
- `GET /api/interfaces` - List network interfaces
- `GET /api/scheduler` - Get scheduler configuration

#### Configuration
- `POST /api/get` - Execute YANG GET operation
  ```json
  { "path": "/ietf-system:system-state/platform" }
  ```

- `POST /api/set` - Execute YANG SET operation
  ```json
  { "path": "/path/to/node", "value": "new-value" }
  ```

- `POST /api/execute` - Execute custom mvdct command
  ```json
  { "args": ["device", "/dev/ttyACM0", "get", "/path"] }
  ```

#### TSN Features
- `POST /api/cbs/configure` - Configure Credit-Based Shaper
  ```json
  {
    "interface": "eth0",
    "tc": 6,
    "idleSlope": 3500,
    "sendSlope": -6500
  }
  ```

- `POST /api/tas/configure` - Configure Time-Aware Shaper
  ```json
  {
    "interface": "eth0",
    "cycleTime": 200000,
    "baseTime": 0,
    "gcl": [
      { "gate": 255, "duration": 50000 },
      { "gate": 254, "duration": 30000 }
    ]
  }
  ```

- `POST /api/priority/configure` - Configure PCP mapping
  ```json
  {
    "bridge": "b0",
    "component": "c0",
    "mapping": {
      "0": 6, "1": 6, "2": 6, "3": 6,
      "4": 2, "5": 2, "6": 2, "7": 2
    }
  }
  ```

#### Statistics
- `GET /api/stats/traffic-class/:port` - Get traffic class statistics
  ```json
  {
    "port": "eth0",
    "timestamp": 1609459200000,
    "tc": {
      "tc0": {"packets": 12345, "bytes": 987654},
      "tc1": {"packets": 23456, "bytes": 1876543},
      "tc7": {"packets": 45678, "bytes": 3654321}
    },
    "rxRate": 1234,
    "txRate": 5678
  }
  ```
- `GET /api/history` - Command execution history
- `DELETE /api/history` - Clear history

#### YANG Catalog
- `GET /api/yang/catalog` - List available YANG modules
- `GET /api/yang/module/:filename` - Get YANG module content
- `POST /api/yang/explore` - Explore YANG path

## Configuration

### Default Settings

Edit `web-server.js` to customize:

```javascript
const PORT = 8080;                    // Web server port
const DEFAULT_DEVICE = '/dev/ttyACM0'; // Serial device
const MVDCT_PATH = './mvdct';         // Path to mvdct binary
const YANG_CATALOG_PATH = './wwwroot/downloads/coreconf/...';
```

### Environment Variables

```bash
export MVDCT_DEVICE=/dev/ttyACM0
export MVDCT_PORT=8080
```

## TSN Testing Scenarios

### CBS (Credit-Based Shaper) Test

**IEEE 802.1Qav** - Configure bandwidth guarantee for AVB traffic

#### Web Interface Method:
1. Navigate to **CBS** tab
2. Enter Interface/Port number (e.g., `1`)
3. Select Traffic Class (TC0-TC7)
4. Choose Shaper Mode: **CBS** (Credit-Based)
5. Set Idle Slope (0 - 1,000,000 kbps)
   - Presets: 25M, 75M, 100M, 250M, 500Mbps
6. Click **Configure Shaper**

#### Example Configuration:
```
High Priority AVB (TC7):
- Interface: 1
- TC: 7
- Mode: CBS
- Idle Slope: 250,000 kbps (250 Mbps)

Standard CBS (TC3):
- Interface: 1
- TC: 3
- Mode: CBS
- Idle Slope: 100,000 kbps (100 Mbps)
```

#### API Method:
```bash
# PCP 0-3 → Priority 6 (3.5 Mbps)
# PCP 4-7 → Priority 2 (1.5 Mbps)

curl -X POST http://localhost:8080/api/priority/configure \
  -H "Content-Type: application/json" \
  -d '{
    "mapping": {
      "0": 6, "1": 6, "2": 6, "3": 6,
      "4": 2, "5": 2, "6": 2, "7": 2
    }
  }'

curl -X POST http://localhost:8080/api/cbs/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "eth0",
    "tc": 6,
    "idleSlope": 3500
  }'
```

### TAS (Time-Aware Shaper) Test

**IEEE 802.1Qbv** - Configure deterministic time-based gate control

#### Web Interface Method:
1. Navigate to **TAS** tab
2. Enter Interface number
3. Set Cycle Time (ns): e.g., `200000000` (200ms)
4. Set Base Time (ns): `0` (auto = current time + 1s)
5. Configure Gate Control List (GCL):
   - Duration (ns): Time slot length
   - Gate (hex): Gate mask (0x01 = TC0, 0x02 = TC1, 0x80 = TC7)
6. Click **Configure TAS**

#### Example 8-Queue Configuration (200ms cycle):
```
TC0: 50ms, Gate: 0x01
TC1: 30ms, Gate: 0x02
TC2: 20ms, Gate: 0x04
TC3: 20ms, Gate: 0x08
TC4: 20ms, Gate: 0x10
TC5: 20ms, Gate: 0x20
TC6: 20ms, Gate: 0x40
TC7: 20ms, Gate: 0x80
```

#### API Method:
```bash
curl -X POST http://localhost:8080/api/tas/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "eth0",
    "cycleTime": 200000000,
    "baseTime": 0,
    "gcl": [
      {"gate": "0x01", "duration": 50000000},
      {"gate": "0x02", "duration": 30000000},
      {"gate": "0x04", "duration": 20000000},
      {"gate": "0x08", "duration": 20000000},
      {"gate": "0x10", "duration": 20000000},
      {"gate": "0x20", "duration": 20000000},
      {"gate": "0x40", "duration": 20000000},
      {"gate": "0x80", "duration": 20000000}
    ]
  }'
```

### Verification with Statistics Tab

After configuring CBS or TAS:
1. Navigate to **Statistics** tab
2. Select the configured interface
3. Click **Start Real-Time Monitoring**
4. Observe:
   - Traffic Class Distribution (donut chart)
   - RX/TX Packet Rate (line chart)
   - Per-TC packet counts and percentages

This allows real-time verification of QoS effects.

## Development

### Project Structure

```
keti-tsn-ms/
├── web-server.js           # Express backend server
├── index.html              # Main web interface
├── package.json            # Node.js dependencies
├── package-lock.json       # Dependency lock file
├── start-server.sh         # Server launcher script
├── mvdct                   # Microchip CLI tool binary
├── board-data/             # Data storage directory
│   ├── system-platform.json
│   ├── interfaces.json
│   ├── bridge.json
│   └── full-yang.log.json
├── USAGE.md                # Detailed usage guide (Korean)
└── README.md               # This file
```

### Adding New Features

1. **Add API Endpoint** (web-server.js)
   ```javascript
   app.post('/api/my-feature', async (req, res) => {
       const result = await executeMvdct(['args']);
       res.json(result);
   });
   ```

2. **Add UI Component** (index.html)
   ```javascript
   async function myFeature() {
       const response = await fetch('/api/my-feature', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(data)
       });
       const result = await response.json();
   }
   ```

### Debugging

Enable verbose logging:
```javascript
// In web-server.js
console.log('Debug:', data);
```

Monitor serial communication:
```bash
tail -f last_log.mvdct.json
```

Check command history:
```bash
curl http://localhost:8080/api/history
```

## Troubleshooting

### Device Not Found

```
⚠️ 경고: LAN9662 디바이스가 연결되지 않았습니다!
```

**Solution:**
- Check USB connection
- Verify device: `ls -la /dev/ttyACM*`
- Check permissions: `sudo usermod -a -G dialout $USER`
- Re-login or reboot

### Port Already in Use

```
Error: listen EADDRINUSE: address already in use :::8080
```

**Solution:**
```bash
# Find process using port 8080
sudo fuser -k 8080/tcp

# Or use different port
export MVDCT_PORT=8081
```

### npm Dependencies Fail

```
npm ERR! code ELIFECYCLE
```

**Solution:**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Permission Denied on Scripts

```
bash: ./start-keti-tsn.sh: Permission denied
```

**Solution:**
```bash
chmod +x start-keti-tsn.sh
chmod +x mvdct
```

## Performance Notes

### Optimization Features
- **Request Queue**: Serializes CLI executions to prevent simultaneous serial port access conflicts
- **Result Caching**: GET requests are cached for 2 seconds to reduce hardware queries
- **Execution Logging**: All commands logged with execution time for performance monitoring
- **Improved Timeout**: Extended to 15 seconds with graceful SIGTERM/SIGKILL handling

### Performance Statistics
- Command timeout: 15 seconds (graceful)
- History limit: 100 commands
- Cache size limit: 100 entries
- Cache TTL: 2 seconds
- Concurrent connections: Unlimited (queued internally)
- CORS: Enabled for all origins
- Average execution time: ~900ms per CLI call

### Monitoring
- `GET /api/stats/performance` - View cache hit rate, queue length, and average execution time
- `DELETE /api/cache` - Clear result cache

## Related Projects

- **Microchip VelocityDRIVE CT** - Official CLI tool
- **TSN Performance Tests** - Comprehensive testing suite
- **KETI VelocityDRIVE UI** - Alternative desktop interface

## Standards Compliance

- **IEEE 802.1Qav** - Credit-Based Shaper (CBS)
- **IEEE 802.1Qbv** - Time-Aware Shaper (TAS)
- **IEEE 802.1Q** - VLAN tagging and PCP
- **RFC 7950** - YANG 1.1 data modeling
- **RFC 7252** - CoAP protocol (planned)

## License

This project is licensed under the MIT License.

## Authors

- **KETI (Korea Electronics Technology Institute)**
- Web interface developed with Claude Code assistance

## Acknowledgments

- Microchip Technology Inc. for VelocityDRIVE platform
- Express.js and Node.js communities
- Font Awesome for icon library

## Support

For issues and questions:
- GitHub Issues: https://github.com/hwkim3330/keti-tsn-ms/issues
- KETI Contact: [Your contact information]

## Changelog

### Version 1.3.0 (2025-09-30)
- **Performance Optimization**: Request queue + result caching system
- **Detailed Interface View**: Comprehensive port statistics, ethernet config, traffic class distribution
- **Execution Monitoring**: Performance stats API with cache hit rate tracking
- **Improved Error Handling**: Graceful timeout with SIGTERM/SIGKILL fallback

### Version 1.2.0 (2025-09-30)
- Complete YANG tree structure with 60+ paths
- Pre-built tree hierarchy for instant navigation
- VLAN configuration and management tab
- Port VLAN ID (PVID) settings
- VLAN registration entry control

### Version 1.1.0 (2025-09-30)
- Dynamic tree generation from device data
- Enhanced bridge configuration with port forwarding control
- Device-agnostic platform support (LAN9662, LAN9668, etc.)

### Version 1.0.0 (2025-09-30)
- Initial release
- Web-based management interface
- TSN configuration support (CBS, TAS, Priority)
- YANG browser functionality
- Real-time device monitoring
- Command history tracking
- Double-click launcher support

---

**Made with ❤️ by KETI TSN Team**
