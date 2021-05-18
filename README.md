## 概念介绍
### AD
AD(Active Directory)是目录服务，用于储存目录类别信息，包括账户体系、通讯录、电话簿、组织架构等等
### LDAP
LDAP 是一种支持访问 AD 服务器的协议，提供对 AD 服务器的登陆(bind)和对 AD 储存信息的新增修改(add/modify)、查询(search)和比对(compare)等功能，常用于单点登录(SSO)
### OpenLDAP
支持 LDAP 协议的一个开源 AD 服务器
### AD DS(named AD before Windows Server 2008)
AD DS(AD Domain Service)是微软的 AD 服务器实现，它支持通过 LDAP 协议访问
### AD FS
AD FS 基于 AD DS，提供身份鉴别和访问控制功能，可以提供基于 SAML2 的单点登录 SSO 功能

## 技术方案
### 单账号登录
- LDAP(openLDAP, AD DS): 使用 ldapjs 参考 [passport-ldapauth](https://www.passportjs.org/packages/passport-ldapauth/) 自己实现
### 单点登录
使用 ldapjs 或下列 passport.js 插件来实现
- SAML2(AD FS): 使用 saml2-js
### 组织架构同步
使用 ldapjs 从支持 LDAP 的 AD 服务器(如 OpenLDAP 或 AD DS)查询组织架构

## 产品功能配置方式
### 单点登录 SSO
#### LDAP
- 访问地址
- 是否配置证书
- 有权限查询所有用户(user)的管理员用户名(adminDN)和密码(adminPassword)
#### SAML2(AD FS)
> 此处 SP 为 service provider 为 AD FS
##### 配置项
SP 配置
- IdP 证书
- IdP 登录地址
- IdP 登出地址
IdP 配置
- SP 证书
- SP metadata 地址

##### 配置步骤
1. 在 Windows Server 创建 AD FS 服务器
1. 将 AD FS 管理界面的**服务-证书-令牌签名证书**打开并复制 base64 X.509 格式为文件，将文件内容作为 SAML2Authenticator 的 idpCertificate 值
1. 将其他 SAML2Authenticator 选项配置好，启动托管了 SAML2Authenticator 的 sp https 服务器(如果为自签名证书，需要将证书导入客户端证书链中)
1. 在 AD FS 管理界面的**信赖方信任-添加信赖方信任**添加 sp
  1. 选择声明感知-启动
  1. 选择导入，填写 sp 服务器获取 metadata.xml(SAML2Authenticator#getMetadataXML)内容的链接
    1. 也可以从该链接下载 metadata.xml 后选择从文件导入（这样无法自动更新）
  1. 一直点下一步直到完成
  1. 添加声明颁发策略
    1. 选择发送 LDAP 特性
    1. 特性存储选择 AD
    1. 将**电子邮件、User-Principle-Name 或电话号码**等 LDAP 特性(和 sp 登录名相同)传出为**名称-ID**或**Name-ID**
    1. 保存即可

### 组织架构同步 syncOrg
#### LDAP
- LDAP 访问
  - AD 服务器类型：OpenLDAP、MS AD DS 等
  - 访问地址
  - 是否配置证书
  - 有权限查询所有用户的用户名(dn)和密码
- 组织架构
  - 基础组织 base DN