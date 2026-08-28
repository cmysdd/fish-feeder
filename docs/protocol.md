# MQTT 消息协议和安全设计

## 1. 协议版本

所有 JSON 消息包含：

```json
{ "v": 1 }
```

增加不兼容字段时应提升版本号。ESP8266 接受版本 1 的手动投喂、计划更新和设备参数更新命令。

网页还提供 `servo_test` 测试命令。它使用当前已保存的舵机模式执行一次“关闭→投喂→关闭”动作（连续舵机按当前转动参数运行），不计入投喂次数和 24 小时上限；同样需要 HMAC 签名，适合空载排查接线和模式配置。

## 2. 投喂命令

主题：

```text
用户名/项目名/feeder_cmd
```

示例：

```json
{
  "v": 1,
  "id": "c61fdba6-8125-4d91-88af-685d92e2a951",
  "action": "feed",
  "portion": 1,
  "issued_at": 1786924800,
  "expires_at": 1786924845,
  "sig": "64位十六进制HMAC-SHA256"
}
```

字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 命令唯一编号 |
| `action` | 字符串 | 固定为 `feed` |
| `portion` | 整数 | 1～3 |
| `issued_at` | Unix 秒 | 手机签发时间 |
| `expires_at` | Unix 秒 | 命令过期时间，默认晚 45 秒 |
| `sig` | 十六进制字符串 | HMAC-SHA256 签名 |

网页使用 QoS 1、`retain=false` 发布。QoS 1 可能重复投递，因此不能把 MQTT 收到一次等同于执行一次，必须使用命令 UUID 去重。

## 3. 签名算法

签名原文严格按以下顺序拼接：

```text
v|id|action|portion|issued_at|expires_at
```

示例：

```text
1|c61fdba6-8125-4d91-88af-685d92e2a951|feed|1|1786924800|1786924845
```

以 `COMMAND_SECRET` 为密钥计算 HMAC-SHA256，再转换为小写十六进制。网页使用 Web Crypto，ESP8266 使用开发板包自带的 BearSSL。

命令签名密钥不会出现在 MQTT 消息中。它应使用至少 24 字节随机数据，网页默认生成 24 字节并显示为 48 位十六进制。

手动投喂联调测试向量：

```text
密钥：0123456789abcdef0123456789abcdef
原文：1|c61fdba6-8125-4d91-88af-685d92e2a951|feed|1|1786924800|1786924845
结果：a1e8a87a41f3f6174d81858926cd88daf73ecf57e9726f88c6fdd73a3eb4ce79
```

如果网页和固件对同一测试向量计算结果不同，不能继续进行真实投喂测试。

## 4. 定时计划更新命令

计划更新与手动投喂共用 `feeder_cmd` 主题，`action` 为 `set_schedule`：

```json
{
  "v": 1,
  "id": "75a2f5ec-ecc0-4ae8-9926-8b974eaef3e9",
  "action": "set_schedule",
  "schedule_data": "1,8,0,1,127;1,18,30,2,62",
  "issued_at": 1786924800,
  "expires_at": 1786924845,
  "sig": "64位十六进制HMAC-SHA256"
}
```

每条计划编码为 `enabled,hour,minute,portion,daysMask`，多条使用分号连接，空字符串表示清空全部计划。`daysMask` 从 bit 0 到 bit 6 依次代表周日到周六；`127` 表示每天，`62` 表示周一到周五，`65` 表示周末。最多保存 6 条。

计划命令签名原文：

```text
v|id|action|schedule_data|issued_at|expires_at
```

计划更新测试向量：

```text
密钥：0123456789abcdef0123456789abcdef
原文：1|75a2f5ec-ecc0-4ae8-9926-8b974eaef3e9|set_schedule|1,8,0,1,127;1,18,30,2,62|1786924800|1786924845
结果：e258c2b2586925871fbb7a7a1413f3eeb7b678b4ce2f9d7844b933eb34bfdef3
```

设备校验签名、时效和字段范围后，把整组计划写入 EEPROM。计划固定使用 UTC+8 北京时间执行。

## 5. 设备参数更新命令

设备参数更新与其它命令共用 `feeder_cmd` 主题，`action` 为 `set_config`。网页将参数编码为：

```text
舵机模式,关闭角度,投喂角度,连续转动角度,一圈耗时毫秒,正转脉宽,反转脉宽,停止脉宽,投喂方向,动作完成后,最短间隔秒数,每日最大份量,每日最大次数
```

例如 `1,12,92,180,2000,1700,1300,1500,0,0,60,12,8`。模式 `1` 为360°连续旋转，按“连续转动角度 ÷ 360 × 一圈耗时”计算运行时间；动作完成后字段 `0` 表示单向转动后停止，`1` 表示用反向脉宽转回同样时间再停止。模式 `0` 为180°定位舵机，使用关闭角度和投喂角度。连续舵机的正转/反转/停止脉宽可校准，投喂方向可选。最短间隔范围为10～86400秒，每日最大份量为1～300，每日最大次数为1～100。参数和最近参数命令编号会保存到 EEPROM，多个手机同时操作时使用命令时间阻止旧配置覆盖新配置。

签名原文为：

```text
v|id|set_config|config_data|issued_at|expires_at
```

## 6. 设备确认

主题：

```text
用户名/项目名/feeder_ack
```

示例：

```json
{
  "v": 1,
  "id": "c61fdba6-8125-4d91-88af-685d92e2a951",
  "device_id": "feeder-001",
  "action": "feed",
  "status": "completed",
  "portion": 1,
  "reason": "motor_sequence_completed",
  "ts": 1786924804
}
```

状态：

| 状态 | 说明 |
|---|---|
| `processing` | 命令通过校验，安全状态已写入 EEPROM，正在驱动舵机 |
| `completed` | 舵机动作序列完成 |
| `rejected` | 命令未执行，查看 `reason` |
| `failed` | 已领取命令，但执行过程报告失败 |
| `duplicate` | UUID 已处理，设备不会再次执行 |

拒绝原因：

| `reason` | 含义 |
|---|---|
| `invalid_payload` | JSON 字段或命令类型错误 |
| `invalid_portion` | 份量超出固件范围 |
| `invalid_schedule` | 定时计划字段、数量或日期掩码无效 |
| `invalid_config` | 设备参数超出固件允许范围 |
| `stale_schedule` | 计划更新时间早于设备已保存的版本 |
| `stale_config` | 参数更新时间早于设备已保存的版本 |
| `clock_not_ready` | NTP 尚未同步，无法验证时效 |
| `command_expired` | 命令太旧、已过期或时间异常 |
| `invalid_signature` | HMAC 签名不匹配 |
| `duplicate_command` | 相同 UUID 已处理 |
| `cooldown` | 距上次投喂时间过短 |
| `daily_limit` | 24 小时窗口份量达到上限 |
| `servo_failed` | 舵机对象无法启动或动作失败 |
| `schedule_updated` | 定时计划已写入 EEPROM |
| `config_updated` | 设备参数已写入 EEPROM |

## 7. 设备状态

主题：

```text
用户名/项目名/feeder_state
```

此消息使用 `retain=true`，网页刚连接时可以立即获得最近状态。

```json
{
  "v": 1,
  "online": true,
  "device_id": "feeder-001",
  "firmware": "1.3.1",
  "rssi": -58,
  "wifi_ssid": "home-2.4g",
  "ip": "192.168.1.88",
  "config_url": "http://192.168.1.88/",
  "free_heap": 31200,
  "uptime_s": 3600,
  "ts": 1786924800,
  "clock_ready": true,
  "last_feed_at": 1786924700,
  "last_feed_source": "schedule",
  "portions_24h": 2,
  "feeds_24h": 1,
  "max_portions_24h": 12,
  "max_feeds_24h": 8,
  "min_interval_seconds": 60,
  "servo_closed_angle": 12,
  "servo_open_angle": 92,
  "servo_mode": 1,
  "continuous_turn_degrees": 180,
  "continuous_ms_per_rev": 2000,
  "continuous_forward_us": 1700,
  "continuous_reverse_us": 1300,
  "continuous_stop_us": 1500,
  "continuous_direction": 0,
  "continuous_return": false,
  "last_error": "",
  "timezone_offset_minutes": 480,
  "schedules": [
    { "enabled": true, "hour": 8, "minute": 0, "portion": 1, "days_mask": 127 }
  ]
}
```

状态每 60 秒发布一次，投喂完成、命令拒绝和网页请求状态时也会立即发布。

定时任务因安全间隔或每日上限被跳过时，`last_error` 分别为 `schedule_cooldown` 或 `schedule_daily_limit`。

## 8. 在线状态和遗嘱

主题：

```text
用户名/项目名/feeder_online
```

设备连接成功后发布：

```json
{ "v": 1, "online": true, "device_id": "feeder-001", "ts": 1786924800 }
```

连接意外中断时 MixIO 发布 MQTT Last Will：

```json
{ "v": 1, "online": false, "device_id": "feeder-001", "ts": 0 }
```

网页还设置了 180 秒状态超时。即使遗嘱没有及时到达，长期没有任何设备消息也会显示离线。

## 9. 状态查询

网页向 `feeder_query` 发布：

```json
{ "action": "status", "requested_at": 1786924800 }
```

查询不触发执行机构，因此没有签名。设备收到后立即重新发布 `feeder_state`。

## 10. 防重放流程

设备按顺序检查：

1. JSON 和协议版本。
2. UUID 格式和份量范围。
3. NTP 时间是否有效。
4. 签发时间、过期时间和最大有效期。
5. HMAC-SHA256 签名。
6. UUID 是否与 EEPROM 中最近命令一致。
7. 最短投喂间隔。
8. 24 小时份量上限。

全部通过后，设备先把 UUID、投喂时间和份量写入 EEPROM，然后才驱动舵机。这个顺序选择“可能漏投一次，也不重复投喂”，更适合鱼食投喂安全。

## 11. 定时执行流程

设备每个本地分钟检查一次计划：

1. NTP 时间必须有效。
2. 当前北京时间、星期和启用状态必须匹配。
3. 当前计划当天尚未运行。
4. 先把“当天已运行”写入 EEPROM。
5. 再检查最短投喂间隔和 24 小时份量上限。
6. 通过后保存份量状态并驱动舵机。

先记录当天已运行，是为了断电恢复后不重复出粮。动作前突然断电时可能漏掉一次，这符合“宁可漏一次，也不重复过量”的安全原则。

## 12. EEPROM 写入策略

每次有效投喂写入一次 EEPROM，普通家用每天写入次数很少。保存内容包括：

- 最近命令 UUID。
- 最近投喂 Unix 时间。
- 24 小时窗口开始时间。
- 窗口累计份量。
- 最多 6 条定时计划及各计划最近运行日期。
- 最近一次计划更新命令 UUID。
- 最近一次计划更新时间，用于阻止多手机旧配置覆盖新配置。
- 魔数和校验值。

如果 EEPROM 数据损坏，固件会重置安全状态。实际鱼粮是否已经投喂无法从损坏状态恢复，遇到异常后应人工检查鱼缸。

## 13. 安全说明

HMAC 能保证命令真实性和完整性，结合时间和 UUID 可以抵御普通伪造与重放。但由于 ESP8266 到 MixIO 使用未加密 MQTT 1883：

- MixIO 用户名和项目密码可能被网络路径观察。
- 状态消息可以被观察或伪造。
- 攻击者可能断开连接或制造消息干扰。
- HMAC 密钥没有发送，因此不能仅凭抓取 MQTT 流量生成新投喂命令。

若需要更强安全性，应使用 TLS MQTT Broker、家庭 VPN、反向隧道或支持安全 WSS 的设备客户端。
