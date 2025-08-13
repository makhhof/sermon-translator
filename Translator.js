const { AbortController } = require('abort-controller');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class TranslationService {
    static usageStats = {
        'RapidAPI-Primary': { 
            used: 0, 
            remaining: parseInt(process.env.MAX_REQUESTS_PER_DAY) || 1000, 
            lastReset: Date.now() 
        },
        'RapidAPI-Secondary': { 
            used: 0, 
            remaining: parseInt(process.env.MAX_REQUESTS_PER_DAY) || 1000, 
            lastReset: Date.now() 
        },
        'LibreTranslate': { 
            used: 0, 
            remaining: Infinity 
        }
    };

    static config = {
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 86400000, // 24 hours default
        statsFilePath: path.join(__dirname, 'api_usage_stats.json')
    };

    static async initialize() {
        try {
            const stats = await fs.readFile(this.config.statsFilePath, 'utf8');
            this.usageStats = JSON.parse(stats);
            const now = Date.now();
            if (now - this.usageStats['RapidAPI-Primary'].lastReset > this.config.rateLimitWindow) {
                this.resetCounters();
            }
        } catch (error) {
            console.log('Initializing new usage stats file');
            await this.saveStats();
        }
    }

    static async saveStats() {
        await fs.writeFile(this.config.statsFilePath, JSON.stringify(this.usageStats, null, 2));
    }

    static resetCounters() {
        const now = Date.now();
        Object.keys(this.usageStats).forEach(provider => {
            if (provider.includes('RapidAPI')) {
                this.usageStats[provider] = { 
                    used: 0, 
                    remaining: parseInt(process.env.MAX_REQUESTS_PER_DAY) || 1000,
                    lastReset: now 
                };
            }
        });
        this.saveStats();
    }

    static async updateStats(provider, headers) {
        const remaining = parseInt(headers?.get('x-ratelimit-remaining')) || 
                         this.usageStats[provider].remaining - 1;
        
        this.usageStats[provider].used++;
        this.usageStats[provider].remaining = Math.max(0, remaining);
        await this.saveStats();
    }

    static getRemainingQuota(provider) {
        return this.usageStats[provider].remaining;
    }

    static async getUsageStats() {
        return {
            stats: this.usageStats,
            nextReset: new Date(
                this.usageStats['RapidAPI-Primary'].lastReset + 
                this.config.rateLimitWindow
            ).toISOString()
        };
    }

    static providers = [
        {
            name: 'RapidAPI-Primary',
            translate: async (text) => {
                if (this.getRemainingQuota('RapidAPI-Primary') <= 0) return null;

                const host = process.env.RAPIDAPI_HOST;
                const key = process.env.RAPIDAPI_KEY_PRIMARY;
                
                if (!host || !key) {
                    throw new Error('RapidAPI primary configuration missing');
                }
                
                try {
                    const response = await this.fetchWithTimeout(
                        `https://${host}/translate`,
                        {
                            method: 'POST',
                            headers: {
                                'content-type': 'application/x-www-form-urlencoded',
                                'X-RapidAPI-Host': host,
                                'X-RapidAPI-Key': key
                            },
                            body: new URLSearchParams({
                                source_language: 'en',
                                target_language: 'fa',
                                text: text
                            })
                        },
                        5000
                    );

                    await this.updateStats('RapidAPI-Primary', response.headers);
                    const data = await response.json();
                    return data.data?.translatedText;
                } catch (error) {
                    console.error('RapidAPI-Primary error:', error.message);
                    return null;
                }
            }
        },
        {
            name: 'RapidAPI-Secondary',
            translate: async (text) => {
                if (this.getRemainingQuota('RapidAPI-Secondary') <= 0) return null;

                const host = process.env.RAPIDAPI_HOST;
                const key = process.env.RAPIDAPI_KEY_SECONDARY;
                
                if (!host || !key) {
                    throw new Error('RapidAPI secondary configuration missing');
                }
                
                try {
                    const response = await this.fetchWithTimeout(
                        `https://${host}/translate`,
                        {
                            method: 'POST',
                            headers: {
                                'content-type': 'application/x-www-form-urlencoded',
                                'X-RapidAPI-Host': host,
                                'X-RapidAPI-Key': key
                            },
                            body: new URLSearchParams({
                                source_language: 'en',
                                target_language: 'fa',
                                text: text
                            })
                        },
                        5000
                    );

                    await this.updateStats('RapidAPI-Secondary', response.headers);
                    const data = await response.json();
                    return data.data?.translatedText;
                } catch (error) {
                    console.error('RapidAPI-Secondary error:', error.message);
                    return null;
                }
            }
        },
        {
            name: 'LibreTranslate',
            translate: async (text) => {
                const endpoints = process.env.LIBRETRANSLATE_ENDPOINTS?.split(',') || [
                    'https://libretranslate.de',
                    'https://translate.argosopentech.com',
                    'https://libretranslate.com'
                ];

                for (const endpoint of endpoints) {
                    try {
                        const response = await this.fetchWithTimeout(
                            `${endpoint}/translate`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    q: text,
                                    source: 'en',
                                    target: 'fa',
                                    format: 'text'
                                })
                            },
                            10000
                        );

                        if (!response.ok) continue;
                        
                        await this.updateStats('LibreTranslate');
                        const data = await response.json();
                        return data.translatedText;
                    } catch (error) {
                        console.log(`LibreTranslate endpoint ${endpoint} failed: ${error.message}`);
                    }
                }
                return null;
            }
        }
    ];

    static async fetchWithTimeout(url, options, timeout) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    static async translate(text) {
        if (!text?.trim()) return '';

        for (const provider of this.providers) {
            try {
                if (this.getRemainingQuota(provider.name) <= 0) continue;
                
                console.log(`Trying ${provider.name}...`);
                const translation = await provider.translate(text.trim());
                if (translation) {
                    console.log(`Success with ${provider.name}`);
                    return translation;
                }
            } catch (error) {
                console.error(`Error with ${provider.name}:`, error.message);
            }
        }
        return `[Translation failed] ${text.trim()}`;
    }
}

// Initialize when module loads
TranslationService.initialize().catch(console.error);

module.exports = TranslationService;