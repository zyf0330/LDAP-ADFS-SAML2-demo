'use strict'

/**
 *
 */

// see
// https://ldapwiki.com/wiki/Persistent%20Search%20Control
// https://ldapwiki.com/wiki/Entry%20Change%20Notification%20Control
// https://docs.ldap.com/specs/draft-ietf-ldapext-psearch-03.txt
// const persistentSearchControl = new ldapjs['PersistentSearchControl']({
//     value: {
//       changeTypes: 1 | 2 | 4 | 8,
//       changesOnly: false,
//       returnECs: true,
//     },
//   })


/**
 * for Windows AD
 * see https://docs.microsoft.com/en-us/windows/win32/ad/polling-for-changes-using-the-dirsync-control
 */
// async dirSyncForMSAD() {
//   const LDAP_SERVER_DIRSYNC_OID = '1.2.840.113556.1.4.841'
//   const LDAP_SERVER_EXTENDED_DN_OID = '1.2.840.113556.1.4.529'
//   const LDAP_SERVER_SHOW_DELETED_OID = '1.2.840.113556.1.4.417'
//   const client = await this.client
//   client.exop(LDAP_SERVER_DIRSYNC_OID, '', )
// }

import * as ldapjs from 'ldapjs'
import { createClient, Error, Client } from 'ldapjs'
import { EventEmitter } from 'events'

enum SearchScope {
  base = 'base',
  one = 'one',
  sub = 'sub'
}

const NotifyObjectKeys = <const>['dn', 'ou', 'cn', 'mobile', 'mail', 'name', 'objectClass', 'sAMAccountName'];

class MSADObjChangeNotifier extends EventEmitter {
  messageID: number
  client: Client
  stopped = false
  realStopped = false

  constructor(client) {
    super();
    this.client = client
  }

  on(event: 'change', listener: (object: Record<typeof NotifyObjectKeys[number], string>) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: (error?: Error) => void): this;
  on(event, listener) {
    return super.on(event, listener)
  }

  async stop() {
    if (this.realStopped) {
      return
    }

    // 由于 ldapjs 在 response 之前无法获得 messageID 因此只能延缓执行 abandon
    if (this.messageID !== undefined) {
      return new Promise<void>((res, rej) => {
        this.client['abandon'](this.messageID, (err) => {
          this.realStopped = true
          this.emit('end')
          err ? rej(err) : res()
        })
      })
    }
    this.stopped = true
  }
}

export class LDAPOrgFetcher {
  client: Promise<Client>
  baseDN: string

  constructor({
                url,
                adminDN,
                adminPassword,
                tlsOptions,
              }: { url: string, tlsOptions?: any, adminDN: string, adminPassword: string }) {
    this.client = Promise.resolve().then(() => {
      const client = createClient({
        url,
        tlsOptions,
      })
      return new Promise((res, rej) => {
        client.bind(adminDN, adminPassword, (err) => {
          if (err) {
            this.logError('bind admin fail', err)
            rej(err)
          } else {
            res(client)
          }
        })
      })
    })
  }

  async pullOU() {

  }

  /**
   * 从 Microsoft AD 接收对象更新通知
   * see https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/f14f3610-ee22-4d07-8a24-1bf1466cba5f
   * @param baseDN 默认是全局 baseDN
   * @param filterStr 过滤通知的对象属性，默认 (objectClass=*)
   */
  async subChangeNotificationForMSAD(baseDN: string = this.baseDN, filterStr = '(objectClass=*)'): Promise<MSADObjChangeNotifier> {
    const client = await this.client
    const msADServerNotificationControl = new ldapjs['Control']({
      type: '1.2.840.113556.1.4.528',
      criticality: false,
    })
    const notifier = new MSADObjChangeNotifier(client)
    client.search(baseDN, {
      scope: SearchScope.sub,
      attributes: NotifyObjectKeys as any,
      filter: '(objectClass=*)',
    }, msADServerNotificationControl, (err, response) => {
      if (err) {
        notifier.emit('end', err)
        return
      }

      const filter = ldapjs.parseFilter(filterStr)
      response.on('searchEntry', ({ messageID, object, controls }) => {
        notifier.messageID = messageID
        if (notifier.stopped) {
          notifier.stop()
          return
        }
        if (filter.matches(object)) {
          notifier.emit('change', object)
        }
      })
      response.on('error', (err) => {
        this.logError('search error', err);
        notifier.emit('error', err)
      });
      response.on('end', (result) => {
        if (result?.status !== 0) {
          console.error('search end', result.status, result.errorMessage)
          notifier.emit('error', err)
          return
        } else {
          notifier.emit('end')
        }
      });
    })
    return notifier
  }

  private logError(label: string, err?: Error) {
    if (err) {
      console.error(`${label}: [${err.code}] ${err.name}`)
    } else {
      console.error(`${label}`)
    }
  }
}