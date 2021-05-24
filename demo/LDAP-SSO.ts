'use strict'
/**
 *
 */
import { LDAPAuthenticator } from '../src'
import { openLDAP, ad } from './accounts'

const openLDAPAuthenticator = new LDAPAuthenticator(openLDAP);
const msADDSAuthenticator = new LDAPAuthenticator(ad);

;(async () => {
  let res
  res = await openLDAPAuthenticator.auth(openLDAP.adminDN, openLDAP.adminPassword)
  console.log('test res', res)
  res = await openLDAPAuthenticator.authBySearchFilter({
    searchBase: openLDAP.base,
    searchFilter: '(&(ou=wt)(cn=admin_not_exist))',
  }, openLDAP.adminPassword)
  console.log('test res', res)
  res = await openLDAPAuthenticator.authBySearchFilter({
    searchBase: openLDAP.base,
    searchFilter: '(&(ou=wt)(cn=admin1))',
  }, '1234')
  console.log('test res', res)
  res = await msADDSAuthenticator.auth(ad.adminDN, ad.adminPassword)
  console.log('test res', res)
  res = await msADDSAuthenticator.auth('cn=adfs_pc,cn=Users,dc=access,dc=com', '1234@test')
  console.log('test res', res)
  res = await msADDSAuthenticator.authBySearchFilter({
    searchBase: ad.base,
    searchFilter: '(cn=adfs_pc)',
  }, '1234@test')
  console.log('test res', res)
  res = await msADDSAuthenticator.authBySearchFilter({
    searchBase: ad.base,
    searchFilter: '(cn=not_exist_pc)',
  }, '1234@test')
  console.log('test res', res)
})()

