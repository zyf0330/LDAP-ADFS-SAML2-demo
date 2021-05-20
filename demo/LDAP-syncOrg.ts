'use strict'
/**
 *
 */

import { LDAPOrgFetcher } from '../src/'
import { msADDS } from './accounts'

const msADFetcher = new LDAPOrgFetcher({
  url: msADDS.url,
  adminDN: msADDS.adminDN,
  adminPassword: msADDS.adminPassword,

});

;(async () => {
  const notifier = await msADFetcher.subChangeNotificationForMSAD(msADDS.base)
  notifier.on('change', async (object) => {
    console.log('change', object)
    await notifier.stop()
    console.log('stop')
  })
  notifier.on('error', console.log.bind(null, 'error'))
  notifier.on('end', console.log.bind(null, 'end'))
})()