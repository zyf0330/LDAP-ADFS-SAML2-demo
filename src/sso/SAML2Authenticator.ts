'use strict'

import { IdentityProvider, ServiceProvider, SAMLAssertResponse } from 'saml2-js'

/**
 *
 */

type SPOptions = {
  entityId: string
  privateKey: string
  certificate: string
  assertEndpoint: string
}
type IDPOptions = {
  ssoLoginUrl: string,
  ssoLogoutUrl: string,
  certificate: string,
}
type SAML2Options = {
  baseUrl: string,
  assertPath: string,
  spCertificate: string,
  spPrivateKey: string,
  idpCertificate: string,
  idpSSOUrl: string,
  idpSSOLogoutUrl?: string,
  requireSessionIndex?: boolean,
}

export class SAML2Authenticator {
  idpOptions: IDPOptions
  sp: ServiceProvider

  spOptions: SPOptions
  idp: IdentityProvider

  requireSessionIndex: boolean

  /**
   * 在使用时构造即可
   * @param options.idpSSOLogoutUrl 如果为空使用 idpSSOUrl
   * @param options.requireSessionId 是否要求处理 sso 的 session id
   */
  constructor(options: SAML2Options) {
    const spOptions = this.spOptions = {
      entityId: options.baseUrl,
      assertEndpoint: `${options.baseUrl}${options.assertPath}`,
      certificate: options.spCertificate,
      privateKey: options.spPrivateKey,
    }
    const idpOptions = this.idpOptions = {
      ssoLoginUrl: options.idpSSOUrl,
      ssoLogoutUrl: options.idpSSOLogoutUrl ?? options.idpSSOUrl,
      certificate: options.idpCertificate,
    }

    this.requireSessionIndex = options.requireSessionIndex ?? true

    this.sp = new ServiceProvider({
      entity_id: spOptions.entityId,
      private_key: spOptions.privateKey,
      certificate: spOptions.certificate,
      assert_endpoint: spOptions.assertEndpoint,
      sign_get_request: true,
    })

    this.idp = new IdentityProvider({
      sso_login_url: idpOptions.ssoLoginUrl,
      sso_logout_url: idpOptions.ssoLogoutUrl,
      certificates: idpOptions.certificate,
      sign_get_request: true,
    })
  }

  /**
   * 返回登录链接，用于客户端请求 SAML2 IdentityProvider 来登录
   */
  async getLoginRequestUrl(): Promise<string> {
    return new Promise((res, rej) => {
      this.sp.create_login_request_url(this.idp, {}, (err, loginUrl, requestId) => {
        if (err) {
          rej(err)
          return
        }
        res(loginUrl)
      })
    })
  }

  /**
   * 返回登出链接，用于客户端请求 SAML2 IdentityProvider 来登出
   * @param nameId 用户登陆名
   * @param sessionIndex sessionIndex 为用户登录在 idp 的 session id
   */
  async getLogoutRequestUrl(nameId: string, sessionIndex?: string): Promise<string> {
    return new Promise((res, rej) => {
      this.sp.create_logout_request_url(this.idp, {
        name_id: nameId,
        session_index: this.requireSessionIndex ? sessionIndex : undefined,

      }, (err, logoutUrl) => {
        if (err) {
          rej(err)
          return
        }
        res(logoutUrl)
      })
    })
  }

  /**
   * 用于 idp 登录回调
   */
  async assertForLogin(httpMethod: 'POST' | 'GET', SAMLResponse: string): Promise<{ nameId: string, sessionIndex?: string }> {
    const response = await this.assert({ SAMLResponse }, httpMethod === 'POST')
    if (response.type !== 'authn_response') {
      throw new Error('no login assert')
    }
    const { name_id: nameId, session_index: sessionIndex } = response.user
    return { nameId, sessionIndex }
  }

  /**
   * 用于 idp 登出回调
   */
  async assertForLogout(httpMethod: 'POST' | 'GET', SAMLResponse: string) {
    const response = await this.assert({ SAMLResponse }, httpMethod === 'POST')
    if (response.type !== 'logout_response') {
      throw new Error('no logout assert')
    }
  }

  /**
   * 如果有其他 SAML 断言需求，使用该方法
   * @param isPostOrRedirect post_assert if true, otherwise redirect_assert
   */
  async assert({
                 SAMLRequest,
                 SAMLResponse,
               }: { SAMLRequest?: string, SAMLResponse?: string }, isPostOrRedirect = true): Promise<SAMLAssertResponse> {
    return new Promise((res, rej) => {
      this.sp[isPostOrRedirect ? 'post_assert' : 'redirect_assert'](this.idp, {
        request_body: { SAMLRequest, SAMLResponse },
        require_session_index: this.requireSessionIndex,
      }, (err, response) => {
        if (err) {
          rej(err)
          return
        }
        res(response)
      })
    })
  }

  getMetadataXML() {
    return this.sp.create_metadata()
  }
}