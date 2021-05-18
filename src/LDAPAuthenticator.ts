/**
 * 负责 ldap authentication
 */
import { createClient, Client, SearchEntryObject, Error } from 'ldapjs'

enum SearchScope {
  base = 'base',
  one = 'one',
  sub = 'sub'
}

export class LDAPAuthenticator {
  url: string
  tlsOptions // TODO
  adminDN: string
  adminPassword: string

  private searchScope: SearchScope = SearchScope.sub

  private readonly adminClient: Promise<Client>

  constructor({
                url,
                tlsOptions,
                adminDN,
                adminPassword,
              }: { url: string, tlsOptions?: any, adminDN: string, adminPassword: string }) {
    this.url = url
    this.tlsOptions = tlsOptions
    this.adminDN = adminDN
    this.adminPassword = adminPassword

    this.adminClient = Promise.resolve().then(() => {
      const client = this.createClient()
      // TODO connection management
      client.on('error', (err) => {
        this.logError('ldap client error', err)
      })
      return this.bindUser(this.adminDN, this.adminPassword, client).then((success) => {
        if (!success) {
          this.logError('bind admin fail', null)
        }
        return client
      })
    })

  }

  private createClient() {
    return createClient({
      url: this.url,
    })
  }

  /**
   * @return 是否通过
   */
  async auth(dn, password) {
    return await this.bindUser(dn, password)
  }

  /**
   *
   * @param {string} searchFilter ldap searchFilter format, like (uid=myUid)
   * @param {string} searchBase ldap searchBase format, like (dc=local,dc=com)
   * @return 是否通过
   */
  async authBySearchFilter({ searchFilter, searchBase }, password) {
    const user = await this.searchAuthUser(searchFilter, searchBase)
    if (user === null) {
      this.logError('search no user')
      return false
    }
    return this.auth(user.dn, password)
  }

  /**
   * 所有 auth 方法必须调用此方法来进行 bind
   * @private
   */
  private async bindUser(dn, password, client?: Client): Promise<boolean> {
    // https://ldapwiki.com/wiki/Synchronous%20Operation#section-Synchronous+Operation-BindRequestAndBindResponseMustBeSynchronousOperation
    // Bind Request and Bind Response must be Synchronous Operation
    // 因此采用每个 bind 创建一个客户端的方式，简化逻辑
    return new Promise((res) => {
      client = client || this.createClient()
      client.bind(dn, password, (err) => {
        if (err) {
          this.logError('bind err', err)
        }
        res(!err)
      })
    })
  }

  /**
   *
   * @private
   */
  private async searchAuthUser(filter, base): Promise<SearchEntryObject | null> {
    return this.adminClient.then((adminClient) => {
      return new Promise((res, rej) => {
        adminClient.search(base, {
          filter,
          scope: this.searchScope,
          // attributes: ['dn'],
        }, (err, response) => {
          if (err) {
            rej(err)
            return
          }

          let user: SearchEntryObject = null
          response.on('searchEntry', (entry) => {
            user = entry.object
          })
          response.on('error', (err) => {
            this.logError('search error', err);
            rej(err)
          });
          response.on('end', (result) => {
            if (result?.status !== 0) {
              console.error('search end', result.status, result.errorMessage)
              rej()
              return
            } else {
              res(user)
            }
          });
        })
      })
    })
  }

  private logError(label: string, err?: Error) {
    if (err) {
      console.error(`${label}: [${err.code}] ${err.name}`)
    } else {
      console.error(`${label}`)
    }
  }
}