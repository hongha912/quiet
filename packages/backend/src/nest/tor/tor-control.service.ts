
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import net from 'net'
import { CONFIG_OPTIONS, TOR_CONTROL_PARAMS } from '../const'
import { ConfigOptions } from '../types'
import { Tor } from './tor.service'
import { TorControlAuthType, TorControlParams } from './tor.types'

@Injectable()
export class TorControl implements OnModuleInit {
  connection: net.Socket | null
  authString: string
  private readonly logger = new Logger(TorControl.name)
  constructor(
    @Inject(TOR_CONTROL_PARAMS) public torControlParams: TorControlParams,
    @Inject(CONFIG_OPTIONS) public configOptions: ConfigOptions,
     private readonly tor: Tor) {

  }

  onModuleInit() {
    const auth = {
      value: this.configOptions.torAuthCookie || this.tor.torPassword,
      type: this.configOptions.torAuthCookie ? TorControlAuthType.COOKIE : TorControlAuthType.PASSWORD
    }

    if (auth.type === TorControlAuthType.PASSWORD) {
      this.authString = 'AUTHENTICATE "' + auth.value + '"\r\n'
    }
    if (auth.type === TorControlAuthType.COOKIE) {
      // Cookie authentication must be invoked as a hexadecimal string passed without double quotes
      this.authString = 'AUTHENTICATE ' + auth.value + '\r\n'
    }
  }

  private async connect(): Promise<void> {
    return await new Promise((resolve, reject) => {
      if (this.connection) {
        reject(new Error('TOR: Connection already established'))
      }

      this.connection = net.connect({
        port: this.torControlParams.port,
        family: 4
})

      this.connection.once('error', err => {
        reject(new Error(`TOR: Connection via tor control failed: ${err.message}`))
      })
      this.connection.once('data', (data: any) => {
        if (/250 OK/.test(data.toString())) {
          resolve()
        } else {
          reject(new Error(`TOR: Control port error: ${data.toString() as string}`))
        }
      })
      this.connection.write(this.authString)
    })
  }

  private async disconnect() {
    try {
      this.connection?.end()
    } catch (e) {
      this.logger.error('Cant disconnect', e.message)
    }
    this.connection = null
  }

  private async _sendCommand(command: string, resolve: Function, reject: Function) {
    await this.connect()
    const connectionTimeout = setTimeout(() => {
      reject('TOR: Send command timeout')
    }, 5000)
    this.connection?.on('data', async data => {
      await this.disconnect()
      const dataArray = data.toString().split(/\r?\n/)
      if (dataArray[0].startsWith('250')) {
        resolve({ code: 250, messages: dataArray })
      } else {
        clearTimeout(connectionTimeout)
        reject(`${dataArray[0]}`)
      }
      clearTimeout(connectionTimeout)
    })
    this.connection?.write(command + '\r\n')
  }

  public async sendCommand(command: string): Promise<{ code: number; messages: string[] }> {
    return await new Promise((resolve, reject) => {
      void this._sendCommand(command, resolve, reject)
    })
  }
}
