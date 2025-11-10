/**
 * CoAP Client Implementation for Node.js
 * RFC 7252 (CoAP) and RFC 9254 (YANG to CBOR)
 */

import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

export class CoAPClient {
    constructor(protocol, serial) {
        this.protocol = protocol;
        this.serial = serial;
        this.messageId = 1;
        this.pendingRequests = new Map();

        // CoAP methods
        this.METHODS = {
            GET: 1,
            POST: 2,
            PUT: 3,
            DELETE: 4,
            FETCH: 5
        };

        this.RESPONSE_CODES = {
            65: 'Created',     // 2.01
            66: 'Deleted',     // 2.02
            67: 'Valid',       // 2.03
            68: 'Changed',     // 2.04
            69: 'Content',     // 2.05
            128: 'Bad Request', // 4.00
            129: 'Unauthorized', // 4.01
            132: 'Not Found',  // 4.04
            133: 'Method Not Allowed', // 4.05
            160: 'Internal Server Error' // 5.00
        };

        this.receiveBuffer = Buffer.alloc(0);
    }

    /**
     * Send CoAP request
     */
    async request(method, uri, payload = null, timeout = 10000) {
        const mid = this.messageId++;
        if (this.messageId > 0xFFFF) this.messageId = 1;

        const message = this.buildMessage(method, uri, payload, mid);
        const frame = this.protocol.createCoapFrame(message);

        console.log(`[CoAP TX] ${this.methodName(method)} ${uri}`);

        // Store pending request
        const promise = new Promise((resolve, reject) => {
            this.pendingRequests.set(mid, {
                resolve,
                reject,
                meta: { method, uri, payload },
                timeout: setTimeout(() => {
                    if (this.pendingRequests.has(mid)) {
                        this.pendingRequests.delete(mid);
                        reject(new Error(`Request timeout: ${uri}`));
                    }
                }, timeout)
            });
        });

        // Send frame
        this.serial.write(frame);

        return promise;
    }

    /**
     * Build CoAP message
     */
    buildMessage(method, uri, payload, messageId) {
        const header = [];

        // Version (2 bits) | Type (2 bits) | Token Length (4 bits)
        const ver = 1; // CoAP version 1
        const type = 0; // Confirmable
        const tkl = 0; // Token length = 0
        header.push((ver << 6) | (type << 4) | tkl);

        // Code (8 bits)
        header.push(method);

        // Message ID (16 bits)
        header.push((messageId >> 8) & 0xFF);
        header.push(messageId & 0xFF);

        // Options
        const options = this.encodeOptions(uri);
        header.push(...options);

        // Payload marker and payload
        if (payload !== null && payload !== undefined) {
            header.push(0xFF); // Payload marker
            const encoded = cborEncode(payload);
            header.push(...encoded);
        }

        return Buffer.from(header);
    }

    /**
     * Encode CoAP options
     */
    encodeOptions(uri) {
        const options = [];
        const [pathPart, queryPart] = uri.split('?');
        const segments = (pathPart || '').split('/').filter(s => s);

        let prevOption = 0;

        // Uri-Path options (Option 11)
        segments.forEach(segment => {
            const delta = 11 - prevOption;
            const length = segment.length;

            // Simple case: both delta and length < 13
            if (delta < 13 && length < 13) {
                options.push((delta << 4) | length);
            } else {
                // Extended format
                if (delta < 13) {
                    options.push((delta << 4) | (length < 13 ? length : 13));
                } else if (delta < 269) {
                    options.push((13 << 4) | (length < 13 ? length : 13));
                    options.push(delta - 13);
                }

                if (length >= 13 && length < 269) {
                    options.push(length - 13);
                }
            }

            // Add segment bytes
            for (let i = 0; i < segment.length; i++) {
                options.push(segment.charCodeAt(i));
            }

            prevOption = 11;
        });

        // Content-Format option (Option 12) for YANG+CBOR (260 = yang-data+cbor)
        const delta = 12 - prevOption;
        options.push((delta << 4) | 2); // length = 2
        options.push(1); // 260 = 0x0104 high byte
        options.push(4); // 260 = 0x0104 low byte
        prevOption = 12;

        // Uri-Query options (Option 15)
        if (queryPart) {
            const queries = queryPart.split('&').filter(Boolean);
            for (const q of queries) {
                const qBytes = [];
                for (let i = 0; i < q.length; i++) qBytes.push(q.charCodeAt(i));

                const qDelta = 15 - prevOption;
                if (qDelta < 13 && qBytes.length < 13) {
                    options.push((qDelta << 4) | qBytes.length);
                } else {
                    options.push((qDelta << 4) | 13);
                    options.push(qBytes.length - 13);
                }
                options.push(...qBytes);
                prevOption = 15;
            }
        }

        return options;
    }

    /**
     * Parse CoAP response
     */
    parseResponse(data) {
        if (data.length < 4) {
            throw new Error('Invalid CoAP message');
        }

        const version = (data[0] >> 6) & 0x03;
        const type = (data[0] >> 4) & 0x03;
        const tokenLength = data[0] & 0x0F;

        const code = data[1];
        const messageId = (data[2] << 8) | data[3];

        let offset = 4 + tokenLength; // Skip token

        // Find payload marker
        let payloadStart = data.length;
        for (let i = offset; i < data.length; i++) {
            if (data[i] === 0xFF) {
                payloadStart = i + 1;
                break;
            }
        }

        // Extract payload
        let payload = null;
        if (payloadStart < data.length) {
            const payloadData = data.slice(payloadStart);
            try {
                payload = cborDecode(payloadData);
            } catch (e) {
                console.warn('Failed to decode CBOR payload:', e.message);
                payload = payloadData;
            }
        }

        return {
            version,
            type,
            code,
            messageId,
            payload
        };
    }

    /**
     * Handle incoming data
     */
    handleData(data) {
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);

        // Try to parse complete frames
        while (this.receiveBuffer.length > 0) {
            const sofIndex = this.receiveBuffer.indexOf(this.protocol.SOF);
            if (sofIndex === -1) {
                this.receiveBuffer = Buffer.alloc(0);
                break;
            }

            if (sofIndex > 0) {
                this.receiveBuffer = this.receiveBuffer.slice(sofIndex);
            }

            // Need at least 8 bytes for minimal frame
            if (this.receiveBuffer.length < 8) {
                break;
            }

            // Find EOF
            const eofIndex = this.receiveBuffer.indexOf(this.protocol.EOF, 2);
            if (eofIndex === -1) {
                break;
            }

            // Check if we have complete frame (including checksum)
            const checksumStart = this.receiveBuffer[eofIndex + 1] === this.protocol.EOF ? eofIndex + 2 : eofIndex + 1;
            const frameEnd = checksumStart + 4;

            if (this.receiveBuffer.length < frameEnd) {
                break; // Wait for more data
            }

            // Extract and process frame
            const frameData = this.receiveBuffer.slice(0, frameEnd);
            this.receiveBuffer = this.receiveBuffer.slice(frameEnd);

            try {
                const decoded = this.protocol.decodeFrame(frameData);

                if (decoded.type === 'C') {
                    // CoAP response
                    const response = this.parseResponse(decoded.data);
                    const pending = this.pendingRequests.get(response.messageId);

                    if (pending) {
                        clearTimeout(pending.timeout);
                        this.pendingRequests.delete(response.messageId);

                        const responseClass = Math.floor(response.code / 32);
                        const codeName = this.RESPONSE_CODES[response.code] || `Code ${response.code}`;

                        console.log(`[CoAP RX] ${codeName} (${response.code})`);

                        if (responseClass === 2) {
                            pending.resolve(response.payload);
                        } else {
                            const error = new Error(codeName);
                            error.code = response.code;
                            error.payload = response.payload;
                            pending.reject(error);
                        }
                    }
                } else if (decoded.type === 'A') {
                    // Announcement
                    console.log('[MUP1] Announcement:', decoded.data.toString());
                }
            } catch (error) {
                console.error('[MUP1] Frame decode error:', error.message);
            }
        }
    }

    /**
     * Helper: Get method name
     */
    methodName(code) {
        return Object.keys(this.METHODS).find(k => this.METHODS[k] === code) || `Method ${code}`;
    }

    /**
     * GET request
     */
    async get(uri) {
        return this.request(this.METHODS.GET, uri);
    }

    /**
     * POST request
     */
    async post(uri, data) {
        return this.request(this.METHODS.POST, uri, data);
    }

    /**
     * PUT request
     */
    async put(uri, data) {
        return this.request(this.METHODS.PUT, uri, data);
    }

    /**
     * DELETE request
     */
    async delete(uri) {
        return this.request(this.METHODS.DELETE, uri);
    }
}

export default CoAPClient;
