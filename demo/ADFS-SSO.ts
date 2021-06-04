'use strict'
/**
 *
 */
import { adfs } from './accounts'

import { SAML2Authenticator } from '../src/index'
import { readFileSync } from 'fs'
import { createServer } from 'https'
import { URL } from 'url'

function getSAML2Authenticator({ baseUrl }) {
  const saml2Options = {
    baseUrl,
    assert: {
      login: {
        path: assertLoginPath + '?team=test-team',
        method: <const>'GET',
      },
      logout: {
        path: assertLogoutPath + '?team=test-team',
        method: <const>'GET',
      },
    },
    spCertificate: readFileSync(`${__dirname}/cert.pem`, 'ascii'),
    spPrivateKey: readFileSync(`${__dirname}/key.pem`, 'ascii'),
    idpCertificate: readFileSync(`${__dirname}/adfs-base64.cer`, 'ascii'),
    idpSSOUrl: adfs.ssoUrl,
    requireSessionIndex: true,
  }
  return new SAML2Authenticator(saml2Options)
}

const baseUrl = 'https://localhost:8080'
const assertLoginPath = `/assert-login`
const assertLogoutPath = `/assert-logout`
const metadataPath = `/metadata.xml`

const sessions = {}

function getSessionIdFromCookie(cookie) {
  if (cookie === '') {
    return
  }
  const posOfSessionIndex = cookie.indexOf('sessionIndex=') + 'sessionIndex='.length
  const endPos = cookie.indexOf(';', posOfSessionIndex)
  const sessionIndex = cookie.slice(posOfSessionIndex, endPos === -1 ? undefined : endPos)
  return sessionIndex
}

const server = createServer({
  key: readFileSync(`${__dirname}/key.pem`,),
  cert: readFileSync(`${__dirname}/cert.pem`,),
  ca: [readFileSync(`${__dirname}/cert.pem`,)],
}, (request, response) => {
  const { host } = request.headers
  const saml2Authenticator = getSAML2Authenticator({ baseUrl })
  const url = new URL(request.url, baseUrl)
  const method = request.method
  console.log(`[${method}]`, url)

  switch (url.pathname) {
    case metadataPath: {
      if (method != 'GET') {
        response.writeHead(404)
        return
      }
      response.setHeader('content-type', 'application/xml')
      response.write(saml2Authenticator.getMetadataXML())
      response.end()
    }
      break
    case assertLoginPath: {
      // 使用 SSO 要求在回调成功后，视为登录和登出成功
      if (method === 'GET') {
        const SAMLResponse = url.searchParams.get('SAMLResponse')
        saml2Authenticator.assertForLogin(SAMLResponse).then(({ nameId, sessionIndex }) => {
          sessions[sessionIndex] = nameId
          response.setHeader('Set-Cookie', `sessionIndex=${sessionIndex}`);
          response.end(`Hello! ${nameId} login in ${host} success, session is ${sessionIndex}`)
        })
      }
    }
      break
    case assertLogoutPath: {
      const SAMLResponse = url.searchParams.get('SAMLResponse')
      saml2Authenticator.assertForLogout(SAMLResponse).then(() => {
        const sessionIndex = getSessionIdFromCookie(request.headers.cookie)
        const nameId = sessions[sessionIndex]

        delete sessions[sessionIndex]
        response.setHeader('Set-Cookie', `sessionIndex=`);

        response.end(`Goodbye! ${nameId} logout from ${host} success, session is ${sessionIndex}`)
      })
    }
      break
    case '/login': {
      const url = saml2Authenticator.getLoginRequestUrl()
      response.writeHead(302, { 'location': url })
      response.end()
    }
      break
    case '/logout': {
      const sessionIndex = getSessionIdFromCookie(request.headers.cookie || '')
      const nameId = sessions[sessionIndex]
      if (!nameId) {
        response.write('not login')
        response.end()
      } else {
        const url = saml2Authenticator.getLogoutRequestUrl(nameId, sessionIndex)
        response.writeHead(302, { 'location': url })
        response.end()
      }
    }
      break
  }
})
server.listen('8080', () => {
  console.log(`SAML2.0 metadata xml endpoint is ${baseUrl}${metadataPath}`)
})