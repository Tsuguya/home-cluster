# External Domain Requirements

CNP egress (`toFQDNs`) 設定時のリファレンス。各外部サービスが必要とするドメインとポートをまとめる。

## 1Password Connect Server

- **Source**: https://support.1password.com/ports-domains/
- **Port**: 443

| Domain | Required | Notes |
|---|---|---|
| `*.1password.com` | Yes | Core API |
| `*.1passwordusercontent.com` | Yes | Vault data (attachments, profile images) |
| `*.1passwordservices.com` | No | Telemetry, subscription management — Connect Server では不要 |
