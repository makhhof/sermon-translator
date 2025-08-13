require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const TranslationService = require('./Translator');

// Initialize Express app
const app = express();
const HTTP_PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Start HTTP server
const server = app.listen(HTTP_PORT, () => {
    console.log(`HTTP server listening on port ${HTTP_PORT}`);
    console.log('Available endpoints:');
    console.log(- GET  http://localhost:${HTTP_PORT}/api/usage);
    console.log(- POST http://localhost:${HTTP_PORT}/translate);
    console.log(- GET  http://localhost:${HTTP_PORT}/get_translation);
    console.log(- POST http://localhost:${HTTP_PORT}/clear_projector_text);
    console.log(- GET  http://localhost:${HTTP_PORT}/health);
});

// Initialize WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New WebSocket client connected');
    
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// API Usage Endpoint
app.get('/api/usage', async (req, res) => {
    try {
        const stats = await TranslationService.getUsageStats();
        res.json({
            success: true,
            data: {
                stats: stats.stats,
                nextReset: stats.nextReset,
                serverTime: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Usage stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get usage stats',
            error: error.message
        });
    }
});

// Translation Endpoint
app.post('/translate', async (req, res) => {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ 
            success: false,
            message: 'Invalid text input'
        });
    }

    try {
        const stats = await TranslationService.getUsageStats();
        const remaining = stats.stats['RapidAPI-Primary'].remaining + 
                         stats.stats['RapidAPI-Secondary'].remaining;

        if (remaining <= 0) {
            return res.status(429).json({
                success: false,
                message: 'API quota exhausted',
                nextReset: stats.nextReset
            });
        }

        const translation = await TranslationService.translate(text);

        // Broadcast to WebSocket clients
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'translation',
                    content: translation
                }));
            }
        });

        // Save to file
        await fs.writeFile(path.join(__dirname, 'public', 'projector_text.txt'), translation);

        res.json({ 
            success: true,
            translation,
            usage: await TranslationService.getUsageStats()
        });
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({
            success: false,
            message: 'Translation failed',
            error: error.message
        });
    }
});

// Projector Text Endpoint
app.get('/get_translation', async (req, res) => {
    try {
        const translation = await fs.readFile(
            path.join(__dirname, 'public', 'projector_text.txt'), 
            'utf8'
        );
        res.send(translation || 'Waiting for translation...');
    } catch (error) {
        res.send('Waiting for translation...');
    }
});

// Clear Projector Text Endpoint
app.post('/clear_projector_text', async (req, res) => {
    try {
        await fs.writeFile(
            path.join(__dirname, 'public', 'projector_text.txt'), 
            ''
        );
        // Notify WebSocket clients
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'clear'
                }));
            }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error Handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});


