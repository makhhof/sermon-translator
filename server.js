const express = require('express');
const bodyParser = require('body-parser');
// Change from separate ports to shared port:
const server = app.listen(HTTP_PORT, () => {...});
const wss = new WebSocket.Server({ server }); // Share HTTP server
const fs = require('fs').promises;
const path = require('path');
const TranslationService = require('./Translator');

// Initialize Express app
const app = express();
const HTTP_PORT = 3000;
const WS_PORT = 8080;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files
app.use(express.json()); // For parsing JSON bodies

// CORS Middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Initialize WebSocket server
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('listening', () => {
    console.log(`WebSocket server listening on ws://localhost:${WS_PORT}`);
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
        // Check API quotas first
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

        // Perform translation
        const translation = await TranslationService.translate(text);

        // Broadcast to WebSocket clients
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(translation);
            }
        });

        // Save to file for projector view
        await fs.writeFile(path.join(__dirname, 'projector_text.txt'), translation);

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
            path.join(__dirname, 'projector_text.txt'), 
            'utf8'
        );
        res.send(translation || 'در حال انتظار برای ترجمه...');
    } catch (error) {
        res.send('در حال انتظار برای ترجمه...');
    }
});

// Clear Projector Text Endpoint
app.post('/clear_projector_text', async (req, res) => {
    try {
        await fs.writeFile(
            path.join(__dirname, 'projector_text.txt'), 
            ''
        );
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
        memoryUsage: process.memoryUsage()
    });
});

// Start HTTP Server
app.listen(HTTP_PORT, () => {
    console.log(`HTTP server listening on http://localhost:${HTTP_PORT}`);
    console.log('Endpoints:');
    console.log(`- GET  http://localhost:${HTTP_PORT}/api/usage`);
    console.log(`- POST http://localhost:${HTTP_PORT}/translate`);
    console.log(`- GET  http://localhost:${HTTP_PORT}/get_translation`);
    console.log(`- POST http://localhost:${HTTP_PORT}/clear_projector_text`);
    console.log(`- GET  http://localhost:${HTTP_PORT}/health`);
});

// Error Handling
process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);

});

