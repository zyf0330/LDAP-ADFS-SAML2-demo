'use strict'

import { IdentityProvider, ServiceProvider, Constants } from 'samlify'
import { wording } from 'samlify/build/src/urn'

const binding = wording.binding

/**
 *
 */

type SAML2Options = {
  baseUrl: string,
  assert: {
    login: {
      path: string,
      method: 'POST' | 'GET',
    },
    logout?: {
      path: string,
      method: 'POST' | 'GET',
    },
  },
  spCertificate: string,
  spPrivateKey: string,
  idpCertificate: string,
  idpSSOUrl: string,
  idpSSOLogoutUrl?: string,
  requireSessionIndex?: boolean,
}

export class SAML2Authenticator {
  sp: ReturnType<typeof ServiceProvider>
  idp: ReturnType<typeof IdentityProvider>

  loginOption
  logoutOption

  requireSessionIndex: boolean

  /**
   * 在使用时构造即可 // TODO
   * @param options.idpSSOLogoutUrl 如果为空使用 idpSSOUrl
   * @param options.requireSessionId 是否要求处理 sso 的 session id
   */
  constructor(options: SAML2Options) {
    options.assert.logout = options.assert.logout || options.assert.login

    this.requireSessionIndex = options.requireSessionIndex ?? true
    this.loginOption = {
      // TODO samlify 现在不支持 HTTP-Redirect Binding
      binding: options.assert.login.method === 'GET' ? binding.redirect : binding.post,
      assertUrl: `${options.baseUrl}${options.assert.login.path}`,
    }
    this.logoutOption = {
      binding: options.assert.logout.method === 'GET' ? binding.redirect : binding.post,
      assertUrl: `${options.baseUrl}${options.assert.logout.path}`,
    }

    this.sp = ServiceProvider({
      nameIDFormat: ['urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified'],
      entityID: options.baseUrl,
      privateKey: options.spPrivateKey,
      signingCert: options.spCertificate,
      encryptCert: options.spCertificate,
      authnRequestsSigned: true,
      wantAssertionsSigned: true,
      wantLogoutRequestSigned: true,
      wantLogoutResponseSigned: true,
      assertionConsumerService: [{
        isDefault: true,
        Binding: this.loginOption.binding === binding.redirect ? Constants.BindingNamespace.Redirect : Constants.BindingNamespace.Post,
        Location: this.loginOption.assertUrl,
      }],
      singleLogoutService: [{
        isDefault: true,
        Binding: this.logoutOption.binding === binding.redirect ? Constants.BindingNamespace.Redirect : Constants.BindingNamespace.Post,
        Location: this.logoutOption.assertUrl,
      }],
    })

    this.idp = IdentityProvider({
      signingCert: options.idpCertificate,
      encryptCert: options.idpCertificate,
      wantAuthnRequestsSigned: true,
      wantLogoutRequestSigned: true,
      wantLogoutResponseSigned: true,
      wantLogoutRequestSignedResponseSigned: true,
      singleSignOnService: [{
        isDefault: true,
        Binding: Constants.BindingNamespace.Redirect,
        Location: options.idpSSOUrl,
      }],
      singleLogoutService: [{
        Binding: Constants.BindingNamespace.Redirect,
        Location: options.idpSSOLogoutUrl || options.idpSSOUrl,
      }],
    })
  }

  /**
   * 返回登录链接，用于客户端请求 SAML2 IdentityProvider 来登录
   */
  getLoginRequestUrl(): string {
    const { context } = this.sp.createLoginRequest(this.idp)
    return context
  }

  /**
   * 返回登出链接，用于客户端请求 SAML2 IdentityProvider 来登出
   * @param nameId 用户登陆名
   * @param sessionIndex sessionIndex 为用户登录在 idp 的 session id
   */
  getLogoutRequestUrl(nameId: string, sessionIndex?: string): string {
    const { context } = this.sp.createLogoutRequest(this.idp, binding.redirect, {
      logoutNameID: nameId,
      sessionIndex: this.requireSessionIndex ? sessionIndex : undefined,
    })
    return context
  }

  /**
   * 用于 idp 登录回调
   */
  async assertForLogin(SAMLResponse: string): Promise<{ nameId: string, sessionIndex?: string, email?: string, attributes?: Record<string, string | string[]> }> {
    const request = this.loginOption.binding === binding.redirect ? { query: { SAMLResponse } } : { body: { SAMLResponse } }

    const { samlContent, extract } = await this.sp.parseLoginResponse(this.idp, this.loginOption.binding, request)
    console.log(samlContent, extract)
    const nameId = '', sessionIndex = ''
    const email = ''
    const attributes = {}
    return { nameId, sessionIndex, email, attributes }
  }

  /**
   * 用于 idp 登出回调
   */
  async assertForLogout(SAMLResponse: string) {
    // const response = await this.assert({ SAMLResponse }, httpMethod === 'POST')
    // if (response.type !== 'logout_response') {
    //   throw new Error('no logout assert')
    // }
  }

  getMetadataXML() {
    return this.sp.getMetadata()
  }
}