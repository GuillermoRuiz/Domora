/**
 * SOLO DESARROLLO. Servidor SMTP mínimo que NO entrega nada: recibe los correos que envía el backend
 * (consultas a proveedores) y los guarda como .eml, para poder leerlos en local.
 *
 *   node scripts/dev-smtp-sink.cjs            # escucha en 127.0.0.1:1025
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=1025 node scripts/local-preview.cjs
 *
 * Variables: SMTP_SINK_PORT (1025), SMTP_SINK_DIR (carpeta de salida).
 */
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.SMTP_SINK_PORT ?? 1025);
const dir =
  process.env.SMTP_SINK_DIR ??
  path.join(
    process.env.TEMP ?? require('node:os').tmpdir(),
    'domora-ai-live-db',
    'mail-sink',
  );
fs.mkdirSync(dir, { recursive: true });

const server = net.createServer((socket) => {
  let buffer = '';
  let data = null;
  let from = '';
  const to = [];
  const say = (line) => socket.write(`${line}\r\n`);
  say('220 domora-dev-sink ESMTP');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('latin1');
    for (;;) {
      if (data !== null) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        data += buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        const file = path.join(
          dir,
          `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}.eml`,
        );
        const raw = `X-Envelope-From: ${from}\r\nX-Envelope-To: ${to.join(', ')}\r\n${data.replace(/^\.\./gm, '.')}`;
        fs.writeFileSync(file, raw, 'latin1');
        console.log(`Correo guardado: ${file}`);
        data = null;
        say('250 OK');
        continue;
      }
      const eol = buffer.indexOf('\r\n');
      if (eol < 0) return;
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') {
        socket.write('250-domora-dev-sink\r\n250 8BITMIME\r\n');
      } else if (cmd === 'HELO' || cmd === 'RSET' || cmd === 'NOOP')
        say('250 OK');
      else if (cmd === 'MAIL') {
        from = line.replace(/^MAIL FROM:/i, '').trim();
        to.length = 0;
        say('250 OK');
      } else if (cmd === 'RCPT') {
        to.push(line.replace(/^RCPT TO:/i, '').trim());
        say('250 OK');
      } else if (cmd === 'DATA') {
        data = '';
        say('354 End data with <CR><LF>.<CR><LF>');
      } else if (cmd === 'QUIT') {
        say('221 Bye');
        socket.end();
        return;
      } else say('502 Command not implemented');
    }
  });
  socket.on('error', () => undefined);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`SMTP_SINK_READY 127.0.0.1:${port} → ${dir}`);
});
