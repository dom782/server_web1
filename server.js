const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Connessioni attive
const clients = {
  pc: null,
  scanners: new Set()
};

function getStatus() {
  return {
    type: 'status',
    pcConnected: clients.pc !== null,
    scannersConnected: clients.scanners.size,
    timestamp: new Date().toISOString()
  };
}

function broadcastStatus() {
  const s = JSON.stringify(getStatus());
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(s); });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const clientType = url.searchParams.get('type'); // 'pc' o 'scanner'
  const clientName = url.searchParams.get('name') || 'Scanner';

  console.log(`[+] Connesso: type=${clientType}, name=${clientName}`);

  if (clientType === 'pc') {
    if (clients.pc) clients.pc.close();
    clients.pc = ws;
    ws.clientName = 'PC';
  } else {
    ws.clientName = clientName;
    clients.scanners.add(ws);
  }

  broadcastStatus();
  ws.send(JSON.stringify(getStatus()));
  ws.send(JSON.stringify({
    type: 'system',
    text: `✅ Connesso come ${ws.clientName}`,
    timestamp: new Date().toISOString()
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      msg.from = ws.clientName;
      msg.timestamp = new Date().toISOString();

      // Scanner → PC: invia i codici scansionati
      if (msg.type === 'scan_batch' || msg.type === 'scan_single') {
        console.log(`[SCAN] ${ws.clientName}: ${JSON.stringify(msg.codes || msg.code)}`);
        if (clients.pc && clients.pc.readyState === 1) {
          clients.pc.send(JSON.stringify(msg));
          // Conferma allo scanner
          ws.send(JSON.stringify({ type: 'batch_ack', count: msg.codes?.length || 1, timestamp: msg.timestamp }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'PC non connesso' }));
        }
        return;
      }

      // PC → scanner: eventuale risposta/conferma
      if (clientType === 'pc') {
        clients.scanners.forEach(s => { if (s.readyState === 1) s.send(JSON.stringify(msg)); });
      }

    } catch (e) {
      console.error('Errore parsing:', e);
    }
  });

  ws.on('close', () => {
    console.log(`[-] Disconnesso: ${ws.clientName}`);
    if (clientType === 'pc') clients.pc = null;
    else clients.scanners.delete(ws);
    broadcastStatus();
  });

  ws.on('error', err => console.error(`Errore WS (${ws.clientName}):`, err));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Scanner server → porta ${PORT}`));
