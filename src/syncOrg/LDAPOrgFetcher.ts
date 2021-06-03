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
 * for Active Directory
 * see https://docs.microsoft.com/en-us/windows/win32/ad/polling-for-changes-using-the-dirsync-control
 */
// async dirSyncForAD() {
//   const LDAP_SERVER_DIRSYNC_OID = '1.2.840.113556.1.4.841'
//   const LDAP_SERVER_EXTENDED_DN_OID = '1.2.840.113556.1.4.529'
//   const LDAP_SERVER_SHOW_DELETED_OID = '1.2.840.113556.1.4.417'
//   const client = await this.client
//   client.exop(LDAP_SERVER_DIRSYNC_OID, '', )
// }

import * as ldapjs from 'ldapjs'
import { createClient, Error, Client, parseDN, parseFilter, PresenceFilter, LDAPResult } from 'ldapjs'
import { EventEmitter } from 'events'

interface PageEmitter<T extends FetchObject> extends EventEmitter {
  on(event: 'page', listener: (objs: T[], nextPage: () => void) => void): this

  once(event: 'end', listener: (objs: T[]) => void): this
}

export enum SearchScope {
  base = 'base',
  one = 'one',
  sub = 'sub'
}

/**
 * see https://docs.microsoft.com/en-us/windows/win32/adschema/a-useraccountcontrol
 */
enum LDAPUserAccountControl {
  attrName = 'userAccountControl',
  ACCOUNTDISABLE = 0x00000002,
}

const LDAP_MATCHING_RULE_BIT_AND = '1.2.840.113556.1.4.803'

export enum DirectoryServiceName {
  ActiveDirectory = 'ActiveDirectory',
  OpenLDAP = 'OpenLDAP',
}

/**
 * see https://docs.oracle.com/cd/E26217_01/E26214/html/ldap-filters-attrs-users.html for common filters
 */
const SearchFilters: Record<'default' | keyof typeof DirectoryServiceName, Partial<Record<'user' | 'ou', string>>> = {
  default: {
    user: `(&(|(objectclass=user)(objectclass=person)(objectclass=inetOrgPerson)(objectclass=organizationalPerson))(!(objectclass=computer)))`,
    ou: `(objectClass=organizationalUnit)`,
  },
  /**
   * About Active Directory LDAP Syntax Filters,
   * see https://social.technet.microsoft.com/wiki/contents/articles/5392.active-directory-ldap-syntax-filters.aspx#Filter_on_objectCategory_and_objectClass
   */
  [DirectoryServiceName.ActiveDirectory]: {
    user: `(&(sAMAccountType=805306368)(!(${LDAPUserAccountControl.attrName}:${LDAP_MATCHING_RULE_BIT_AND}:=${LDAPUserAccountControl.ACCOUNTDISABLE})))`,
  },
  [DirectoryServiceName.OpenLDAP]: {
    user: `(objectClass=person)`,
  },

}

const userAttrKeys = <const>['cn', 'sn', 'givenName', 'displayName', 'mobile', 'mail', 'sAMAccountName']
const ouAttrKeys = <const>['ou']
const searchAttrKeys = <const>['dn', ...ouAttrKeys, ...userAttrKeys];

interface FetchObject {
  dn: string
  type: 'user' | 'ou'
}

interface FetchUser extends FetchObject, Record<typeof userAttrKeys[number], string> {
  type: 'user'
  cn: string
}

interface FetchOU extends FetchObject, Record<typeof ouAttrKeys[number], string | any> {
  type: 'ou'
  ou: string
  parentOUDN?: string
}

interface FetchNestOU extends FetchOU {
  users: FetchUser[]
  childOUs: FetchNestOU[]
}

type WholeOrg = { usersNotInOU: FetchUser[], ous: FetchNestOU[] }

/**
 * for Active Directory
 */
class ADObjChangeNotifier extends EventEmitter {
  messageID: number
  client: Client
  stopped = false
  realStopped = false

  constructor(client) {
    super();
    this.client = client
  }

  on(event: 'change', listener: (object: FetchObject) => void): this;
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
  dsType: DirectoryServiceName
  searchFilter: typeof SearchFilters.default

  constructor({
                url,
                adminDN,
                adminPassword,
                tlsOptions,
                dsType = DirectoryServiceName.ActiveDirectory,
                baseDN = '',
              }: { url: string, adminDN: string, adminPassword: string, tlsOptions?: any, baseDN?: string, dsType?: DirectoryServiceName }) {
    this.baseDN = baseDN
    this.dsType = dsType
    this.searchFilter = Object.assign(SearchFilters.default, SearchFilters[this.dsType])
    this.client = Promise.resolve().then(() => {
      const client = createClient({
        url: `${url}/${this.baseDN}`,
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

  async release() {
    const client = await this.client
    return new Promise<void>((res) => {
      client.unbind((err) => {
        if (err) {
          this.logError('unbind', err)
        }
        res()
      })
    })
  }

  async fetch<T extends FetchObject>(filter: string, baseDN = this.baseDN, scope = SearchScope.sub, { paged = false } = {}): Promise<T[] | PageEmitter<T>> {
    const client = await this.client
    return new Promise((res, rej) => {
      client.search(baseDN, {
        scope,
        attributes: searchAttrKeys as any,
        filter,
        paged: { pagePause: paged },
      }, (err, response) => {
        if (err) {
          rej(err)
          return
        }
        const objs = []
        response.on('searchEntry', ({ object: entryObject }) => {
          const object = { ...entryObject } as unknown as T
          delete object['controls']
          objs.push(object)
        })
        response.on('error', (err) => {
          this.logError('search error', err);
        });
        response.on('end', (result) => {
          if (result?.status !== 0) {
            console.error('search end', result.status, result.errorMessage)
          }
          if (!paged) {
            res(objs)
          }
        });

        if (paged) {
          const pageEmitter: PageEmitter<T> = new EventEmitter()
          response.on('page', (result, cb) => {
            if (result instanceof LDAPResult) {
              pageEmitter.emit('page', objs.slice(0), cb)
              objs.length = 0
            } else {
              pageEmitter.emit('end', objs)
            }
          })
          res(pageEmitter)
        }
      })
    })
  }

  async fetchOUs(filter: string = this.searchFilter.ou, baseDN = this.baseDN, scope = SearchScope.sub) {
    const ous = (await this.fetch(filter, baseDN, scope)) as FetchOU[]
    ous.forEach((ou) => {
      const filterOU = new PresenceFilter({ attribute: 'ou' });
      const dn = parseDN(ou.dn)
      dn.shift() // remove ou self
      while (dn.length > 0) {
        if (filterOU.matches(dn.rdns[0].attrs)) {
          ou.parentOUDN = dn.format({ keepCase: true, skipSpace: true })
          break
        }
        dn.shift()
      }
    })
    return ous
  }

  async fetchUsers(filter: string = this.searchFilter.user, baseDN = this.baseDN, scope = SearchScope.sub) {
    return (await this.fetch(filter, baseDN, scope)) as FetchUser[]
  }

  async fetchUsersPaged(filter: string = this.searchFilter.user, baseDN = this.baseDN, scope = SearchScope.sub) {
    return (await this.fetch(filter, baseDN, scope, { paged: true })) as PageEmitter<FetchUser>
  }

  /**
   * 获取完整的组织架构树，包括各级 ou 和 user
   */
  async fetchWholeOrg({
                        userFilter = this.searchFilter.user,
                        ouFilter = this.searchFilter.ou,
                      } = {}, baseDN = this.baseDN): Promise<WholeOrg> {
    // will mute param from FetchOU as FetchNestOU
    const convertToNextOU = async (baseOUs: FetchOU[]) => {
      await Promise.all(baseOUs.map(async (baseOU) => {
        const baseNestOU = baseOU as FetchNestOU

        const childOUs = await this.fetchOUs(ouFilter, baseOU.dn, SearchScope.one)
        await convertToNextOU(childOUs)
        baseNestOU.childOUs = childOUs as FetchNestOU[]

        baseNestOU.users = await this.fetchUsers(userFilter, baseOU.dn, SearchScope.one)
      }))
    }

    const wholeOrg: WholeOrg = { ous: [], usersNotInOU: [] }
    const baseOU = (await this.fetchOUs(ouFilter, baseDN, SearchScope.base))[0]
    if (baseOU != null) {
      await convertToNextOU([baseOU])
      wholeOrg.ous.push(baseOU as FetchNestOU)
    } else {
      const baseOUs = await this.fetchOUs(ouFilter, baseDN, SearchScope.one)
      await convertToNextOU(baseOUs)
      wholeOrg.ous.push(...baseOUs as FetchNestOU[])
      wholeOrg.usersNotInOU.push(...await this.fetchUsers(userFilter, baseDN, SearchScope.one))
    }

    return wholeOrg
  }

  /**
   * 从 AD 接收对象更新通知
   * see https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/f14f3610-ee22-4d07-8a24-1bf1466cba5f
   * @param baseDN 默认是全局 baseDN
   * @param filterStr 过滤通知的对象属性，默认无
   */
  async subChangeNotificationForMSAD(filterStr = null, baseDN: string = this.baseDN): Promise<ADObjChangeNotifier> {
    if (this.dsType !== DirectoryServiceName.ActiveDirectory) {
      throw new Error(`just work with ${DirectoryServiceName.ActiveDirectory}`)
    }
    const client = await this.client
    const ADServerNotificationControl = new ldapjs['Control']({
      type: '1.2.840.113556.1.4.528',
      criticality: false,
    })
    const notifier = new ADObjChangeNotifier(client)
    client.search(baseDN, {
      scope: SearchScope.sub,
      attributes: searchAttrKeys as any,
      filter: '(objectClass=*)',
    }, ADServerNotificationControl, (err, response) => {
      if (err) {
        notifier.emit('end', err)
        return
      }

      response.on('searchEntry', ({ messageID, object: entryObject }) => {
        notifier.messageID = messageID
        if (notifier.stopped) {
          notifier.stop()
          return
        }
        const object = { ...entryObject } as unknown as FetchUser
        if (filterStr ? parseFilter(filterStr).matches(object) : true) {
          notifier.emit('change', object)
        }
      })
      response.on('error', (err) => {
        this.logError('ad change notification error', err);
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