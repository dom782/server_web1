const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve file statici dalla cartella public
app.use(express.static(path.join(__dirname, 'public')));

// Stato connessioni
let pcClient = null;
const scannerClients = new Set();

function broadcastStatus() {
  const status = JSON.stringify({
    type: 'status',
    pcConnected: pcClient !== null,
    scannersConnected: scannerClients.size
  });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(status);
  });
}

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const clientType = params.get('type') || 'scanner';
  const clientName = params.get('name') || 'Dispositivo';

  ws.clientType = clientType;
  ws.clientName = clientName;

  console.log(`[+] ${clientType} connesso: ${clientName}`);

  if (clientType === 'pc') {
    if (pcClient) pcClient.close();
    pcClient = ws;
  } else {
    scannerClients.add(ws);
  }

  broadcastStatus();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Scanner → PC: batch di codici scansionati
      if (msg.type === 'scan_batch') {
        console.log(`[SCAN] ${clientName}: ${msg.total} codici`);
        if (pcClient && pcClient.readyState === 1) {
          pcClient.send(JSON.stringify(msg));
          ws.send(JSON.stringify({ type: 'batch_ack', count: msg.total }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'PC non connesso' }));
        }
        return;
      }

      // PC → scanner: qualsiasi altro messaggio
      if (clientType === 'pc') {
        scannerClients.forEach(s => {
          if (s.readyState === 1) s.send(JSON.stringify(msg));
        });
      }

    } catch (e) {
      console.error('Errore messaggio:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`[-] ${clientType} disconnesso: ${clientName}`);
    if (clientType === 'pc') pcClient = null;
    else scannerClients.delete(ws);
    broadcastStatus();
  });

  ws.on('error', (err) => {
    console.error(`Errore WS (${clientName}):`, err.message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ScanPC server avviato sulla porta ${PORT}`);
});
