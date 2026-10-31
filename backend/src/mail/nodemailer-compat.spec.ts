import * as nodemailer from 'nodemailer';

/**
 * Smoke test of the nodemailer major version: the transport options and the `sendMail` shape `MailService` uses
 * still build a valid message. `streamTransport` composes the real MIME message without any network.
 */
describe('nodemailer (compatibilidad de la versión instalada)', () => {
  it('compone el mensaje que envía MailService: remitente, destinatario, asunto, texto y HTML', async () => {
    const transporter = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    });
    const info = await transporter.sendMail({
      from: 'Domora <no-reply@domora.app>',
      to: 'vecina@example.com',
      subject: 'Nuevo recibo disponible',
      text: 'Hola',
      html: '<p>Hola</p>',
    });
    const raw = (info.message as Buffer).toString('utf8');
    expect(info.envelope).toEqual({
      from: 'no-reply@domora.app',
      to: ['vecina@example.com'],
    });
    expect(raw).toContain('From: Domora <no-reply@domora.app>');
    expect(raw).toContain('To: vecina@example.com');
    expect(raw).toContain('Subject: Nuevo recibo disponible');
    expect(raw).toContain('<p>Hola</p>');
  });

  it('acepta la configuración SMTP con la que MailService crea el transporte (sin conectar)', () => {
    const transporter = nodemailer.createTransport({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
    });
    expect(typeof transporter.sendMail).toBe('function');
    transporter.close();
  });
});
