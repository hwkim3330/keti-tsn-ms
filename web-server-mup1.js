#!/usr/bin/env node

/**
 * KETI TSN Management System - Direct MUP1 Implementation
 * No mvdct dependency - direct serial communication with CoAP
 */

import express from 'express';
import cors from 'cors';
import { SerialPort } from 'serialport';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { MUP1Protocol } from './mup1-node.js';
import { CoAPClient } from './coap-node.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Configuration
const DEFAULT_DEVICE = '/dev/ttyACM1';
const BAUD_RATE = 115200;

// Command history
let commandHistory = [];

// MUP1 and CoAP instances
let protocol = null;
let coap = null;
let serial = null;
let isConnected = false;

/**
 * Initialize serial connection
 */
async function initializeSerial() {
    if (serial && serial.isOpen) {
        console.log('✓ Serial port already open');
        return true;
    }

    try {
        console.log(`📡 Opening serial port: ${DEFAULT_DEVICE} @ ${BAUD_RATE} baud`);

        protocol = new MUP1Protocol();

        serial = new SerialPort({
            path: DEFAULT_DEVICE,
            baudRate: BAUD_RATE,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false
        });

        // Open port
        await new Promise((resolve, reject) => {
            serial.open((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        coap = new CoAPClient(protocol, serial);

        // Setup data handler
        serial.on('data', (data) => {
            coap.handleData(data);
        });

        serial.on('error', (err) => {
            console.error('❌ Serial error:', err.message);
            isConnected = false;
        });

        serial.on('close', () => {
            console.log('🔌 Serial port closed');
            isConnected = false;
        });

        isConnected = true;
        console.log('✓ Serial port opened successfully');

        // Send ping
        setTimeout(() => {
            const ping = protocol.createPing();
            serial.write(ping);
            console.log('📤 Ping sent');
        }, 500);

        return true;
    } catch (error) {
        console.error('❌ Failed to open serial port:', error.message);
        isConnected = false;
        return false;
    }
}

/**
 * Ensure serial connection
 */
async function ensureConnection() {
    if (!isConnected || !serial || !serial.isOpen) {
        return await initializeSerial();
    }
    return true;
}

/**
 * Execute CoAP request with retry
 */
async function executeCoAP(method, path, data = null) {
    const startTime = Date.now();

    try {
        if (!await ensureConnection()) {
            throw new Error('Failed to connect to device');
        }

        let result;
        switch (method.toUpperCase()) {
            case 'GET':
                result = await coap.get(path);
                break;
            case 'POST':
                result = await coap.post(path, data);
                break;
            case 'PUT':
                result = await coap.put(path, data);
                break;
            case 'DELETE':
                result = await coap.delete(path);
                break;
            default:
                throw new Error(`Unknown method: ${method}`);
        }

        const executionTime = Date.now() - startTime;

        // Add to history
        commandHistory.push({
            method,
            path,
            data,
            result,
            executionTime,
            timestamp: new Date().toISOString(),
            success: true
        });

        if (commandHistory.length > 100) {
            commandHistory = commandHistory.slice(-100);
        }

        console.log(`[${method}] ${path} → OK (${executionTime}ms)`);

        return {
            success: true,
            data: result,
            executionTime,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        const executionTime = Date.now() - startTime;

        console.error(`[${method}] ${path} → ERROR (${executionTime}ms):`, error.message);

        // Add to history
        commandHistory.push({
            method,
            path,
            data,
            error: error.message,
            executionTime,
            timestamp: new Date().toISOString(),
            success: false
        });

        return {
            success: false,
            error: error.message,
            code: error.code,
            executionTime,
            timestamp: new Date().toISOString()
        };
    }
}

// ============================================
// API Endpoints
// ============================================

/**
 * API: Device status
 */
app.get('/api/status', async (req, res) => {
    try {
        // Simple GET on /c to check connection
        const result = await executeCoAP('GET', '/c');
        res.json({
            connected: result.success,
            device: DEFAULT_DEVICE,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            connected: false,
            error: error.message
        });
    }
});

/**
 * API: YANG GET command
 */
app.post('/api/get', async (req, res) => {
    try {
        const { path } = req.body;
        // CORECONF uses /c endpoint, path goes in CBOR payload (future implementation)
        // For now, just get everything
        const result = await executeCoAP('GET', '/c');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: YANG SET command
 */
app.post('/api/set', async (req, res) => {
    try {
        const { path, value } = req.body;
        const result = await executeCoAP('PUT', path, value);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Direct command execution (compatibility layer)
 */
app.post('/api/execute', async (req, res) => {
    try {
        const { args } = req.body;

        // Parse mvdct-style args: ['device', '/dev/ttyACM0', 'get', '/path', '--console']
        let method = 'GET';
        let path = '/';
        let value = null;

        for (let i = 0; i < args.length; i++) {
            if (args[i] === 'get') {
                method = 'GET';
                path = args[i + 1] || '/';
            } else if (args[i] === 'set') {
                method = 'PUT';
                path = args[i + 1] || '/';
                value = args[i + 2];
            } else if (args[i] === 'delete') {
                method = 'DELETE';
                path = args[i + 1] || '/';
            }
        }

        const result = await executeCoAP(method, path, value);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Bridge configuration
 */
app.get('/api/bridge', async (req, res) => {
    try {
        const result = await executeCoAP('GET', '/ieee802-dot1q-bridge:bridges/bridge');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Interfaces
 */
app.get('/api/interfaces', async (req, res) => {
    try {
        const result = await executeCoAP('GET', '/ietf-interfaces:interfaces');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Scheduler
 */
app.get('/api/scheduler', async (req, res) => {
    try {
        const result = await executeCoAP('GET', '/ieee802-dot1q-sched:interfaces');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: CBS configuration
 */
app.post('/api/cbs/configure', async (req, res) => {
    try {
        const { interface: iface, tc, idleSlope, sendSlope } = req.body;
        const basePath = `/ieee802-dot1q-sched:interfaces/interface[name='${iface || 'eth0'}']/scheduler/traffic-class[index='${tc}']/credit-based-shaper`;

        const results = [];

        if (idleSlope !== undefined) {
            const r1 = await executeCoAP('PUT', `${basePath}/idle-slope`, idleSlope);
            results.push(r1);
        }

        if (sendSlope !== undefined) {
            const r2 = await executeCoAP('PUT', `${basePath}/send-slope`, sendSlope);
            results.push(r2);
        }

        const r3 = await executeCoAP('PUT', `${basePath}/admin-idleslope-enabled`, true);
        results.push(r3);

        res.json({
            success: results.every(r => r.success),
            results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: TAS configuration
 */
app.post('/api/tas/configure', async (req, res) => {
    try {
        const { interface: iface, cycleTime, baseTime, gcl } = req.body;
        const basePath = `/ieee802-dot1q-sched:interfaces/interface[name='${iface || 'eth0'}']/scheduler`;

        const results = [];

        if (baseTime !== undefined) {
            const r1 = await executeCoAP('PUT', `${basePath}/admin-base-time`, baseTime);
            results.push(r1);
        }

        if (cycleTime !== undefined) {
            const r2 = await executeCoAP('PUT', `${basePath}/admin-cycle-time`, cycleTime);
            results.push(r2);
        }

        if (gcl && Array.isArray(gcl)) {
            for (let i = 0; i < gcl.length; i++) {
                const entry = gcl[i];

                const r3 = await executeCoAP('PUT', `${basePath}/admin-control-list[index='${i}']/gate-states-value`, entry.gate);
                results.push(r3);

                const r4 = await executeCoAP('PUT', `${basePath}/admin-control-list[index='${i}']/time-interval-value`, entry.duration);
                results.push(r4);
            }

            const r5 = await executeCoAP('PUT', `${basePath}/admin-control-list-length`, gcl.length);
            results.push(r5);
        }

        const r6 = await executeCoAP('PUT', `${basePath}/gate-enabled`, true);
        results.push(r6);

        res.json({
            success: results.every(r => r.success),
            results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Priority mapping
 */
app.post('/api/priority/configure', async (req, res) => {
    try {
        const { bridge, component, mapping } = req.body;
        const bridgeName = bridge || 'b0';
        const componentName = component || 'c0';
        const basePath = `/ieee802-dot1q-bridge:bridges/bridge[name='${bridgeName}']/component[name='${componentName}']/traffic-class-table`;

        const results = [];

        for (const [pcp, priority] of Object.entries(mapping)) {
            const result = await executeCoAP('PUT', `${basePath}/traffic-class-map[priority-code-point='${pcp}']/priority`, priority);
            results.push(result);
        }

        res.json({
            success: results.every(r => r.success),
            results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * API: Command history
 */
app.get('/api/history', (req, res) => {
    res.json(commandHistory);
});

/**
 * API: Clear history
 */
app.delete('/api/history', (req, res) => {
    commandHistory = [];
    res.json({ success: true });
});

/**
 * API: Performance stats
 */
app.get('/api/stats/performance', (req, res) => {
    const totalRequests = commandHistory.length;
    const successfulRequests = commandHistory.filter(h => h.success).length;
    const avgExecutionTime = commandHistory
        .filter(h => h.executionTime)
        .reduce((sum, h, _, arr) => sum + h.executionTime / arr.length, 0);

    res.json({
        success: true,
        stats: {
            totalRequests,
            successfulRequests,
            failedRequests: totalRequests - successfulRequests,
            successRate: totalRequests > 0 ? ((successfulRequests / totalRequests) * 100).toFixed(2) + '%' : '0%',
            avgExecutionTime: avgExecutionTime ? Math.round(avgExecutionTime) + 'ms' : 'N/A',
            connected: isConnected
        }
    });
});

/**
 * API: Traffic class stats
 */
app.get('/api/stats/traffic-class/:port', async (req, res) => {
    try {
        const { port } = req.params;
        const result = await executeCoAP('GET', `/ietf-interfaces:interfaces/interface[name='${port}']/mchp-velocitysp-port:eth-port/statistics/traffic-class`);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Main page
 */
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  KETI TSN Management System (Direct MUP1)           ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📡 Device: ${DEFAULT_DEVICE}`);
    console.log(`🔧 Protocol: MUP1 + CoAP (Direct Serial)`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://<your-ip>:${PORT}`);
    console.log('');

    // Initialize serial connection
    await initializeSerial();

    console.log('');
    console.log('Press Ctrl+C to stop the server');
    console.log('─────────────────────────────────────────────────────');
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    if (serial && serial.isOpen) {
        serial.close();
    }
    process.exit(0);
});
