#!/usr/bin/env node

/**
 * LAN9662 VelocityDRIVE Web Control Server
 * Node.js based web interface for mvdct CLI tool
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// mvdct 실행 경로
const MVDCT_PATH = join(__dirname, 'mvdct');
const DEFAULT_DEVICE = '/dev/ttyACM0';
const YANG_CATALOG_PATH = join(__dirname, 'wwwroot/downloads/coreconf/5151bae07677b1501f9cf52637f2a38f');

// 명령어 히스토리
let commandHistory = [];

// YANG 카탈로그 캐시
let yangCatalog = null;

/**
 * mvdct 명령어 실행
 */
function executeMvdct(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(MVDCT_PATH, args);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            const result = {
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code,
                timestamp: new Date().toISOString()
            };

            commandHistory.push({
                args,
                result,
                timestamp: new Date().toISOString()
            });

            if (commandHistory.length > 100) {
                commandHistory = commandHistory.slice(-100);
            }

            resolve(result);
        });

        proc.on('error', (error) => {
            reject({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        });

        // 10초 타임아웃
        setTimeout(() => {
            proc.kill();
            reject({
                success: false,
                error: 'Command timeout',
                timestamp: new Date().toISOString()
            });
        }, 10000);
    });
}

/**
 * API: 디바이스 상태 확인
 */
app.get('/api/status', async (req, res) => {
    try {
        const result = await executeMvdct(['device', DEFAULT_DEVICE, 'get', '/ietf-system:system-state/platform', '--console']);
        res.json({
            connected: result.success,
            device: DEFAULT_DEVICE,
            ...result
        });
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: YANG GET 명령
 */
app.post('/api/get', async (req, res) => {
    try {
        const { path } = req.body;
        const result = await executeMvdct(['device', DEFAULT_DEVICE, 'get', path, '--console']);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: YANG SET 명령
 */
app.post('/api/set', async (req, res) => {
    try {
        const { path, value } = req.body;
        const result = await executeMvdct(['device', DEFAULT_DEVICE, 'set', path, value, '--console']);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: 직접 명령 실행
 */
app.post('/api/execute', async (req, res) => {
    try {
        const { args } = req.body;
        const result = await executeMvdct(args);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: 브릿지 설정 조회
 */
app.get('/api/bridge', async (req, res) => {
    try {
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            '/ieee802-dot1q-bridge:bridges/bridge',
            '--console'
        ]);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: 인터페이스 설정 조회
 */
app.get('/api/interfaces', async (req, res) => {
    try {
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            '/ietf-interfaces:interfaces',
            '--console'
        ]);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: 스케줄러 설정 조회
 */
app.get('/api/scheduler', async (req, res) => {
    try {
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            '/ieee802-dot1q-sched:interfaces',
            '--console'
        ]);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: CBS 설정
 */
app.post('/api/cbs/configure', async (req, res) => {
    try {
        const { interface: iface, tc, idleSlope, sendSlope } = req.body;

        const basePath = `/ieee802-dot1q-sched:interfaces/interface[name='${iface || 'eth0'}']/scheduler/traffic-class[index='${tc}']/credit-based-shaper`;

        const results = [];

        // idle-slope 설정
        if (idleSlope !== undefined) {
            const r1 = await executeMvdct([
                'device', DEFAULT_DEVICE, 'set',
                `${basePath}/idle-slope`, String(idleSlope),
                '--console'
            ]);
            results.push(r1);
        }

        // send-slope 설정
        if (sendSlope !== undefined) {
            const r2 = await executeMvdct([
                'device', DEFAULT_DEVICE, 'set',
                `${basePath}/send-slope`, String(sendSlope),
                '--console'
            ]);
            results.push(r2);
        }

        // CBS 활성화
        const r3 = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `${basePath}/admin-idleslope-enabled`, 'true',
            '--console'
        ]);
        results.push(r3);

        res.json({
            success: results.every(r => r.success),
            results
        });
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: TAS 설정
 */
app.post('/api/tas/configure', async (req, res) => {
    try {
        const { interface: iface, cycleTime, baseTime, gcl } = req.body;

        const basePath = `/ieee802-dot1q-sched:interfaces/interface[name='${iface || 'eth0'}']/scheduler`;

        const results = [];

        // Base time 설정
        if (baseTime !== undefined) {
            const r1 = await executeMvdct([
                'device', DEFAULT_DEVICE, 'set',
                `${basePath}/admin-base-time`, String(baseTime),
                '--console'
            ]);
            results.push(r1);
        }

        // Cycle time 설정
        if (cycleTime !== undefined) {
            const r2 = await executeMvdct([
                'device', DEFAULT_DEVICE, 'set',
                `${basePath}/admin-cycle-time`, String(cycleTime),
                '--console'
            ]);
            results.push(r2);
        }

        // GCL 엔트리 설정
        if (gcl && Array.isArray(gcl)) {
            for (let i = 0; i < gcl.length; i++) {
                const entry = gcl[i];

                // Gate states
                const r3 = await executeMvdct([
                    'device', DEFAULT_DEVICE, 'set',
                    `${basePath}/admin-control-list[index='${i}']/gate-states-value`,
                    String(entry.gate),
                    '--console'
                ]);
                results.push(r3);

                // Time interval
                const r4 = await executeMvdct([
                    'device', DEFAULT_DEVICE, 'set',
                    `${basePath}/admin-control-list[index='${i}']/time-interval-value`,
                    String(entry.duration),
                    '--console'
                ]);
                results.push(r4);
            }

            // GCL length 설정
            const r5 = await executeMvdct([
                'device', DEFAULT_DEVICE, 'set',
                `${basePath}/admin-control-list-length`,
                String(gcl.length),
                '--console'
            ]);
            results.push(r5);
        }

        // TAS 활성화
        const r6 = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `${basePath}/gate-enabled`, 'true',
            '--console'
        ]);
        results.push(r6);

        res.json({
            success: results.every(r => r.success),
            results
        });
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: Priority 매핑 설정
 */
app.post('/api/priority/configure', async (req, res) => {
    try {
        const { bridge, component, mapping } = req.body;

        const bridgeName = bridge || 'b0';
        const componentName = component || 'c0';
        const basePath = `/ieee802-dot1q-bridge:bridges/bridge[name='${bridgeName}']/component[name='${componentName}']/traffic-class-table`;

        const results = [];

        for (const [pcp, priority] of Object.entries(mapping)) {
            const result = await executeMvdct([
                'device', DEFAULT_DEVICE, 'set',
                `${basePath}/traffic-class-map[priority-code-point='${pcp}']/priority`,
                String(priority),
                '--console'
            ]);
            results.push(result);
        }

        res.json({
            success: results.every(r => r.success),
            results
        });
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: 명령어 히스토리
 */
app.get('/api/history', (req, res) => {
    res.json(commandHistory);
});

/**
 * API: 히스토리 초기화
 */
app.delete('/api/history', (req, res) => {
    commandHistory = [];
    res.json({ success: true });
});

/**
 * API: YANG 카탈로그 트리 조회
 */
app.get('/api/yang/catalog', (req, res) => {
    try {
        if (!existsSync(YANG_CATALOG_PATH)) {
            return res.status(404).json({ error: 'YANG catalog not found' });
        }

        const yangFiles = readdirSync(YANG_CATALOG_PATH)
            .filter(file => file.endsWith('.yang'))
            .sort();

        const modules = yangFiles.map(file => ({
            name: file.replace('.yang', ''),
            file: file,
            path: `/yang/module/${file}`
        }));

        res.json({ modules });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * API: YANG 모듈 파일 조회
 */
app.get('/api/yang/module/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = join(YANG_CATALOG_PATH, filename);

        if (!existsSync(filepath)) {
            return res.status(404).json({ error: 'Module not found', path: filepath });
        }

        const content = readFileSync(filepath, 'utf-8');
        res.type('text/plain').send(content);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * API: YANG 경로 탐색 (mvdct를 이용한 실시간 조회)
 */
app.post('/api/yang/explore', async (req, res) => {
    try {
        const { path } = req.body;
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            path || '/',
            '--console'
        ]);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: YANG 루트 경로들 목록 조회
 */
app.get('/api/yang/roots', async (req, res) => {
    try {
        // Get root paths by querying common YANG modules
        const rootPaths = [
            '/ietf-interfaces:interfaces',
            '/ieee802-dot1q-bridge:bridges',
            '/ieee802-dot1q-sched:interfaces',
            '/ietf-system:system',
            '/ietf-system:system-state'
        ];

        const results = [];
        for (const path of rootPaths) {
            try {
                const result = await executeMvdct([
                    'device', DEFAULT_DEVICE, 'get',
                    path,
                    '--console'
                ]);
                if (result.success) {
                    results.push({ path, available: true });
                } else {
                    results.push({ path, available: false });
                }
            } catch (e) {
                results.push({ path, available: false });
            }
        }

        res.json({ success: true, roots: results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * API: CBS 테스트 시나리오 실행
 */
app.post('/api/test/cbs', async (req, res) => {
    try {
        const { port, tc, idleSlope, sendSlope, testDuration } = req.body;

        const results = {
            config: [],
            before: null,
            after: null
        };

        // 1. PCP 디코딩 설정
        const pcp1 = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `/ietf-interfaces:interfaces/interface[name='${port}']/ieee802-dot1q-bridge:bridge-port/pcp-decoding-table/pcp-decoding-map`,
            'pcp: 8P0D',
            '--console'
        ]);
        results.config.push({ step: 'PCP Decoding', ...pcp1 });

        // 2. CBS 설정
        const basePath = `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers`;

        const cbs = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            basePath,
            `traffic-class: ${tc}\ncredit-based:\n  idle-slope: ${idleSlope}`,
            '--console'
        ]);
        results.config.push({ step: 'CBS Config', ...cbs });

        // 3. 설정 전 통계
        const statsBefore = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-port/statistics/traffic-class`,
            '--console'
        ]);
        results.before = statsBefore;

        // 4. 대기 (테스트 트래픽 생성 시간)
        if (testDuration && testDuration > 0) {
            await new Promise(resolve => setTimeout(resolve, testDuration * 1000));
        }

        // 5. 설정 후 통계
        const statsAfter = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-port/statistics/traffic-class`,
            '--console'
        ]);
        results.after = statsAfter;

        res.json({
            success: true,
            results
        });
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * API: 트래픽 클래스 통계 조회
 */
app.get('/api/stats/traffic-class/:port', async (req, res) => {
    try {
        const { port } = req.params;
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-port/statistics/traffic-class`,
            '--console'
        ]);
        res.json(result);
    } catch (error) {
        res.status(500).json(error);
    }
});

/**
 * 메인 페이지 - index.html 제공
 */
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  LAN9662 VelocityDRIVE Web Control Server           ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📡 Device: ${DEFAULT_DEVICE}`);
    console.log(`🔧 mvdct: ${MVDCT_PATH}`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://<your-ip>:${PORT}`);
    console.log('');
    console.log('Press Ctrl+C to stop the server');
    console.log('─────────────────────────────────────────────────────');
});