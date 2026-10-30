import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as https from 'node:https';
import {
  verifactuEndpoint,
  type VerifactuCertType,
  type VerifactuEnv,
} from './verifactu-endpoints';

/**
 * Transporte SOAP con autenticación mutua TLS contra la AEAT.
 *
 * En modo VERI\*FACTU **el certificado es la única autenticación**: no hay
 * cabecera SOAP, ni token, ni firma por registro. Quien presenta el
 * certificado *es* el remitente a ojos de la Agencia. De ahí las decisiones de
 * este fichero:
 *
 * - La contraseña del `.p12` **nunca se registra en el log**, ni siquiera al
 *   fallar la carga: un fichero de log es mucho más fácil de filtrar que un
 *   almacén de secretos.
 * - El certificado se lee **una vez al arrancar**. Si falta o la contraseña no
 *   abre el fichero, el fallo aparece en el arranque y no en mitad de una
 *   emisión, que es cuando peor sienta.
 * - `VERIFACTU_ENABLED` está **apagado por defecto**. Un entorno de desarrollo
 *   mal configurado no debe poder remitir nada: los registros se quedan en
 *   `pendiente`, que es un estado del que siempre se puede salir.
 *
 * Se usa `node:https` en lugar de un cliente SOAP: la operación es un único
 * POST con un cuerpo que ya generamos nosotros contra el XSD, y el agente de
 * TLS con `.p12` es directo. Añadir una pila SOAP entera para esto traería más
 * superficie de la que ahorra.
 */

/** Segundos por defecto antes de abandonar una petición. */
const TIMEOUT_MS = 60_000;

export interface RespuestaCruda {
  status: number;
  xml: string;
}

/** Fallo de red, TLS o HTTP. Es distinto de un rechazo funcional de la AEAT. */
export class VerifactuTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VerifactuTransportError';
  }
}

@Injectable()
export class VerifactuSoapClient implements OnModuleInit {
  private readonly logger = new Logger(VerifactuSoapClient.name);
  private agent?: https.Agent;

  constructor(private readonly config: ConfigService) {}

  /** ¿Está habilitada la remisión? Apagado salvo que se diga lo contrario. */
  get enabled(): boolean {
    return this.config.get<string>('VERIFACTU_ENABLED') === 'true';
  }

  get env(): VerifactuEnv {
    return this.config.get<string>('VERIFACTU_ENV') === 'produccion'
      ? 'produccion'
      : 'preproduccion';
  }

  get certType(): VerifactuCertType {
    return this.config.get<string>('VERIFACTU_CERT_TYPE') === 'sello'
      ? 'sello'
      : 'normal';
  }

  get endpoint(): string {
    return verifactuEndpoint(this.env, this.certType);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Remisión a la AEAT deshabilitada (VERIFACTU_ENABLED != true). Los registros se acumularán como pendientes.',
      );
      return;
    }
    this.agent = this.buildAgent();
    this.logger.log(
      `Remisión habilitada contra ${this.endpoint} (certificado ${this.certType}).`,
    );
  }

  /**
   * Construye el agente TLS a partir del `.p12`.
   *
   * Se falla en el arranque a propósito, siguiendo el mismo criterio que la
   * validación de entorno: es preferible que un despliegue mal configurado no
   * arranque a que descubra el problema al emitir la primera factura.
   */
  private buildAgent(): https.Agent {
    const path = this.config.get<string>('VERIFACTU_CERT_PATH');
    const passphrase = this.config.get<string>('VERIFACTU_CERT_PASSWORD');

    if (!path) {
      throw new Error(
        'VERIFACTU_ENABLED=true pero falta VERIFACTU_CERT_PATH: sin certificado no hay forma de autenticarse ante la AEAT.',
      );
    }

    let pfx: Buffer;
    try {
      pfx = fs.readFileSync(path);
    } catch {
      // Se informa de la ruta, nunca de la contraseña.
      throw new Error(
        `No se pudo leer el certificado de VERIFACTU_CERT_PATH (${path}).`,
      );
    }

    try {
      return new https.Agent({
        pfx,
        passphrase,
        keepAlive: true,
        maxSockets: 1,
        minVersion: 'TLSv1.2',
      });
    } catch {
      throw new Error(
        'El certificado no se pudo abrir: comprueba que VERIFACTU_CERT_PASSWORD es la del fichero .p12.',
      );
    }
  }

  /**
   * Envía un sobre SOAP y devuelve la respuesta cruda.
   *
   * No interpreta el XML —de eso se encarga `parseRespuesta`— para que el
   * transporte y el tratamiento funcional se puedan probar por separado.
   */
  async post(envelope: string): Promise<RespuestaCruda> {
    if (!this.enabled || !this.agent) {
      throw new VerifactuTransportError(
        'La remisión a la AEAT está deshabilitada.',
        false,
      );
    }

    const url = new URL(this.endpoint);
    const body = Buffer.from(envelope, 'utf8');

    return new Promise<RespuestaCruda>((resolve, reject) => {
      const request = https.request(
        {
          agent: this.agent,
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'POST',
          headers: {
            // El binding del WSDL es SOAP 1.1: el tipo es text/xml y
            // SOAPAction va vacío (así lo declara el propio WSDL).
            'Content-Type': 'text/xml; charset=UTF-8',
            SOAPAction: '',
            'Content-Length': body.length,
          },
          timeout: TIMEOUT_MS,
        },
        (response) => {
          const trozos: Buffer[] = [];
          response.on('data', (trozo: Buffer) => trozos.push(trozo));
          response.on('end', () => {
            const status = response.statusCode ?? 0;
            const xml = Buffer.concat(trozos).toString('utf8');
            // 500 puede traer un SOAP Fault con información útil, así que se
            // deja pasar para que lo interprete el parser. El resto de
            // errores HTTP no traen cuerpo aprovechable.
            if (status >= 400 && status !== 500) {
              reject(
                new VerifactuTransportError(
                  `La AEAT respondió ${status}.`,
                  status >= 500 || status === 429,
                  status,
                ),
              );
              return;
            }
            resolve({ status, xml });
          });
        },
      );

      request.on('timeout', () => {
        request.destroy();
        reject(
          new VerifactuTransportError(
            `Sin respuesta de la AEAT en ${TIMEOUT_MS / 1000} s.`,
            true,
          ),
        );
      });

      // Red caída, DNS, TLS rechazado... Todo reintentable: la norma
      // contempla que el envío se difiera si el servicio no está disponible.
      request.on('error', (error) => {
        reject(new VerifactuTransportError(error.message, true));
      });

      request.write(body);
      request.end();
    });
  }
}
