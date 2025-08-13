const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const http = require('http');
const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/broadcast-translation') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(data.translation);
                    }
                });
                res.end();
            } catch (e) {
                res.writeHead(400).end();
            }
        });
    } else {
        res.writeHead(404).end();
    }
});

server.listen(3001);