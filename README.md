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

1. **Overview** - Device status and system information
2. **YANG Browser** - Navigate YANG model hierarchy
3. **Interfaces** - Network interface configuration and status
4. **CBS Config** - Credit-Based Shaper settings
5. **TAS Config** - Time-Aware Shaper gate control
6. **Priority** - PCP to Traffic Class mapping
7. **Terminal** - Direct command execution

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

Configure bandwidth guarantee for AVB traffic:

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

Configure deterministic time slots:

```bash
curl -X POST http://localhost:8080/api/tas/configure \
  -H "Content-Type: application/json" \
  -d '{
    "interface": "eth0",
    "cycleTime": 200000,
    "gcl": [
      {"gate": 255, "duration": 50000},
      {"gate": 254, "duration": 30000},
      {"gate": 252, "duration": 20000}
    ]
  }'
```

## Development

### Project Structure

```
keti-tsn-ms/
├── web-server.js           # Express backend server
├── index.html              # Main web interface
├── package.json            # Node.js dependencies
├── start-keti-tsn.sh       # Launcher script
├── KETI-TSN.desktop        # Desktop shortcut
├── mvdct                   # Microchip CLI wrapper
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

- Command timeout: 10 seconds
- History limit: 100 commands
- Concurrent connections: Unlimited
- CORS: Enabled for all origins

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
