'use strict'
/**
 *
 */

import { LDAPOrgFetcher } from '../src/'
import { ad } from './accounts';

(async () => {
  const adFetcher = new LDAPOrgFetcher({
    url: ad.url,
    adminDN: ad.adminDN,
    adminPassword: ad.adminPassword,
    baseDN: ad.base,
  });
  console.log('=============== Active Directory ===============')
  // const ous = await adFetcher.fetchOUs()
  // console.log('ous', ous)
  // const users = await adFetcher.fetchUsers()
  // console.log('users', users)
  const result = await adFetcher.fetchWholeOrg()
  console.log('whole Org')
  console.dir(result, { depth: 10 })

  // const notifier = await adFetcher.subChangeNotificationForMSAD()
  // notifier.on('change', async (object) => {
  //   console.log('change', object)
  //   await notifier.stop()
  //   console.log('stop')
  // })
  // notifier.on('error', (err) => {
  //   console.log('error', err)
  // })
  // notifier.on('end', console.log.bind(null, 'end'))
  // await notifier.stop()

  await adFetcher.release()
})().then(() => {
  return (async () => {
    /*    console.log('=============== OpenLDAP ===============')
        const openLDAPFetcher = new LDAPOrgFetcher({
          url: openLDAP.url,
          adminDN: openLDAP.adminDN,
          adminPassword: openLDAP.adminPassword,
          baseDN: openLDAP.base,
          dsType: DirectoryServiceName.OpenLDAP,
        });
        const ous = await openLDAPFetcher.fetchOUs()
        console.log('ous', ous)
        const users = await openLDAPFetcher.fetchUsers()
        console.log('users', users)
        await openLDAPFetcher.release()*/
  })()
})
