'use strict'
/**
 *
 */

import { SAML2Authenticator } from '../src/index'
import { readFileSync } from 'fs'
import { createServer } from 'https'
import * as formidable from 'formidable'
import { URL } from 'url'

function getSAML2Authenticator({ baseUrl, assertPath }) {
  const saml2Options = {
    baseUrl,
    assertPath: assertPath,
    spCertificate: readFileSync(`${__dirname}/cert.pem`, 'ascii'),
    spPrivateKey: readFileSync(`${__dirname}/key.pem`, 'ascii'),
    idpCertificate: readFileSync(`${__dirname}/adfs-base64.cer`, 'ascii'),
    idpSSOUrl: 'https://dinglonggang.access.com/adfs/ls',
    requireSessionIndex: true,
  }
  return new SAML2Authenticator(saml2Options)
}

const baseUrl = 'https://localhost:8080'
const assertPath = `/assert`
const metadataPath = `/metadata.xml`

const sessions = {}

function getSessionIdFromCookie(cookie) {
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
  const saml2Authenticator = getSAML2Authenticator({ baseUrl, assertPath })
  const url = new URL(request.url, baseUrl)

  switch (url.pathname) {
    case metadataPath: {
      if (request.method != 'GET') {
        response.writeHead(404)
        return
      }
      response.setHeader('content-type', 'application/xml')
      response.write(saml2Authenticator.getMetadataXML())
      response.end()
    }
      break
    case assertPath: {
      const method = request.method
      // AD FS 默认使用 POST 作为登录回调端点，GET 为登出回调端点
      // 使用 SSO 要求在回调成功后，视为登录和登出成功
      if (method == 'POST') {
        const form = formidable({ multiples: true });
        form.parse(request, async (err, fields) => {
          if (err) {
            response.writeHead(500)
            response.end()
            return
          }
          const { nameId, sessionIndex } = await saml2Authenticator.assertForLogin(method, fields.SAMLResponse)
          sessions[sessionIndex] = nameId
          response.setHeader('Set-Cookie', `sessionIndex=${sessionIndex}`);
          response.end(`Hello! ${nameId} login in ${host} success, session is ${sessionIndex}`)
        });
      } else if (method === 'GET') {
        const SAMLResponse = url.searchParams.get('SAMLResponse')
        saml2Authenticator.assertForLogout(method, SAMLResponse).then(() => {
          const sessionIndex = getSessionIdFromCookie(request.headers.cookie)
          const nameId = sessions[sessionIndex]

          delete sessions[sessionIndex]
          response.setHeader('Set-Cookie', `sessionIndex=`);

          response.end(`Goodbye! ${nameId} logout from ${host} success, session is ${sessionIndex}`)
        })
      }
    }
      break
    case '/login': {
      saml2Authenticator.getLoginRequestUrl().then((url) => {
        response.writeHead(302, { 'location': url })
        response.end()
      })
    }
      break
    case '/logout': {
      const sessionIndex = getSessionIdFromCookie(request.headers.cookie)
      const nameId = sessions[sessionIndex]
      if (!nameId) {
        response.write('not login')
        response.end()
      } else {
        saml2Authenticator.getLogoutRequestUrl(nameId, sessionIndex).then((url) => {
          response.writeHead(302, { 'location': url })
          response.end()
        })
      }
    }
      break
  }
})
server.listen('8080', () => {
  console.log(`SAML2.0 metadata xml endpoint is ${baseUrl}${metadataPath}`)
})