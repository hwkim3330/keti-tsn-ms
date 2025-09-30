/**
 * CoAP Client Implementation for CORECONF
 * RFC 7252 (CoAP) and RFC 9254 (YANG to CBOR)
 */

import { encode as cborEncode, decode as cborDecode } from 'cbor-x';

export class CoAPClient {
    constructor() {
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
            65: 'Created',      // 2.01
            66: 'Deleted',      // 2.02
            67: 'Valid',        // 2.03
            68: 'Changed',      // 2.04
            69: 'Content',      // 2.05
            128: 'Bad Request', // 4.00
            129: 'Unauthorized',// 4.01
            132: 'Not Found',   // 4.04
            133: 'Method Not Allowed', // 4.05
            160: 'Internal Server Error' // 5.00
        };
    }

    /**
     * Build CoAP message
     */
    buildMessage(method, uri, payload = null) {
        const header = [];

        // Version (2 bits) | Type (2 bits) | Token Length (4 bits)
        const ver = 1;   // CoAP version 1
        const type = 0;  // CON (Confirmable)
        const tkl = 0;   // Token length (CLI doesn't use tokens)
        header.push((ver << 6) | (type << 4) | tkl);

        // Code (8 bits)
        header.push(method);

        // Message ID (16 bits)
        const mid = this.messageId++;
        header.push((mid >> 8) & 0xFF);
        header.push(mid & 0xFF);

        // No token (TKL=0)

        // Options
        const options = this.encodeOptions(uri);
        header.push(...options);

        // Payload marker and payload
        if (payload !== null && payload !== undefined) {
            header.push(0xFF); // Payload marker
            const encoded = cborEncode(payload);
            header.push(...encoded);
        }

        return { buffer: Buffer.from(header), messageId: mid };
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

            if (delta < 13 && length < 13) {
                options.push((delta << 4) | length);
            } else {
                // Extended option format
                let firstByte = 0;

                if (delta < 13) {
                    firstByte |= (delta << 4);
                } else if (delta < 269) {
                    firstByte |= (13 << 4);
                    options.push(firstByte);
                    options.push(delta - 13);
                    firstByte = 0;
                } else {
                    firstByte |= (14 << 4);
                    options.push(firstByte);
                    options.push((delta - 269) >> 8);
                    options.push((delta - 269) & 0xFF);
                    firstByte = 0;
                }

                if (length < 13) {
                    if (firstByte) options.push(firstByte | length);
                } else if (length < 269) {
                    if (firstByte) options.push(firstByte | 13);
                    options.push(length - 13);
                } else {
                    if (firstByte) options.push(firstByte | 14);
                    options.push((length - 269) >> 8);
                    options.push((length - 269) & 0xFF);
                }
            }

            // Add segment bytes
            for (let i = 0; i < segment.length; i++) {
                options.push(segment.charCodeAt(i));
            }

            prevOption = 11;
        });

        // Content-Format option (Option 12) for CBOR
        const delta = 12 - prevOption;
        options.push((delta << 4) | 1);
        options.push(60); // application/cbor
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
                    const first = (qDelta < 13 ? qDelta : 13) << 4 | 13;
                    options.push(first);
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

        let offset = 4;

        // Extract token
        let token = 0;
        for (let i = 0; i < tokenLength; i++) {
            token = (token << 8) | data[offset++];
        }

        // Parse options and find payload
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
                payload = payloadData;
            }
        }

        return {
            version,
            type,
            code,
            messageId,
            token,
            payload
        };
    }

    /**
     * Register pending request
     */
    registerRequest(messageId) {
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(messageId, { resolve, reject });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(messageId)) {
                    this.pendingRequests.delete(messageId);
                    reject(new Error('Request timeout'));
                }
            }, 10000);
        });
    }

    /**
     * Handle CoAP response
     */
    handleResponse(data) {
        try {
            const response = this.parseResponse(data);
            const pending = this.pendingRequests.get(response.messageId);

            if (pending) {
                this.pendingRequests.delete(response.messageId);

                const responseClass = Math.floor(response.code / 32);
                if (responseClass === 2) {
                    // Success response (2.xx)
                    pending.resolve(response.payload);
                } else {
                    // Error response
                    const error = new Error(this.RESPONSE_CODES[response.code] || `Error ${response.code}`);
                    error.code = response.code;
                    error.payload = response.payload;
                    pending.reject(error);
                }
            }
        } catch (error) {
            console.error('Failed to handle CoAP response:', error);
        }
    }

    /**
     * GET request (uses FETCH with payload for YANG paths)
     */
    get(uri) {
        // For YANG paths, use FETCH method with URI as payload array
        const payload = [uri];
        const { buffer, messageId } = this.buildMessage(this.METHODS.FETCH, 'c?d=a', payload);
        const promise = this.registerRequest(messageId);
        return { buffer, promise };
    }

    /**
     * POST request
     */
    post(uri, data) {
        const { buffer, messageId } = this.buildMessage(this.METHODS.POST, uri, data);
        const promise = this.registerRequest(messageId);
        return { buffer, promise };
    }

    /**
     * PUT request
     */
    put(uri, data) {
        const { buffer, messageId } = this.buildMessage(this.METHODS.PUT, uri, data);
        const promise = this.registerRequest(messageId);
        return { buffer, promise };
    }

    /**
     * DELETE request
     */
    delete(uri) {
        const { buffer, messageId } = this.buildMessage(this.METHODS.DELETE, uri);
        const promise = this.registerRequest(messageId);
        return { buffer, promise };
    }
}

export default CoAPClient;