#!/usr/bin/env node

/**
 * LAN9662 VelocityDRIVE Web Control Server
 * Node.js based web interface for mvdct CLI tool
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
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
const MVDCT_PATH = '/home/kim/Downloads/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12/mvdct';
const DEFAULT_DEVICE = '/dev/ttyACM0';
const YANG_CATALOG_PATH = '/home/kim/Downloads/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12/wwwroot/downloads/coreconf/5151bae07677b1501f9cf52637f2a38f';

// 명령어 히스토리
let commandHistory = [];

// YANG 카탈로그 캐시
let yangCatalog = null;

// ============================================
// Performance Optimization Layer
// ============================================

// Result Cache - 동일한 GET 요청 결과를 캐싱
const resultCache = new Map();
const CACHE_TTL = 2000; // 2초 TTL (하드웨어 상태는 빠르게 변할 수 있음)

// Request Queue - 직렬 포트는 동시 접근 불가능하므로 큐로 순서 보장
const requestQueue = [];
let isProcessing = false;

/**
 * Request Queue 처리기
 */
async function processQueue() {
    if (isProcessing || requestQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const { args, resolve, reject } = requestQueue.shift();

    try {
        const result = await executeMvdctRaw(args);
        resolve(result);
    } catch (error) {
        reject(error);
    } finally {
        isProcessing = false;
        // 다음 요청 처리
        if (requestQueue.length > 0) {
            setImmediate(processQueue);
        }
    }
}

/**
 * Queued mvdct 실행 (캐싱 + 큐잉)
 */
function executeMvdct(args) {
    // Cache key 생성 (GET 요청만 캐싱)
    const isGetCommand = args.includes('get') && !args.includes('set');
    const cacheKey = isGetCommand ? JSON.stringify(args) : null;

    // 캐시 확인
    if (cacheKey && resultCache.has(cacheKey)) {
        const cached = resultCache.get(cacheKey);
        const age = Date.now() - cached.timestamp;
        if (age < CACHE_TTL) {
            console.log(`[CACHE HIT] ${cacheKey.substring(0, 80)}... (age: ${age}ms)`);
            return Promise.resolve({
                ...cached.result,
                cached: true,
                cacheAge: age
            });
        } else {
            // TTL 만료
            resultCache.delete(cacheKey);
        }
    }

    // 큐에 추가
    return new Promise((resolve, reject) => {
        requestQueue.push({ args, resolve, reject, cacheKey });
        processQueue();
    });
}

/**
 * 실제 mvdct 명령어 실행 (Raw, 캐싱 없음)
 */
function executeMvdctRaw(args) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const proc = spawn(MVDCT_PATH, args, {
            cwd: '/home/kim/Downloads/Microchip_VelocityDRIVE_CT-CLI-linux-2025.07.12'
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            const executionTime = Date.now() - startTime;
            const result = {
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                code,
                executionTime, // 실행 시간 추가
                timestamp: new Date().toISOString()
            };

            // 히스토리 저장
            commandHistory.push({
                args,
                result,
                timestamp: new Date().toISOString()
            });

            if (commandHistory.length > 100) {
                commandHistory = commandHistory.slice(-100);
            }

            // GET 명령어 결과 캐싱
            const isGetCommand = args.includes('get') && !args.includes('set');
            if (isGetCommand && result.success) {
                const cacheKey = JSON.stringify(args);
                resultCache.set(cacheKey, {
                    result,
                    timestamp: Date.now()
                });

                // 캐시 크기 제한 (최대 100개)
                if (resultCache.size > 100) {
                    const firstKey = resultCache.keys().next().value;
                    resultCache.delete(firstKey);
                }
            }

            console.log(`[EXEC] mvdct ${args.join(' ')} → ${code === 0 ? 'OK' : 'FAIL'} (${executionTime}ms)`);
            resolve(result);
        });

        proc.on('error', (error) => {
            const executionTime = Date.now() - startTime;
            console.error(`[ERROR] mvdct ${args.join(' ')} → ${error.message} (${executionTime}ms)`);
            reject({
                success: false,
                error: error.message,
                executionTime,
                timestamp: new Date().toISOString()
            });
        });

        // 15초 타임아웃 (일부 명령어는 오래 걸릴 수 있음)
        const timeoutId = setTimeout(() => {
            proc.kill('SIGTERM');
            // 3초 후에도 종료 안되면 SIGKILL
            setTimeout(() => {
                if (!proc.killed) {
                    proc.kill('SIGKILL');
                }
            }, 3000);

            const executionTime = Date.now() - startTime;
            console.error(`[TIMEOUT] mvdct ${args.join(' ')} (${executionTime}ms)`);
            reject({
                success: false,
                error: 'Command timeout (15s)',
                executionTime,
                timestamp: new Date().toISOString()
            });
        }, 15000);

        // 프로세스 종료 시 타임아웃 해제
        proc.on('close', () => clearTimeout(timeoutId));
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
 * API: CBS 설정 (Credit-Based Shaper)
 * 새로운 YANG 경로 사용: mchp-velocitysp-port
 */
app.post('/api/cbs/configure', async (req, res) => {
    try {
        const { interface: iface, trafficClass, idleSlope } = req.body;

        if (!iface || trafficClass === undefined || !idleSlope) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: interface, trafficClass, idleSlope'
            });
        }

        const path = `/ietf-interfaces:interfaces/interface[name='${iface}']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers`;

        // CBS 설정 - credit-based shaper with idle-slope
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            path,
            JSON.stringify({
                "traffic-class": trafficClass,
                "credit-based": {
                    "idle-slope": idleSlope
                }
            }),
            '--console'
        ]);

        res.json({
            success: result.success,
            result,
            config: {
                interface: iface,
                trafficClass,
                idleSlope
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: CBS 설정 가져오기
 */
app.get('/api/cbs/config/:interface', async (req, res) => {
    try {
        const iface = req.params.interface;
        const path = `/ietf-interfaces:interfaces/interface[name='${iface}']/mchp-velocitysp-port:eth-qos/config/traffic-class-shapers`;

        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'get',
            path,
            '--console'
        ]);

        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
 * API: PCP Decoding Map 설정 (PCP → Priority 매핑)
 */
app.post('/api/pcp/decoding/configure', async (req, res) => {
    try {
        const { interface: iface, priorityMap } = req.body;

        if (!iface || !priorityMap || !Array.isArray(priorityMap)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: interface, priorityMap (array)'
            });
        }

        const basePath = `/ietf-interfaces:interfaces/interface[name='${iface}']/ieee802-dot1q-bridge:bridge-port/pcp-decoding-table/pcp-decoding-map[pcp='8P0D']`;

        // Create empty priority-map first
        await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `/ietf-interfaces:interfaces/interface[name='${iface}']/ieee802-dot1q-bridge:bridge-port/pcp-decoding-table/pcp-decoding-map`,
            JSON.stringify({ pcp: "8P0D" }),
            '--console'
        ]);

        // Set priority map
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `${basePath}/priority-map`,
            JSON.stringify(priorityMap),
            '--console'
        ]);

        res.json({
            success: result.success,
            result,
            config: { interface: iface, priorityMap }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: PCP Encoding Map 설정 (Priority → PCP 매핑)
 */
app.post('/api/pcp/encoding/configure', async (req, res) => {
    try {
        const { interface: iface, priorityMap } = req.body;

        if (!iface || !priorityMap || !Array.isArray(priorityMap)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: interface, priorityMap (array)'
            });
        }

        const basePath = `/ietf-interfaces:interfaces/interface[name='${iface}']/ieee802-dot1q-bridge:bridge-port/pcp-encoding-table/pcp-encoding-map[pcp='8P0D']`;

        // Create empty priority-map first
        await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `/ietf-interfaces:interfaces/interface[name='${iface}']/ieee802-dot1q-bridge:bridge-port/pcp-encoding-table/pcp-encoding-map`,
            JSON.stringify({ pcp: "8P0D" }),
            '--console'
        ]);

        // Set priority map
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `${basePath}/priority-map`,
            JSON.stringify(priorityMap),
            '--console'
        ]);

        res.json({
            success: result.success,
            result,
            config: { interface: iface, priorityMap }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Default Priority 설정
 */
app.post('/api/port/default-priority', async (req, res) => {
    try {
        const { interface: iface, priority } = req.body;

        if (!iface || priority === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters: interface, priority'
            });
        }

        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'set',
            `/ietf-interfaces:interfaces/interface[name='${iface}']/ieee802-dot1q-bridge:bridge-port/default-priority`,
            String(priority),
            '--console'
        ]);

        res.json({
            success: result.success,
            result,
            config: { interface: iface, defaultPriority: priority }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: 전체 YANG 데이터 가져오기
 */
app.get('/api/yang/full', async (req, res) => {
    try {
        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'fetch', '/',
            '--console'
        ]);

        res.json({
            success: result.success,
            yangData: result.stdout,
            timestamp: new Date().toISOString(),
            device: DEFAULT_DEVICE
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: 특정 YANG 경로 데이터 가져오기
 */
app.post('/api/yang/fetch', async (req, res) => {
    try {
        const { path } = req.body;

        if (!path) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: path'
            });
        }

        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'fetch', path,
            '--console'
        ]);

        res.json({
            success: result.success,
            path,
            yangData: result.stdout,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: YAML 설정 파일로 일괄 적용 (IPATCH)
 */
app.post('/api/config/apply-yaml', async (req, res) => {
    try {
        const { yamlConfig, configFile } = req.body;

        let configPath;

        if (configFile) {
            // 파일 경로가 제공된 경우
            configPath = join(__dirname, configFile);
        } else if (yamlConfig) {
            // YAML 내용이 제공된 경우, 임시 파일 생성
            const tempFile = join(__dirname, `temp-config-${Date.now()}.yaml`);
            writeFileSync(tempFile, yamlConfig);
            configPath = tempFile;
        } else {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: yamlConfig or configFile'
            });
        }

        const result = await executeMvdct([
            'device', DEFAULT_DEVICE, 'ipatch', configPath,
            '--console'
        ]);

        // 임시 파일 삭제
        if (yamlConfig && existsSync(configPath)) {
            require('fs').unlinkSync(configPath);
        }

        res.json({
            success: result.success,
            result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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
 * API: 성능 통계 및 캐시 상태
 */
app.get('/api/stats/performance', (req, res) => {
    const totalRequests = commandHistory.length;
    const cacheHits = commandHistory.filter(h => h.result && h.result.cached).length;
    const avgExecutionTime = commandHistory
        .filter(h => h.result && h.result.executionTime)
        .reduce((sum, h, _, arr) => sum + h.result.executionTime / arr.length, 0);

    res.json({
        success: true,
        stats: {
            totalRequests,
            cacheHits,
            cacheHitRate: totalRequests > 0 ? ((cacheHits / totalRequests) * 100).toFixed(2) + '%' : '0%',
            cacheSize: resultCache.size,
            queueLength: requestQueue.length,
            isProcessing,
            avgExecutionTime: avgExecutionTime ? Math.round(avgExecutionTime) + 'ms' : 'N/A'
        }
    });
});

/**
 * API: 캐시 초기화
 */
app.delete('/api/cache', (req, res) => {
    const cacheSize = resultCache.size;
    resultCache.clear();
    res.json({
        success: true,
        message: `Cleared ${cacheSize} cached entries`
    });
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

// ============================================
// Periodic Board Info Polling & Storage
// ============================================

const BOARD_DATA_DIR = join(__dirname, 'board-data');
const POLLING_INTERVAL = 5000; // 5초마다 폴링
let latestBoardData = null;

// 저장 디렉토리 생성
if (!existsSync(BOARD_DATA_DIR)) {
    mkdirSync(BOARD_DATA_DIR, { recursive: true });
}

/**
 * 보드 정보 수집
 */
async function collectBoardInfo() {
    try {
        const data = {
            timestamp: new Date().toISOString(),
            system: null,
            interfaces: null,
            bridge: null,
            scheduler: null,
            error: null
        };

        try {
            // 시스템 정보
            const systemResult = await executeMvdct([
                'device', DEFAULT_DEVICE, 'get',
                '/ietf-system:system-state/platform',
                '--console'
            ]);
            data.system = systemResult;
        } catch (err) {
            data.error = { system: err.message };
        }

        try {
            // 인터페이스 정보
            const interfacesResult = await executeMvdct([
                'device', DEFAULT_DEVICE, 'get',
                '/ietf-interfaces:interfaces',
                '--console'
            ]);
            data.interfaces = interfacesResult;
        } catch (err) {
            data.error = { ...data.error, interfaces: err.message };
        }

        try {
            // 브리지 정보
            const bridgeResult = await executeMvdct([
                'device', DEFAULT_DEVICE, 'get',
                '/ieee802-dot1q-bridge:bridges',
                '--console'
            ]);
            data.bridge = bridgeResult;
        } catch (err) {
            data.error = { ...data.error, bridge: err.message };
        }

        latestBoardData = data;

        // 파일로 저장
        const filename = `board-snapshot-${Date.now()}.json`;
        const filepath = join(BOARD_DATA_DIR, filename);
        writeFileSync(filepath, JSON.stringify(data, null, 2));

        // 오래된 파일 정리 (최근 100개만 유지)
        const files = readdirSync(BOARD_DATA_DIR)
            .filter(f => f.startsWith('board-snapshot-'))
            .sort()
            .reverse();

        files.slice(100).forEach(f => {
            try {
                const oldFile = join(BOARD_DATA_DIR, f);
                if (existsSync(oldFile)) {
                    require('fs').unlinkSync(oldFile);
                }
            } catch (err) {
                // 삭제 실패는 무시
            }
        });

        return data;
    } catch (error) {
        console.error('[POLLING ERROR]', error.message);
        return null;
    }
}

/**
 * API: 최신 보드 데이터 조회
 */
app.get('/api/board/latest', (req, res) => {
    if (latestBoardData) {
        res.json(latestBoardData);
    } else {
        res.status(404).json({ error: 'No data available yet' });
    }
});

/**
 * API: 저장된 스냅샷 목록
 */
app.get('/api/board/snapshots', (req, res) => {
    try {
        const files = readdirSync(BOARD_DATA_DIR)
            .filter(f => f.startsWith('board-snapshot-'))
            .sort()
            .reverse()
            .slice(0, 50); // 최근 50개

        res.json({ files, count: files.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * API: 특정 스냅샷 조회
 */
app.get('/api/board/snapshot/:filename', (req, res) => {
    try {
        const filepath = join(BOARD_DATA_DIR, req.params.filename);
        if (existsSync(filepath)) {
            const data = JSON.parse(readFileSync(filepath, 'utf8'));
            res.json(data);
        } else {
            res.status(404).json({ error: 'Snapshot not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  LAN966x VelocityDRIVE Web Control Server           ║');
    console.log('║  Supports: LAN9662, LAN9668, LAN9692                ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📡 Device: ${DEFAULT_DEVICE}`);
    console.log(`🔧 mvdct: ${MVDCT_PATH}`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://<your-ip>:${PORT}`);
    console.log(`📊 Polling: Every ${POLLING_INTERVAL/1000}s`);
    console.log(`💾 Storage: ${BOARD_DATA_DIR}`);
    console.log('');
    console.log('Press Ctrl+C to stop the server');
    console.log('─────────────────────────────────────────────────────');

    // 주기적 폴링 시작
    console.log('[POLLING] Starting periodic board info collection...');

    // 즉시 첫 데이터 수집
    collectBoardInfo().then(() => {
        console.log('[POLLING] Initial data collected');
    });

    // 주기적 폴링 설정
    setInterval(async () => {
        await collectBoardInfo();
        console.log(`[POLLING] Data collected at ${new Date().toLocaleTimeString()}`);
    }, POLLING_INTERVAL);
});