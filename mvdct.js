#!/usr/bin/env node

/**
 * mvdct-node - Node.js implementation of mvdct CLI tool
 * Usage: ./mvdct.js <device> get <path> [--console]
 */

import { SerialPort } from 'serialport';
import { MUP1Protocol } from './mup1-protocol.js';
import { CoAPClient } from './coap-client.js';
import { decode as cborDecode } from 'cbor-x';
import * as fs from 'fs';
import * as yaml from 'yaml';

class MVDCTClient {
    constructor(devicePath, baudRate = 115200) {
        this.devicePath = devicePath;
        this.baudRate = baudRate;
        this.protocol = new MUP1Protocol();
        this.coap = new CoAPClient();
        this.port = null;
        this.receiveBuffer = Buffer.alloc(0);
    }

    /**
     * Connect to serial device
     */
    async connect() {
        return new Promise((resolve, reject) => {
            this.port = new SerialPort({
                path: this.devicePath,
                baudRate: this.baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none'
            });

            this.port.on('open', () => {
                console.error(`Connected to ${this.devicePath}`);
                resolve();
            });

            this.port.on('error', (err) => {
                reject(new Error(`Serial port error: ${err.message}`));
            });

            this.port.on('data', (data) => {
                this.handleData(data);
            });
        });
    }

    /**
     * Handle incoming serial data
     */
    handleData(data) {
        console.error('RX:', data.toString('hex'));
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);

        // Try to decode complete frames
        while (this.receiveBuffer.length > 0) {
            try {
                // Look for start of frame
                const sofIndex = this.receiveBuffer.indexOf(this.protocol.SOF);
                if (sofIndex === -1) {
                    this.receiveBuffer = Buffer.alloc(0);
                    break;
                }

                // Skip bytes before SOF
                if (sofIndex > 0) {
                    this.receiveBuffer = this.receiveBuffer.slice(sofIndex);
                }

                // Need at least 8 bytes for minimum frame
                if (this.receiveBuffer.length < 8) {
                    break;
                }

                // Find EOF
                const eofIndex = this.receiveBuffer.indexOf(this.protocol.EOF, 2);
                if (eofIndex === -1) {
                    break;
                }

                // Calculate expected frame length (EOF + optional padding + 4-char checksum)
                const checksumStart = this.receiveBuffer[eofIndex + 1] === this.protocol.EOF ? eofIndex + 2 : eofIndex + 1;
                const frameLength = checksumStart + 4;

                if (this.receiveBuffer.length < frameLength) {
                    break;
                }

                // Extract and decode frame
                const frameData = this.receiveBuffer.slice(0, frameLength);
                const decoded = this.protocol.decodeFrame(frameData);

                // Handle CoAP response
                if (decoded.type === 'C') {
                    this.coap.handleResponse(decoded.data);
                }

                // Remove processed frame
                this.receiveBuffer = this.receiveBuffer.slice(frameLength);
            } catch (error) {
                console.error('Frame decode error:', error.message);
                // Skip one byte and try again
                this.receiveBuffer = this.receiveBuffer.slice(1);
            }
        }
    }

    /**
     * Send data to device
     */
    async send(data) {
        console.error('TX:', data.toString('hex'));
        return new Promise((resolve, reject) => {
            this.port.write(data, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Execute GET command
     */
    async get(path) {
        // Build CoAP GET request
        const { buffer, promise } = this.coap.get(path);

        // Wrap in MUP1 frame
        const frame = this.protocol.createCoapFrame(buffer);

        // Send to device
        await this.send(frame);

        // Wait for response
        const response = await promise;

        return response;
    }

    /**
     * Execute POST command
     */
    async post(path, data) {
        const { buffer, promise } = this.coap.post(path, data);
        const frame = this.protocol.createCoapFrame(buffer);
        await this.send(frame);
        return await promise;
    }

    /**
     * Execute PUT command
     */
    async put(path, data) {
        const { buffer, promise } = this.coap.put(path, data);
        const frame = this.protocol.createCoapFrame(buffer);
        await this.send(frame);
        return await promise;
    }

    /**
     * Execute DELETE command
     */
    async delete(path) {
        const { buffer, promise } = this.coap.delete(path);
        const frame = this.protocol.createCoapFrame(buffer);
        await this.send(frame);
        return await promise;
    }

    /**
     * Close connection
     */
    async close() {
        return new Promise((resolve) => {
            if (this.port && this.port.isOpen) {
                this.port.close(() => {
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

/**
 * Convert CBOR to YAML format
 */
function cborToYaml(data) {
    // Convert CBOR data to JavaScript object
    let obj;
    if (typeof data === 'object' && data !== null) {
        obj = data;
    } else {
        obj = { value: data };
    }

    // Convert to YAML
    return yaml.stringify(obj);
}

/**
 * Main CLI function
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        console.error('Usage: mvdct <device> <command> <path> [options]');
        console.error('');
        console.error('Commands:');
        console.error('  get <path>      Get resource at path');
        console.error('  post <path>     Post to resource');
        console.error('  put <path>      Put resource');
        console.error('  delete <path>   Delete resource');
        console.error('');
        console.error('Options:');
        console.error('  --console       Output to console (default: stdout)');
        console.error('');
        console.error('Example:');
        console.error('  ./mvdct.js /dev/ttyACM0 get "/ieee802-dot1q-bridge:bridges/bridge[bridge-name=\'b0\']" --console');
        process.exit(1);
    }

    const device = args[0];
    const command = args[1];
    const path = args[2];
    const useConsole = args.includes('--console');

    const client = new MVDCTClient(device);

    try {
        await client.connect();

        // Wait a bit for device to be ready
        await new Promise(resolve => setTimeout(resolve, 500));

        let result;

        switch (command) {
            case 'get':
                result = await client.get(path);
                break;
            case 'post':
                // TODO: Read data from stdin or file
                result = await client.post(path, {});
                break;
            case 'put':
                // TODO: Read data from stdin or file
                result = await client.put(path, {});
                break;
            case 'delete':
                result = await client.delete(path);
                break;
            default:
                throw new Error(`Unknown command: ${command}`);
        }

        // Output result
        const yamlOutput = cborToYaml(result);
        if (useConsole) {
            console.log(yamlOutput);
        } else {
            process.stdout.write(yamlOutput);
        }

        await client.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        await client.close();
        process.exit(1);
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { MVDCTClient };