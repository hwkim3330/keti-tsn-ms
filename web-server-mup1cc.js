#!/usr/bin/env node

/**
 * KETI TSN Management System - Using Official mup1cc
 * Uses Docker-based mup1cc from velocitydrivesp-support
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as yamlParse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Configuration
const DEFAULT_DEVICE = '/dev/ttyACM1';
const MUP1CC_DIR = join(process.env.HOME, 'velocitydrivesp-support');
const DR_CMD = join(MUP1CC_DIR, 'dr');

// Command history
let commandHistory = [];
let isConnected = false;

/**
 * Execute mup1cc command
 */
async function executeMup1cc(method, path = null, data = null) {
    const startTime = Date.now();

    try {
        const args = [
            'mup1cc',
            '-d', DEFAULT_DEVICE,
            '-m', method.toLowerCase()
        ];

        // Add query parameters based on method
        if (method.toUpperCase() === 'GET') {
            args.push('-q', 'd=a'); // Get all data
        }

        const options = {
            cwd: MUP1CC_DIR,
            env: { ...process.env }
        };

        console.log(`[mup1cc] ${args.join(' ')}`);

        const proc = spawn(DR_CMD, args, options);

        let stdout = '';
        let stderr = '';

        // Send data if provided
        if (data && ['put', 'post', 'ipatch'].includes(method.toLowerCase())) {
            const input = JSON.stringify(data);
            proc.stdin.write(input);
            proc.stdin.end();
        }

        proc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const result = await new Promise((resolve, reject) => {
            proc.on('close', (code) => {
                const executionTime = Date.now() - startTime;

                if (code === 0) {
                    try {
                        // Parse YAML output
                        const parsed = yamlParse(stdout);

                        commandHistory.push({
                            method,
                            path,
                            data,
                            result: parsed,
                            executionTime,
                            timestamp: new Date().toISOString(),
                            success: true
                        });

                        if (commandHistory.length > 100) {
                            commandHistory = commandHistory.slice(-100);
                        }

                        console.log(`[${method}] ${path || '/'} → OK (${executionTime}ms)`);

                        resolve({
                            success: true,
                            data: parsed,
                            stdout,
                            executionTime,
                            timestamp: new Date().toISOString()
                        });
                    } catch (parseError) {
                        // If not YAML, return raw stdout
                        resolve({
                            success: true,
                            data: stdout,
                            stdout,
                            executionTime,
                            timestamp: new Date().toISOString()
                        });
                    }
                } else {
                    const error = stderr || stdout || `Exit code: ${code}`;
                    console.error(`[${method}] ${path || '/'} → ERROR (${executionTime}ms): ${error}`);

                    commandHistory.push({
                        method,
                        path,
                        data,
                        error,
                        executionTime,
                        timestamp: new Date().toISOString(),
                        success: false
                    });

                    reject({
                        success: false,
                        error,
                        code,
                        executionTime,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            proc.on('error', (error) => {
                const executionTime = Date.now() - startTime;
                console.error(`[${method}] ${path || '/'} → ERROR (${executionTime}ms): ${error.message}`);

                reject({
                    success: false,
                    error: error.message,
                    executionTime,
                    timestamp: new Date().toISOString()
                });
            });

            // 30 second timeout
            setTimeout(() => {
                proc.kill();
                reject({
                    success: false,
                    error: 'Request timeout (30s)',
                    executionTime: Date.now() - startTime,
                    timestamp: new Date().toISOString()
                });
            }, 30000);
        });

        isConnected = true;
        return result;
    } catch (error) {
        isConnected = false;
        return error;
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
        const result = await executeMup1cc('GET');
        res.json({
            connected: result.success,
            device: DEFAULT_DEVICE,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            connected: false,
            error: error.message || error.error
        });
    }
});

/**
 * API: YANG GET command
 */
app.post('/api/get', async (req, res) => {
    try {
        const { path } = req.body;
        const result = await executeMup1cc('GET', path);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || error.error });
    }
});

/**
 * API: YANG SET command (using iPatch)
 */
app.post('/api/set', async (req, res) => {
    try {
        const { path, value } = req.body;
        const result = await executeMup1cc('ipatch', path, { [path]: value });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || error.error });
    }
});

/**
 * API: Direct command execution (compatibility layer)
 */
app.post('/api/execute', async (req, res) => {
    try {
        const { args } = req.body;

        // Parse mvdct-style args
        let method = 'GET';
        let path = '/';
        let value = null;

        for (let i = 0; i < args.length; i++) {
            if (args[i] === 'get') {
                method = 'GET';
                path = args[i + 1] || '/';
            } else if (args[i] === 'set') {
                method = 'ipatch';
                path = args[i + 1] || '/';
                value = args[i + 2];
            } else if (args[i] === 'delete') {
                method = 'delete';
                path = args[i + 1] || '/';
            }
        }

        const result = await executeMup1cc(method, path, value ? { [path]: value } : null);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || error.error });
    }
});

/**
 * API: Bridge configuration
 */
app.get('/api/bridge', async (req, res) => {
    try {
        const result = await executeMup1cc('GET');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || error.error });
    }
});

/**
 * API: Interfaces
 */
app.get('/api/interfaces', async (req, res) => {
    try {
        const result = await executeMup1cc('GET');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || error.error });
    }
});

/**
 * API: Scheduler
 */
app.get('/api/scheduler', async (req, res) => {
    try {
        const result = await executeMup1cc('GET');
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message || error.error });
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
 * Main page
 */
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  KETI TSN Management System (mup1cc)                 ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📡 Device: ${DEFAULT_DEVICE}`);
    console.log(`🔧 Tool: mup1cc (via Docker)`);
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://<your-ip>:${PORT}`);
    console.log('');
    console.log('Press Ctrl+C to stop the server');
    console.log('─────────────────────────────────────────────────────');
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down...');
    process.exit(0);
});
